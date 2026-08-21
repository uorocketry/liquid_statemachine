"""Generic durable acquisition runs backed by SQLite chunk storage."""

from __future__ import annotations

import math
from datetime import datetime
from itertools import groupby
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Iterator, Sequence

from base_station.web.daq_config.acquisition import SampleBatch, SignalDescriptor
from base_station.web.run_chunks import accumulate_chunk, csv_line, pack_values, unpack_values
from base_station.web.run_storage import SCHEMA_VERSION, RunStorage


class RunRepository:
    """Persist aligned source batches without knowing anything about the source."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self.storage = RunStorage(path)

    def _connect(self):
        return self.storage.connect()

    def start_run(
        self,
        scan_rate: int,
        signals: Sequence[SignalDescriptor],
        *,
        source_id: str,
    ) -> int:
        if isinstance(scan_rate, bool) or not isinstance(scan_rate, int) or scan_rate <= 0:
            raise ValueError("Run scan rate must be a positive integer")
        if not isinstance(source_id, str) or not source_id.strip():
            raise ValueError("Run source id is required")
        descriptors = tuple(signals)
        if not descriptors:
            raise ValueError("Acquisition requires at least one recorded signal")
        signal_ids = [signal.id for signal in descriptors]
        if any(not signal_id for signal_id in signal_ids) or len(set(signal_ids)) != len(signal_ids):
            raise ValueError("Recorded signal ids must be non-empty and unique")
        if any(not isinstance(signal.label, str) or not signal.label.strip() for signal in descriptors):
            raise ValueError("Recorded signals require display labels")
        with self._connect() as connection:
            cursor = connection.execute(
                """INSERT INTO runs
                   (started_at, source_id, scan_rate, status)
                   VALUES (?, ?, ?, 'recording')""",
                (
                    datetime.now().astimezone().isoformat(timespec="seconds"),
                    source_id,
                    scan_rate,
                ),
            )
            run_id = int(cursor.lastrowid)
            connection.executemany(
                """INSERT INTO run_signals
                   (run_id, signal_id, position, label, unit)
                   VALUES (?, ?, ?, ?, ?)""",
                (
                    (run_id, signal.id, position, signal.label, signal.unit)
                    for position, signal in enumerate(descriptors)
                ),
            )
            return run_id

    def add_batch(self, run_id: int, batch: SampleBatch) -> None:
        if isinstance(batch.start_index, bool) or not isinstance(batch.start_index, int) or batch.start_index < 0:
            raise ValueError("Acquisition batch start index must be a non-negative integer")
        count = batch.sample_count
        if count <= 0:
            return
        with self._connect() as connection:
            expected = {
                row["signal_id"]
                for row in connection.execute(
                    "SELECT signal_id FROM run_signals WHERE run_id = ?", (run_id,)
                )
            }
            received = set(batch.samples)
            if received != expected:
                missing = sorted(expected - received)
                extra = sorted(received - expected)
                raise ValueError(
                    f"Acquisition batch signal mismatch; missing={missing}, extra={extra}"
                )
            rows = []
            for signal_id, values in batch.samples.items():
                numbers = [float(value) for value in values]
                finite = [value for value in numbers if math.isfinite(value)]
                rows.append(
                    (
                        run_id,
                        signal_id,
                        batch.start_index,
                        count,
                        len(finite),
                        min(finite) if finite else None,
                        max(finite) if finite else None,
                        sum(finite),
                        pack_values(numbers),
                    )
                )
            connection.executemany(
                """INSERT INTO sample_chunks
                   (run_id, signal_id, start_index, sample_count, valid_count,
                    minimum, maximum, total, values_blob)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                rows,
            )
            connection.execute(
                "UPDATE runs SET sample_count = MAX(sample_count, ?) WHERE id = ?",
                (batch.start_index + count, run_id),
            )

    def finish_run(self, run_id: int, status: str, sample_count: int, error: str | None) -> None:
        with self._connect() as connection:
            connection.execute(
                """UPDATE runs SET ended_at = ?, status = ?, sample_count = ?, error = ?
                   WHERE id = ?""",
                (
                    datetime.now().astimezone().isoformat(timespec="seconds"),
                    status,
                    sample_count,
                    error,
                    run_id,
                ),
            )

    def list_runs(self) -> list[dict]:
        with self._connect() as connection:
            rows = connection.execute("SELECT * FROM runs ORDER BY id DESC").fetchall()
        return [dict(row) for row in rows]

    def get_run(self, run_id: int) -> dict | None:
        with self._connect() as connection:
            row = connection.execute("SELECT * FROM runs WHERE id = ?", (run_id,)).fetchone()
            if not row:
                return None
            signals = connection.execute(
                """SELECT signal_id AS id, label, unit
                   FROM run_signals WHERE run_id = ? ORDER BY position""",
                (run_id,),
            ).fetchall()
        return {**dict(row), "signals": [dict(signal) for signal in signals]}

    def delete_run(self, run_id: int) -> bool:
        with self._connect() as connection:
            cursor = connection.execute("DELETE FROM runs WHERE id = ?", (run_id,))
            return cursor.rowcount > 0

    def sample_window(
        self, run_id: int, start: int, end: int, points: int,
    ) -> list[dict]:
        run = self.get_run(run_id)
        if not run or end <= start or not run["signals"]:
            return []
        bucket_size = max(1, (end - start + points - 1) // points)
        buckets: dict[int, dict] = {}
        with self._connect() as connection:
            for signal in run["signals"]:
                chunks = connection.execute(
                    """SELECT * FROM sample_chunks
                       WHERE run_id = ? AND signal_id = ?
                         AND start_index < ?
                         AND start_index + sample_count > ?
                       ORDER BY start_index""",
                    (run_id, signal["id"], end, start),
                ).fetchall()
                for chunk in chunks:
                    accumulate_chunk(
                        buckets,
                        signal["id"],
                        chunk,
                        start=start,
                        end=end,
                        bucket_size=bucket_size,
                    )
        rows = []
        for bucket_index in sorted(buckets):
            bucket = buckets[bucket_index]
            values = {}
            for signal in run["signals"]:
                stats = bucket["signals"].get(signal["id"])
                if not stats or not stats["count"]:
                    continue
                values[signal["id"]] = {
                    "min": stats["min"],
                    "max": stats["max"],
                    "mean": stats["sum"] / stats["count"],
                }
            rows.append(
                {
                    "sample_index": bucket["sample_index"],
                    "sample_end": bucket["sample_end"],
                    "sample_count": bucket["sample_end"] - bucket["sample_index"],
                    "values": values,
                }
            )
        return rows

    def csv_rows(self, run_id: int) -> Iterator[str]:
        run = self.get_run(run_id)
        if not run:
            return
        signal_ids = [signal["id"] for signal in run["signals"]]
        yield csv_line(["time_s", *signal_ids])
        with self._connect() as connection:
            rows = connection.execute(
                """SELECT c.start_index, c.sample_count, c.signal_id, c.values_blob
                   FROM sample_chunks AS c
                   JOIN run_signals AS s
                     ON s.run_id = c.run_id AND s.signal_id = c.signal_id
                   WHERE c.run_id = ?
                   ORDER BY c.start_index, s.position""",
                (run_id,),
            )
            for start_index, group in groupby(rows, key=lambda row: int(row["start_index"])):
                chunks = list(group)
                by_signal = {row["signal_id"]: unpack_values(row["values_blob"]) for row in chunks}
                count = int(chunks[0]["sample_count"]) if chunks else 0
                for offset in range(count):
                    yield csv_line(
                        [
                            f"{(start_index + offset) / run['scan_rate']:.9f}",
                            *[
                                f"{by_signal[signal_id][offset]:.12g}"
                                for signal_id in signal_ids
                            ],
                        ]
                    )

    def backup_bytes(self) -> bytes:
        with NamedTemporaryFile(suffix=".sqlite3") as temporary:
            import sqlite3
            with self._connect() as source, sqlite3.connect(temporary.name) as target:
                source.backup(target)
            temporary.seek(0)
            return temporary.read()

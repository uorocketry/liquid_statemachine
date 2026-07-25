"""Durable acquisition runs backed by the Python standard-library SQLite driver."""

from __future__ import annotations

import sqlite3
from datetime import datetime
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Iterator

class RunRepository:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        # StreamingResponse may resume its iterator on a different worker thread.
        # Each connection is private to one operation and SQLite serializes its use.
        connection = sqlite3.connect(self.path, timeout=15, check_same_thread=False)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.execute("PRAGMA journal_mode = WAL")
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS runs (
                    id INTEGER PRIMARY KEY,
                    started_at TEXT NOT NULL,
                    ended_at TEXT,
                    scan_rate INTEGER NOT NULL,
                    status TEXT NOT NULL,
                    sample_count INTEGER NOT NULL DEFAULT 0,
                    error TEXT
                );
                CREATE TABLE IF NOT EXISTS samples (
                    run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
                    sample_index INTEGER NOT NULL,
                    channel_a REAL NOT NULL,
                    channel_b REAL NOT NULL,
                    PRIMARY KEY (run_id, sample_index)
                ) WITHOUT ROWID;
                CREATE INDEX IF NOT EXISTS samples_run_index
                    ON samples(run_id, sample_index);
                """
            )
            connection.execute(
                """UPDATE runs SET status = 'interrupted', ended_at = ?
                   WHERE status = 'recording'""",
                (datetime.now().astimezone().isoformat(timespec="seconds"),),
            )

    def start_run(self, scan_rate: int) -> int:
        with self._connect() as connection:
            cursor = connection.execute(
                """INSERT INTO runs
                   (started_at, scan_rate, status)
                   VALUES (?, ?, 'recording')""",
                (
                    datetime.now().astimezone().isoformat(timespec="seconds"),
                    scan_rate,
                ),
            )
            return int(cursor.lastrowid)

    def add_samples(
        self, run_id: int, start_index: int, channel_a: list[float], channel_b: list[float]
    ) -> None:
        rows = (
            (run_id, start_index + offset, value_a, value_b)
            for offset, (value_a, value_b) in enumerate(zip(channel_a, channel_b))
        )
        with self._connect() as connection:
            connection.executemany(
                "INSERT INTO samples VALUES (?, ?, ?, ?)", rows
            )
            connection.execute(
                "UPDATE runs SET sample_count = ? WHERE id = ?",
                (start_index + min(len(channel_a), len(channel_b)), run_id),
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
        return dict(row) if row else None

    def delete_run(self, run_id: int) -> bool:
        with self._connect() as connection:
            cursor = connection.execute("DELETE FROM runs WHERE id = ?", (run_id,))
            return cursor.rowcount > 0

    def sample_window(
        self, run_id: int, start: int, end: int, points: int,
    ) -> list[dict]:
        width = max(1, end - start)
        bucket = max(1, (width + points - 1) // points)
        with self._connect() as connection:
            rows = connection.execute(
                """SELECT MIN(sample_index) AS sample_index,
                          MAX(sample_index) + 1 AS sample_end,
                          COUNT(*) AS sample_count,
                          MIN(channel_a) AS a_min, MAX(channel_a) AS a_max,
                          AVG(channel_a) AS a_mean,
                          MIN(channel_b) AS b_min, MAX(channel_b) AS b_max,
                          AVG(channel_b) AS b_mean
                   FROM samples
                   WHERE run_id = ? AND sample_index >= ? AND sample_index < ?
                   GROUP BY CAST((sample_index - ?) / ? AS INTEGER)
                   ORDER BY sample_index""",
                (run_id, start, end, start, bucket),
            ).fetchall()
        return [dict(row) for row in rows]

    def csv_rows(self, run_id: int) -> Iterator[str]:
        run = self.get_run(run_id)
        if not run:
            return
        yield "time_s,ain0_minus_ain1_v,ain2_minus_ain3_v\r\n"
        with self._connect() as connection:
            cursor = connection.execute(
                """SELECT sample_index, channel_a, channel_b FROM samples
                   WHERE run_id = ? ORDER BY sample_index""",
                (run_id,),
            )
            for index, channel_a, channel_b in cursor:
                yield f"{index / run['scan_rate']:.9f},{channel_a:.12g},{channel_b:.12g}\r\n"

    def backup_bytes(self) -> bytes:
        with NamedTemporaryFile(suffix=".sqlite3") as temporary:
            with self._connect() as source, sqlite3.connect(temporary.name) as target:
                source.backup(target)
            temporary.seek(0)
            return temporary.read()

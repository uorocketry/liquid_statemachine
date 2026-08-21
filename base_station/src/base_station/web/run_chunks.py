"""Binary chunk codec and bounded-window aggregation for recorded runs."""

from __future__ import annotations

import csv
import math
import sys
from array import array
from io import StringIO
from typing import Sequence


def accumulate_chunk(
    buckets: dict[int, dict],
    signal_id: str,
    chunk,
    *,
    start: int,
    end: int,
    bucket_size: int,
) -> None:
    chunk_start = int(chunk["start_index"])
    chunk_end = chunk_start + int(chunk["sample_count"])
    clipped_start = max(start, chunk_start)
    clipped_end = min(end, chunk_end)
    first_bucket = (clipped_start - start) // bucket_size
    last_bucket = (clipped_end - 1 - start) // bucket_size
    if clipped_start == chunk_start and clipped_end == chunk_end and first_bucket == last_bucket:
        target = bucket(buckets, first_bucket, start, end, bucket_size)
        merge_stats(
            target["signals"],
            signal_id,
            int(chunk["valid_count"]),
            chunk["minimum"],
            chunk["maximum"],
            float(chunk["total"]),
        )
        return

    values = unpack_values(chunk["values_blob"])
    for sample_index in range(clipped_start, clipped_end):
        value = values[sample_index - chunk_start]
        if not math.isfinite(value):
            continue
        bucket_index = (sample_index - start) // bucket_size
        target = bucket(buckets, bucket_index, start, end, bucket_size)
        merge_stats(target["signals"], signal_id, 1, value, value, value)


def bucket(
    buckets: dict[int, dict], index: int, start: int, end: int, bucket_size: int
) -> dict:
    bucket_start = start + index * bucket_size
    return buckets.setdefault(
        index,
        {
            "sample_index": bucket_start,
            "sample_end": min(end, bucket_start + bucket_size),
            "signals": {},
        },
    )


def merge_stats(
    signals: dict,
    signal_id: str,
    count: int,
    minimum: float | None,
    maximum: float | None,
    total: float,
) -> None:
    if count <= 0 or minimum is None or maximum is None:
        return
    stats = signals.setdefault(
        signal_id,
        {"count": 0, "min": float(minimum), "max": float(maximum), "sum": 0.0},
    )
    stats["count"] += count
    stats["min"] = min(stats["min"], float(minimum))
    stats["max"] = max(stats["max"], float(maximum))
    stats["sum"] += total


def pack_values(values: Sequence[float]) -> bytes:
    packed = array("d", values)
    if sys.byteorder != "little":
        packed.byteswap()
    return packed.tobytes()


def unpack_values(blob: bytes) -> array:
    values = array("d")
    values.frombytes(blob)
    if sys.byteorder != "little":
        values.byteswap()
    return values


def csv_line(values: Sequence[object]) -> str:
    stream = StringIO(newline="")
    csv.writer(stream, lineterminator="\r\n").writerow(values)
    return stream.getvalue()

"""Source-agnostic acquisition data contracts."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping, Sequence


@dataclass(frozen=True)
class SignalDescriptor:
    """Stable metadata for one aligned acquisition signal."""

    id: str
    label: str
    unit: str = ""


@dataclass(frozen=True)
class SampleBatch:
    """One aligned block of samples keyed by SignalDescriptor.id."""

    start_index: int
    samples: Mapping[str, Sequence[float]]

    @property
    def sample_count(self) -> int:
        lengths = {len(values) for values in self.samples.values()}
        if not lengths:
            return 0
        if len(lengths) != 1:
            raise ValueError("Acquisition batch signals must have equal lengths")
        return lengths.pop()

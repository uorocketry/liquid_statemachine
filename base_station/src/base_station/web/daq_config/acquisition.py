"""Graph-wide LabJack acquisition settings."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping, Sequence

DEFAULT_SCAN_RATE = 1000
DEFAULT_RESOLUTION_INDEX = 0
DEFAULT_SETTLING_US = 0.0


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


def normalize_acquisition_metadata(graph: dict) -> None:
    """Ensure the current graph-wide acquisition settings exist."""
    metadata = graph.setdefault("metadata", {})
    metadata.setdefault("scanRate", DEFAULT_SCAN_RATE)
    metadata.setdefault("streamResolutionIndex", DEFAULT_RESOLUTION_INDEX)
    metadata.setdefault("streamSettlingUs", DEFAULT_SETTLING_US)
    metadata.setdefault("mux80Enabled", False)


def preview_resolution_index(metadata: dict) -> int:
    """Approximate stream Auto (0) during command-response preview."""
    resolution = int(metadata.get("streamResolutionIndex", DEFAULT_RESOLUTION_INDEX))
    return 1 if resolution == 0 else resolution

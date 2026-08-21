"""Canonical LabJack acquisition policy independent from graph topology."""

from __future__ import annotations

from copy import deepcopy
from math import isfinite


DEFAULT_LABJACK_SETTINGS = {
    "scanRate": 1000,
    "resolutionIndex": 0,
    "settlingUs": 0.0,
    "mux80Enabled": False,
}


def normalize_labjack_settings(settings: object) -> dict:
    """Return only current LabJack setting keys, applying defaults when missing."""
    source = settings if isinstance(settings, dict) else {}
    return {
        key: deepcopy(source[key]) if key in source else deepcopy(default)
        for key, default in DEFAULT_LABJACK_SETTINGS.items()
    }


def validate_labjack_settings(settings: object) -> list[str]:
    config = normalize_labjack_settings(settings)
    issues: list[str] = []
    scan_rate = config["scanRate"]
    resolution = config["resolutionIndex"]
    settling = config["settlingUs"]
    mux80 = config["mux80Enabled"]
    if not _integer(scan_rate) or not 1 <= int(scan_rate) <= 100_000:
        issues.append("Scan rate must be between 1 and 100,000 samples/s")
    if not _integer(resolution) or int(resolution) not in range(9):
        issues.append("Stream resolution must be Auto or index 1 through 8")
    if not _finite(settling) or float(settling) < 0:
        issues.append("Stream settling time cannot be negative")
    if not isinstance(mux80, bool):
        issues.append("MUX80 enabled must be true or false")
    return issues


def preview_resolution_index(settings: dict) -> int:
    """Approximate stream Auto (0) during command-response preview."""
    resolution = int(settings.get("resolutionIndex", 0))
    return 1 if resolution == 0 else resolution


def _integer(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _finite(value: object) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and isfinite(float(value))
    )

"""Graph-wide LabJack stream acquisition settings and migration helpers."""

from __future__ import annotations

MEASUREMENT_TYPES = {"labjack-ain", "labjack-current", "labjack-thermocouple"}
DEFAULT_SCAN_RATE = 1000
DEFAULT_RESOLUTION_INDEX = 0
DEFAULT_SETTLING_US = 0.0


def normalize_acquisition_metadata(graph: dict) -> None:
    """Lift legacy per-node stream settings into graph metadata."""
    metadata = graph.setdefault("metadata", {})
    nodes = [
        node for node in graph.get("nodes", [])
        if isinstance(node, dict) and node.get("nodeType") in MEASUREMENT_TYPES
    ]
    metadata.setdefault("scanRate", DEFAULT_SCAN_RATE)
    metadata.setdefault(
        "streamResolutionIndex",
        _common_node_setting(nodes, "resolutionIndex", DEFAULT_RESOLUTION_INDEX),
    )
    metadata.setdefault(
        "streamSettlingUs",
        _common_node_setting(nodes, "settlingUs", DEFAULT_SETTLING_US),
    )
    for node in nodes:
        config = node.get("config")
        if not isinstance(config, dict):
            continue
        config.pop("resolutionIndex", None)
        config.pop("settlingUs", None)


def preview_resolution_index(metadata: dict) -> int:
    """Approximate stream Auto (0) during command-response preview."""
    resolution = int(metadata.get("streamResolutionIndex", DEFAULT_RESOLUTION_INDEX))
    return 1 if resolution == 0 else resolution


def _common_node_setting(nodes: list[dict], key: str, default: int | float) -> int | float:
    values = {
        node.get("config", {}).get(key)
        for node in nodes
        if isinstance(node.get("config"), dict) and node.get("config", {}).get(key) is not None
    }
    return values.pop() if len(values) == 1 else default

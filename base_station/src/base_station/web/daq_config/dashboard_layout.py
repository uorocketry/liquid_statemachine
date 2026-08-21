"""Canonical dashboard layout metadata for operator widgets."""

from __future__ import annotations

from copy import deepcopy

from base_station.web.daq_config.node_specs import DASHBOARD_NODE_TYPES


DASHBOARD_COLUMNS = 12
DASHBOARD_MAX_ROWS_PER_ITEM = 12

DEFAULT_SIZES = {
    "number": (3, 1),
    "gauge": (4, 4),
    "time-plot": (6, 4),
}

MIN_SIZES = {
    "number": (2, 1),
    "gauge": (3, 4),
    "time-plot": (4, 3),
}


def normalize_dashboard_layout(graph: dict) -> None:
    """Keep one current, non-overlapping layout entry per dashboard node."""
    metadata = graph.setdefault("metadata", {})
    source_layout = metadata.get("dashboardLayout")
    source_items = source_layout.get("items", {}) if isinstance(source_layout, dict) else {}
    if not isinstance(source_items, dict):
        source_items = {}

    dashboard_nodes = [
        node for node in graph.get("nodes", [])
        if isinstance(node, dict) and node.get("nodeType") in DASHBOARD_NODE_TYPES
    ]
    if not source_items:
        dashboard_nodes.sort(key=lambda node: 0 if node.get("nodeType") == "number" else 1)

    items: dict[str, dict] = {}
    occupied: list[dict] = []
    for node in dashboard_nodes:
        node_id = str(node.get("id", "")).strip()
        if not node_id:
            continue
        item = _normalize_item(node, source_items.get(node_id))
        if item["visible"]:
            if _collides(item, occupied):
                item["x"], item["y"] = _first_open_position(item["w"], item["h"], occupied)
            occupied.append(item)
        items[node_id] = item

    metadata["dashboardLayout"] = {"items": items}


def _normalize_item(node: dict, source: object) -> dict:
    node_type = str(node.get("nodeType", ""))
    default_w, default_h = DEFAULT_SIZES[node_type]
    min_w, min_h = MIN_SIZES[node_type]
    raw = source if isinstance(source, dict) else {}

    width = _bounded_int(raw.get("w"), default_w, min_w, DASHBOARD_COLUMNS)
    height = _bounded_int(raw.get("h"), default_h, min_h, DASHBOARD_MAX_ROWS_PER_ITEM)
    x = _bounded_int(raw.get("x"), 0, 0, max(0, DASHBOARD_COLUMNS - width))
    y = _bounded_int(raw.get("y"), 0, 0, 10_000)
    visible = raw.get("visible") if isinstance(raw.get("visible"), bool) else True
    return {"x": x, "y": y, "w": width, "h": height, "visible": visible}


def _bounded_int(value: object, fallback: int, minimum: int, maximum: int) -> int:
    number = value if isinstance(value, int) and not isinstance(value, bool) else fallback
    return max(minimum, min(maximum, number))


def _first_open_position(width: int, height: int, occupied: list[dict]) -> tuple[int, int]:
    for y in range(0, 10_001):
        for x in range(0, DASHBOARD_COLUMNS - width + 1):
            candidate = {"x": x, "y": y, "w": width, "h": height}
            if not _collides(candidate, occupied):
                return x, y
    return 0, 0


def _collides(candidate: dict, occupied: list[dict]) -> bool:
    return any(_overlaps(candidate, other) for other in occupied)


def _overlaps(first: dict, second: dict) -> bool:
    return not (
        first["x"] + first["w"] <= second["x"]
        or second["x"] + second["w"] <= first["x"]
        or first["y"] + first["h"] <= second["y"]
        or second["y"] + second["h"] <= first["y"]
    )


def copy_layout(graph: dict) -> dict:
    """Return a detached layout payload for API responses."""
    return deepcopy(graph.get("metadata", {}).get("dashboardLayout", {"items": {}}))

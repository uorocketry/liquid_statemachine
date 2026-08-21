"""Canonical dashboard layout for operator widgets."""

from __future__ import annotations

from copy import deepcopy
from math import floor

from base_station.web.daq_config.node_specs import DASHBOARD_NODE_TYPES


DASHBOARD_PACK_COLUMNS = 12
DASHBOARD_MAX_ITEM_WIDTH = 24
DASHBOARD_MAX_ROWS_PER_ITEM = 12
DASHBOARD_WORLD_LIMIT = 10_000
VIEW_SLOTS = ("1", "2", "3")
VIEW_SNAP = 0.25
VIEW_MIN_SPAN = 0.25
VIEW_MAX_SPAN = DASHBOARD_WORLD_LIMIT * 2

DEFAULT_SIZES = {
    "number": (3, 1),
    "gauge": (4, 4),
    "time-plot": (6, 4),
}

MIN_SIZES = {
    "number": (2, 1),
    "gauge": (3, 4),
    "time-plot": (5, 4),
}


def normalize_dashboard_layout(graph: dict, layout: object) -> dict:
    """Keep one bounded layout entry per dashboard node with stable z-order."""
    source_layout = layout if isinstance(layout, dict) else {}
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
    missing: list[tuple[int, dict]] = []
    order: dict[str, int] = {}
    for index, node in enumerate(dashboard_nodes):
        node_id = str(node.get("id", "")).strip()
        if not node_id:
            continue
        order[node_id] = index
        raw = source_items.get(node_id)
        if isinstance(raw, dict):
            items[node_id] = _normalize_item(node, raw, fallback_xy=(0, 0), fallback_z=index)
        else:
            missing.append((index, node))

    _place_missing_items(items, missing)
    _normalize_z(items, order)
    return {
        "items": items,
        "views": _normalize_views(source_layout.get("views")),
    }


def _normalize_item(
    node: dict,
    source: object,
    *,
    fallback_xy: tuple[int, int],
    fallback_z: int,
) -> dict:
    node_type = str(node.get("nodeType", ""))
    default_w, default_h = DEFAULT_SIZES[node_type]
    min_w, min_h = MIN_SIZES[node_type]
    raw = source if isinstance(source, dict) else {}

    width = _bounded_int(raw.get("w"), default_w, min_w, DASHBOARD_MAX_ITEM_WIDTH)
    height = _bounded_int(raw.get("h"), default_h, min_h, DASHBOARD_MAX_ROWS_PER_ITEM)
    x = _bounded_int(raw.get("x"), fallback_xy[0], -DASHBOARD_WORLD_LIMIT, DASHBOARD_WORLD_LIMIT)
    y = _bounded_int(raw.get("y"), fallback_xy[1], -DASHBOARD_WORLD_LIMIT, DASHBOARD_WORLD_LIMIT)
    z = _bounded_int(raw.get("z"), fallback_z, 0, 10_000)
    visible = raw.get("visible") if isinstance(raw.get("visible"), bool) else True
    return {"x": x, "y": y, "w": width, "h": height, "z": z, "visible": visible}


def _place_missing_items(items: dict[str, dict], missing: list[tuple[int, dict]]) -> None:
    if not missing:
        return
    y = max((item["y"] + item["h"] for item in items.values()), default=0)
    x = 0
    row_height = 0
    for index, node in missing:
        node_type = str(node.get("nodeType", ""))
        width, height = DEFAULT_SIZES[node_type]
        if x and x + width > DASHBOARD_PACK_COLUMNS:
            x = 0
            y += row_height
            row_height = 0
        node_id = str(node.get("id", "")).strip()
        items[node_id] = _normalize_item(
            node,
            {},
            fallback_xy=(x, y),
            fallback_z=index,
        )
        x += width
        row_height = max(row_height, height)


def _normalize_z(items: dict[str, dict], order: dict[str, int]) -> None:
    ranked = sorted(
        items.items(),
        key=lambda pair: (pair[1]["z"], order.get(pair[0], 0)),
    )
    for z, (_, item) in enumerate(ranked):
        item["z"] = z


def _bounded_int(value: object, fallback: int, minimum: int, maximum: int) -> int:
    number = value if isinstance(value, int) and not isinstance(value, bool) else fallback
    return max(minimum, min(maximum, number))


def _normalize_views(source: object) -> dict[str, dict]:
    raw = source if isinstance(source, dict) else {}
    views: dict[str, dict] = {}
    for slot in VIEW_SLOTS:
        candidate = raw.get(slot)
        if not isinstance(candidate, dict):
            continue
        x = _bounded_view_float(candidate.get("x"), -DASHBOARD_WORLD_LIMIT, DASHBOARD_WORLD_LIMIT)
        y = _bounded_view_float(candidate.get("y"), -DASHBOARD_WORLD_LIMIT, DASHBOARD_WORLD_LIMIT)
        width = _bounded_view_float(candidate.get("w"), VIEW_MIN_SPAN, VIEW_MAX_SPAN)
        height = _bounded_view_float(candidate.get("h"), VIEW_MIN_SPAN, VIEW_MAX_SPAN)
        if x is None or y is None or width is None or height is None:
            continue
        views[slot] = {"x": x, "y": y, "w": width, "h": height}
    return views


def _bounded_float(value: object, minimum: float, maximum: float) -> float | None:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return None
    return max(minimum, min(maximum, float(value)))


def _bounded_view_float(value: object, minimum: float, maximum: float) -> float | None:
    bounded = _bounded_float(value, minimum, maximum)
    if bounded is None:
        return None
    snapped = floor(bounded / VIEW_SNAP + 0.5) * VIEW_SNAP
    return max(minimum, min(maximum, round(snapped, 10)))


def copy_layout(layout: object) -> dict:
    """Return a detached layout payload for API responses."""
    source = layout if isinstance(layout, dict) else {"items": {}, "views": {}}
    return deepcopy(source)

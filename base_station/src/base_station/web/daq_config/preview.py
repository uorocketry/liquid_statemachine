"""Evaluate host-side graph transforms for low-rate configuration previews."""

from __future__ import annotations

from time import monotonic
from typing import TYPE_CHECKING

from base_station.web.daq_config.labjack_source import read_physical_sources
from base_station.web.daq_config.node_runtime import evaluate_spec_node
from base_station.web.daq_config.node_specs import SPEC_NODE_TYPES
from base_station.web.daq_config.signal_math import (
    linear_map,
    load_cell,
    scalar,
)

if TYPE_CHECKING:
    from base_station.web.labjack_service import LabJackService


def preview_graph(
    service: LabJackService,
    graph: dict,
    labjack_settings: dict,
    *,
    now_s: float | None = None,
) -> dict:
    values, errors = read_physical_sources(service, graph, labjack_settings)
    incoming = _incoming_links(graph)
    timestamp = monotonic() if now_s is None else float(now_s)
    sample_rate_hz = float(labjack_settings.get("scanRate", 1000))
    pending = {
        node["id"]: node
        for node in graph.get("nodes", [])
        if node.get("id") not in values and node.get("nodeType") != "labjack-channel"
    }
    for _ in range(len(pending) + 1):
        progressed = False
        for node_id, node in list(pending.items()):
            result = _evaluate_node(
                node, incoming.get(node_id, {}), values,
                timestamp=timestamp, sample_rate_hz=sample_rate_hz,
            )
            if result is None:
                continue
            values[node_id] = result
            del pending[node_id]
            progressed = True
        if not progressed:
            break
    return {"values": values, "errors": errors, "unresolved": list(pending)}


def _incoming_links(graph: dict) -> dict[str, dict[str, str]]:
    incoming: dict[str, dict[str, str]] = {}
    for link in graph.get("links", []):
        incoming.setdefault(link["toNode"], {})[link["toPin"]] = link["fromNode"]
    return incoming


def _evaluate_node(
    node: dict,
    incoming: dict[str, str],
    values: dict,
    *,
    timestamp: float,
    sample_rate_hz: float,
) -> dict | None:
    node_type = node.get("nodeType")
    config = node.get("config", {})
    if node_type in SPEC_NODE_TYPES:
        return evaluate_spec_node(
            node,
            incoming,
            values,
            timestamp=timestamp,
            sample_rate_hz=sample_rate_hz,
        )
    if node_type == "pressure-calibration":
        source = _input_value(incoming, values, "input")
        if source is None:
            return None
        low = _input_or_literal(incoming, values, "inputMin", config.get("inputMin"))
        high = _input_or_literal(incoming, values, "inputMax", config.get("inputMax"))
        psi_min = _input_or_literal(incoming, values, "psiMin", config.get("psiMin"))
        psi_max = _input_or_literal(incoming, values, "psiMax", config.get("psiMax"))
        if None in {low, high, psi_min, psi_max}:
            return None
        low = float(low)
        high = float(high)
        if high == low:
            return None
        psi = scalar(linear_map(
            source["value"], low, high, float(psi_min), float(psi_max)
        ))
        return {"value": psi, "unit": "psi"}
    if node_type == "load-cell":
        source = _input_value(incoming, values, "input")
        if source is None:
            return None
        excitation = _input_or_literal(incoming, values, "excitation", config.get("excitationV"))
        rated_mv_v = _input_or_literal(incoming, values, "ratedOutputMvV", config.get("ratedOutputMvV"))
        capacity = _input_or_literal(incoming, values, "capacity", config.get("capacity"))
        zero = _input_or_literal(incoming, values, "zeroV", config.get("zeroV"))
        if None in {excitation, rated_mv_v, capacity, zero}:
            return None
        excitation = float(excitation)
        capacity = float(capacity)
        zero = float(zero)
        if excitation <= 0 or float(rated_mv_v) <= 0:
            return None
        output = scalar(load_cell(
            source["value"],
            excitation_v=excitation,
            rated_output_mv_v=float(rated_mv_v),
            zero_v=zero,
            capacity=capacity,
        ))
        return {"value": output, "unit": config.get("unit", "kg")}
    return None


def _input_value(incoming: dict[str, str], values: dict, pin: str) -> dict | None:
    source_id = incoming.get(pin)
    return values.get(source_id) if source_id else None


def _input_or_literal(incoming: dict[str, str], values: dict, pin: str, literal: object) -> float | None:
    source = _input_value(incoming, values, pin)
    if source is not None:
        return float(source["value"])
    if isinstance(literal, (int, float)):
        return float(literal)
    return None

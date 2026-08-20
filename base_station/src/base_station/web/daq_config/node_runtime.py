"""Preview/runtime evaluation for declarative DAQ graph nodes."""

from __future__ import annotations

from base_station.web.daq_config.node_specs import DASHBOARD_NODE_TYPES, SPEC_NODE_TYPES
from base_station.web.daq_config.signal_math import (
    add,
    gain,
    moving_average,
    scalar,
    sine_wave,
    subtract,
)


def evaluate_spec_node(
    node: dict,
    incoming: dict[str, str],
    values: dict,
    *,
    timestamp: float,
    sample_rate_hz: float,
) -> dict | None:
    """Evaluate a recognized spec node, returning None when inputs are unresolved."""
    node_type = node.get("nodeType")
    if node_type not in SPEC_NODE_TYPES:
        raise ValueError(f"Unsupported declarative node type: {node_type}")
    config = node.get("config", {})

    if node_type == "sine-wave":
        value = scalar(
            sine_wave(
                timestamp,
                amplitude=float(config.get("amplitude", 1)),
                period_s=float(config.get("periodS", 4)),
                offset=float(config.get("offset", 0)),
                phase_rad=float(config.get("phaseRad", 0)),
                randomness=float(config.get("randomness", 0)),
            )
        )
        return {"value": value, "unit": config.get("unit", "V")}

    if node_type == "constant":
        return {"value": float(config.get("value", 0)), "unit": config.get("unit", "")}

    if node_type in {"add", "subtract"}:
        left = _input_value(incoming, values, "a")
        right = _input_value(incoming, values, "b")
        if left is None or right is None:
            return None
        operation = add if node_type == "add" else subtract
        return {
            "value": scalar(operation(left["value"], right["value"])),
            "unit": left.get("unit", ""),
        }

    if node_type == "gain":
        source = _input_value(incoming, values, "input")
        if source is None:
            return None
        return {
            "value": scalar(gain(source["value"], float(config.get("gain", 1)))),
            "unit": source.get("unit", ""),
        }

    if node_type == "moving-average":
        source = _input_value(incoming, values, "input")
        if source is None:
            return None
        return {
            "value": scalar(
                moving_average(
                    source["value"],
                    sample_rate_hz,
                    window_s=float(config.get("windowS", 0.5)),
                )
            ),
            "unit": source.get("unit", ""),
        }

    if node_type == "rate-of-change":
        # Scalar command/response preview has no previous sample. Acquisition
        # execution supplies history and can evaluate this node later.
        return None

    if node_type in DASHBOARD_NODE_TYPES:
        source = _input_value(incoming, values, "value")
        return source.copy() if source is not None else None

    return None


def _input_value(incoming: dict[str, str], values: dict, pin: str) -> dict | None:
    source_id = incoming.get(pin)
    return values.get(source_id) if source_id else None

"""Normalize DAQ graphs to the only supported current schema."""

from __future__ import annotations

from copy import deepcopy

from base_station.web.daq_config.acquisition import normalize_acquisition_metadata
from base_station.web.daq_config.dashboard_layout import normalize_dashboard_layout
from base_station.web.daq_config.node_specs import normalize_spec_node

CURRENT_SCHEMA_VERSION = 1


def normalize_graph(graph: dict) -> dict:
    """Return a canonical copy of a current-schema graph."""
    normalized = deepcopy(graph)
    normalized.setdefault("nodes", [])
    normalized.setdefault("links", [])
    normalize_acquisition_metadata(normalized)
    for node in normalized["nodes"]:
        if not isinstance(node, dict):
            continue
        if normalize_spec_node(node):
            continue
        _normalize_hardware_node(node)
    normalize_dashboard_layout(normalized)
    normalized["metadata"]["schemaVersion"] = CURRENT_SCHEMA_VERSION
    return normalized


def _normalize_hardware_node(node: dict) -> None:
    node_type = node.get("nodeType")
    source = node.get("config") if isinstance(node.get("config"), dict) else {}
    if node_type == "labjack-channel":
        node["config"] = _config(source, {"deviceSerial": None, "deviceIp": "192.168.8.51", "channel": "AIN0"})
        node["pins"] = [_output("channel", "Channel", "channel-ref")]
    elif node_type == "labjack-channel-pair":
        node["config"] = _config(source, {"deviceSerial": None, "deviceIp": "192.168.8.51", "channel": "AIN0"})
        node["pins"] = [_output("pair", "Pair", "channel-pair-ref")]
    elif node_type == "labjack-ain":
        node["config"] = _config(source, {"rangeV": 0.1})
        node["pins"] = [
            _input("channel", "Channel", "channel / pair", ["channel-ref", "channel-pair-ref"]),
            _output("voltage", "Voltage", "V"),
        ]
    elif node_type == "labjack-current":
        node["config"] = _config(source, {"rangeV": 10, "shuntOhms": None})
        node["pins"] = [
            _input("channel", "Channel", "channel-ref"),
            _input("shunt", "Shunt", "Ω", optional=True),
            _output("current", "Current", "A"),
        ]
    elif node_type == "labjack-thermocouple":
        node["config"] = _config(source, {"rangeV": 0.01, "thermocoupleType": ""})
        node["pins"] = [
            _input("pair", "Channel pair", "channel-pair-ref"),
            _output("temperature", "Temperature", "K"),
        ]
    elif node_type == "pressure-calibration":
        node["config"] = _config(source, {"inputMin": None, "inputMax": None, "psiMin": None, "psiMax": None})
        node["pins"] = [
            _input("input", "Sensor", "V / A", ["V", "A"]),
            _input("inputMin", "Electrical min", "V / A", ["V", "A"], optional=True),
            _input("inputMax", "Electrical max", "V / A", ["V", "A"], optional=True),
            _input("psiMin", "Pressure min", "psi", optional=True),
            _input("psiMax", "Pressure max", "psi", optional=True),
            _output("pressure", "Pressure", "psi"),
        ]
    elif node_type == "load-cell":
        config = _config(source, {
            "excitationV": None,
            "ratedOutputMvV": None,
            "capacity": None,
            "zeroV": None,
            "unit": "kg",
        })
        node["config"] = config
        unit = str(config["unit"])
        node["pins"] = [
            _input("input", "Bridge voltage", "V"),
            _input("excitation", "Excitation", "V", optional=True),
            _input("ratedOutputMvV", "Rated output", "mV/V", optional=True),
            _input("zeroV", "Zero offset", "V", optional=True),
            _input("capacity", "Capacity", unit, optional=True),
            _output("load", "Load", unit),
        ]


def _config(source: dict, defaults: dict) -> dict:
    return {
        key: deepcopy(source[key]) if key in source else deepcopy(default)
        for key, default in defaults.items()
    }


def _input(
    pin_id: str,
    label: str,
    pin_type: str,
    expected: str | list[str] | None = None,
    *,
    optional: bool = False,
) -> dict:
    return {
        "id": pin_id,
        "label": label,
        "type": pin_type,
        "expectedType": expected or pin_type,
        "direction": "input",
        "kind": "data",
        **({"optional": True} if optional else {}),
    }


def _output(pin_id: str, label: str, pin_type: str) -> dict:
    return {"id": pin_id, "label": label, "type": pin_type, "direction": "output", "kind": "result"}

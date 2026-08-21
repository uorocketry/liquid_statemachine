"""Normalize the current DAQ configuration document."""

from __future__ import annotations

from copy import deepcopy

from base_station.web.daq_config.dashboard_layout import normalize_dashboard_layout
from base_station.web.daq_config.labjack_settings import normalize_labjack_settings
from base_station.web.daq_config.node_specs import normalize_spec_node

CURRENT_CONFIG_VERSION = 1


def normalize_graph(graph: dict) -> dict:
    """Return a canonical copy of a current-schema graph."""
    source = graph if isinstance(graph, dict) else {}
    normalized = {
        "nodes": deepcopy(source.get("nodes", [])) if isinstance(source.get("nodes"), list) else [],
        "links": deepcopy(source.get("links", [])) if isinstance(source.get("links"), list) else [],
    }
    for node in normalized["nodes"]:
        if not isinstance(node, dict):
            continue
        if normalize_spec_node(node):
            continue
        _normalize_hardware_node(node)
    return normalized


def normalize_config(document: object) -> dict:
    """Return the only supported current DAQ configuration document shape."""
    source = document if isinstance(document, dict) else {}
    graph = normalize_graph(source.get("graph", {}))
    sources = source.get("sources") if isinstance(source.get("sources"), dict) else {}
    labjack = normalize_labjack_settings(sources.get("labjack"))
    dashboard = source.get("dashboard") if isinstance(source.get("dashboard"), dict) else {}
    layout = normalize_dashboard_layout(graph, dashboard.get("layout"))
    return {
        "schemaVersion": CURRENT_CONFIG_VERSION,
        "graph": graph,
        "sources": {"labjack": labjack},
        "dashboard": {"layout": layout},
    }


def _normalize_hardware_node(node: dict) -> None:
    node_type = node.get("nodeType")
    source = node.get("config") if isinstance(node.get("config"), dict) else {}
    if node_type == "labjack-channel":
        node["config"] = _config(source, {"channel": "AIN0"})
        node["pins"] = [_output("channel", "Channel", "channel-ref")]
    elif node_type == "labjack-channel-pair":
        node["config"] = _config(source, {"channel": "AIN0"})
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

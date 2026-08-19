"""Upgrade persisted DAQ graphs to the current node/link schema."""

from __future__ import annotations

from copy import deepcopy

CURRENT_SCHEMA_VERSION = 4


def migrate_graph(graph: dict) -> dict:
    """Return a migrated copy while preserving user-authored node IDs/positions."""
    next_graph = deepcopy(graph)
    nodes = next_graph.setdefault("nodes", [])
    links = next_graph.setdefault("links", [])
    ids = {node.get("id") for node in nodes if isinstance(node, dict)}
    additions: list[dict] = []

    for node in list(nodes):
        if not isinstance(node, dict):
            continue
        node_type = node.get("nodeType")
        if node_type in {"labjack-ain", "labjack-current", "labjack-thermocouple"}:
            _migrate_measurement(node, additions, links, ids)

    nodes.extend(additions)
    _collapse_explicit_pairs(next_graph, ids)
    _canonicalize_nodes(next_graph)
    next_graph.setdefault("metadata", {})["schemaVersion"] = CURRENT_SCHEMA_VERSION
    return next_graph


def _canonicalize_nodes(graph: dict) -> None:
    nodes = graph.get("nodes", [])
    links = graph.get("links", [])
    for node in nodes:
        if not isinstance(node, dict):
            continue
        node_type = node.get("nodeType")
        config = node.setdefault("config", {})
        if node_type == "labjack-ain":
            _retarget_input(links, node["id"], "positive", "channel")
            node["pins"] = [
                _input("channel", "Channel", "channel / pair", ["channel-ref", "channel-pair-ref"]),
                _output("voltage", "Voltage", "V"),
            ]
        elif node_type == "labjack-current":
            node["pins"] = [
                _input("channel", "Channel", "channel-ref"),
                _input("shunt", "Shunt", "Ω", optional=True),
                _output("current", "Current", "A"),
            ]
        elif node_type == "labjack-thermocouple":
            node["pins"] = [
                _input("pair", "Channel pair", "channel-pair-ref"),
                _output("temperature", "Temperature", "K"),
            ]
        elif node_type == "labjack-channel":
            node["pins"] = [_output("channel", "Channel", "channel-ref")]
        elif node_type == "labjack-channel-pair":
            node["pins"] = [_output("pair", "Pair", "channel-pair-ref")]
        elif node_type == "pressure-calibration":
            node["pins"] = [
                _input("input", "Sensor", "V / A", ["V", "A"]),
                _input("inputMin", "Electrical min", "V / A", ["V", "A"], optional=True),
                _input("inputMax", "Electrical max", "V / A", ["V", "A"], optional=True),
                _input("psiMin", "Pressure min", "psi", optional=True),
                _input("psiMax", "Pressure max", "psi", optional=True),
                _output("pressure", "Pressure", "psi"),
            ]
        elif node_type == "load-cell":
            unit = config.get("unit", "kg")
            config.setdefault("excitationV", None)
            node["pins"] = [
                _input("input", "Bridge voltage", "V"),
                _input("excitation", "Excitation", "V", optional=True),
                _input("ratedOutputMvV", "Rated output", "mV/V", optional=True),
                _input("zeroV", "Zero offset", "V", optional=True),
                _input("capacity", "Capacity", unit, optional=True),
                _output("load", "Load", unit),
            ]
        elif node_type == "constant":
            unit = config.get("unit", "kg")
            node["pins"] = [_output("value", "Value", unit)]
        elif node_type == "subtract":
            node["pins"] = [
                _input("a", "A", "infer", "*"),
                _input("b", "B", "infer", "*"),
                _output("result", "A − B", "infer"),
            ]
        elif node_type == "rate-of-change":
            window_s = config.get("windowS", 0.5)
            config.clear()
            config["windowS"] = window_s
            node["pins"] = [
                _input("input", "Signal", "infer", "*"),
                _output("rate", "Rate", "infer"),
            ]
        elif node_type == "dashboard-signal":
            node["pins"] = [_input("value", "Value", "*", "*")]


def _retarget_input(links: list[dict], node_id: str, old_pin: str, new_pin: str) -> None:
    if any(link.get("toNode") == node_id and link.get("toPin") == new_pin for link in links):
        return
    for link in links:
        if link.get("toNode") == node_id and link.get("toPin") == old_pin:
            link["toPin"] = new_pin
            return


def _migrate_measurement(node: dict, additions: list[dict], links: list[dict], ids: set) -> None:
    config = node.get("config") if isinstance(node.get("config"), dict) else {}
    channel = config.get("channel")
    if not isinstance(channel, str):
        return
    x = float(node.get("x", 0))
    y = float(node.get("y", 0))
    if node.get("nodeType") == "labjack-current":
        positive_id = _unique(ids, f"{node['id']}-channel")
        additions.append(_channel_node(positive_id, channel, config, x - 280, y))
        links.append(_link(_unique(ids, "migrated-link"), positive_id, "channel", node["id"], "channel"))
        shunt = config.get("shuntOhms")
        if isinstance(shunt, (int, float)):
            shunt_id = _unique(ids, f"{node['id']}-shunt")
            additions.append(_constant_node(shunt_id, shunt, "Ω", x - 280, y + 100))
            links.append(_link(_unique(ids, "migrated-link"), shunt_id, "value", node["id"], "shunt"))
        node["pins"] = [
            _input("channel", "Channel", "channel-ref"),
            _input("shunt", "Shunt", "Ω"),
            _output("current", "Current", "A"),
        ]
    else:
        negative = config.get("negativeChannel")
        if isinstance(negative, str):
            pair_id = _unique(ids, f"{node['id']}-pair")
            additions.append(_pair_node(pair_id, channel, config, x - 280, y))
            target_pin = "pair" if node.get("nodeType") == "labjack-thermocouple" else "channel"
            links.append(_link(_unique(ids, "migrated-link"), pair_id, "pair", node["id"], target_pin))
        else:
            channel_id = _unique(ids, f"{node['id']}-channel")
            additions.append(_channel_node(channel_id, channel, config, x - 280, y))
            links.append(_link(_unique(ids, "migrated-link"), channel_id, "channel", node["id"], "channel"))
        if node.get("nodeType") == "labjack-ain":
            node["pins"] = [
                _input("channel", "Channel", "channel / pair", ["channel-ref", "channel-pair-ref"]),
                _output("voltage", "Voltage", "V"),
            ]
        else:
            node["pins"] = [
                _input("pair", "Channel pair", "channel-pair-ref"),
                _output("temperature", "Temperature", "K"),
            ]

    node["config"] = {
        "rangeV": config.get("rangeV", 0.1),
        "resolutionIndex": config.get("resolutionIndex", 0),
        "settlingUs": config.get("settlingUs", 0),
        **({"thermocoupleType": config.get("thermocoupleType", "")} if node.get("nodeType") == "labjack-thermocouple" else {}),
    }
    node.pop("badge", None)


def _channel_node(node_id: str, channel: str, source: dict, x: float, y: float) -> dict:
    return {
        "id": node_id,
        "nodeType": "labjack-channel",
        "title": "Channel reference",
        "glyph": "C",
        "tone": "source",
        "x": x,
        "y": y,
        "config": {
            "deviceSerial": source.get("deviceSerial"),
            "deviceIp": source.get("deviceIp", "192.168.8.51"),
            "channel": channel,
        },
        "pins": [_output("channel", "Channel", "channel-ref")],
    }


def _pair_node(node_id: str, channel: str, source: dict, x: float, y: float) -> dict:
    return {
        "id": node_id,
        "nodeType": "labjack-channel-pair",
        "title": "Channel pair",
        "glyph": "↕",
        "tone": "source",
        "x": x,
        "y": y,
        "config": {
            "deviceSerial": source.get("deviceSerial"),
            "deviceIp": source.get("deviceIp", "192.168.8.51"),
            "channel": channel,
        },
        "pins": [_output("pair", "Pair", "channel-pair-ref")],
    }


def _collapse_explicit_pairs(graph: dict, ids: set) -> None:
    nodes = graph.get("nodes", [])
    links = graph.get("links", [])
    node_map = {node.get("id"): node for node in nodes if isinstance(node, dict)}
    removals: set[str] = set()
    additions: list[dict] = []
    replacement_links: list[dict] = []

    for measurement in nodes:
        if measurement.get("nodeType") not in {"labjack-ain", "labjack-thermocouple"}:
            continue
        positive_link = next((link for link in links if link.get("toNode") == measurement.get("id") and link.get("toPin") == "positive"), None)
        negative_link = next((link for link in links if link.get("toNode") == measurement.get("id") and link.get("toPin") == "negative"), None)
        if not positive_link or not negative_link:
            continue
        positive = node_map.get(positive_link.get("fromNode"))
        negative = node_map.get(negative_link.get("fromNode"))
        if not positive or not negative or positive.get("nodeType") != "labjack-channel" or negative.get("nodeType") != "labjack-channel":
            continue
        positive_name = positive.get("config", {}).get("channel")
        negative_name = negative.get("config", {}).get("channel")
        if not _is_pair(positive_name, negative_name):
            continue
        pair_id = _unique(ids, f"{measurement['id']}-pair")
        additions.append(_pair_node(pair_id, positive_name, positive.get("config", {}), min(positive.get("x", 0), negative.get("x", 0)), min(positive.get("y", 0), negative.get("y", 0))))
        target_pin = "pair" if measurement.get("nodeType") == "labjack-thermocouple" else "channel"
        replacement_links.append(_link(_unique(ids, "migrated-link"), pair_id, "pair", measurement["id"], target_pin))
        measurement["pins"] = [
            _input(target_pin, "Channel pair" if target_pin == "pair" else "Channel", "channel-pair-ref", "channel-pair-ref"),
            _output("temperature" if target_pin == "pair" else "voltage", "Temperature" if target_pin == "pair" else "Voltage", "K" if target_pin == "pair" else "V"),
        ]
        links[:] = [link for link in links if link is not positive_link and link is not negative_link]
        for source in (positive, negative):
            if not any(link.get("fromNode") == source.get("id") for link in links):
                removals.add(source["id"])

    nodes[:] = [node for node in nodes if node.get("id") not in removals]
    nodes.extend(additions)
    links.extend(replacement_links)


def _is_pair(positive: object, negative: object) -> bool:
    if not isinstance(positive, str) or not isinstance(negative, str) or not positive.startswith("AIN"):
        return False
    number = int(positive[3:])
    expected = number + (8 if number >= 16 else 1)
    return negative == f"AIN{expected}"


def _constant_node(node_id: str, value: float, unit: str, x: float, y: float) -> dict:
    return {
        "id": node_id,
        "nodeType": "constant",
        "title": "Constant",
        "glyph": "#",
        "tone": "transform",
        "x": x,
        "y": y,
        "config": {"value": value, "unit": unit},
        "pins": [_output("value", "Value", unit)],
    }


def _input(pin_id: str, label: str, pin_type: str, expected: str | None = None, optional: bool = False) -> dict:
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


def _link(link_id: str, source: str, source_pin: str, target: str, target_pin: str) -> dict:
    return {"id": link_id, "fromNode": source, "fromPin": source_pin, "toNode": target, "toPin": target_pin, "kind": "data"}


def _unique(ids: set, stem: str) -> str:
    candidate = stem
    serial = 2
    while candidate in ids:
        candidate = f"{stem}-{serial}"
        serial += 1
    ids.add(candidate)
    return candidate

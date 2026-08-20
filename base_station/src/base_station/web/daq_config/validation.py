"""Server-side validation for DAQ blueprint documents."""

from __future__ import annotations

import re
from math import isfinite

from base_station.web.daq_config.link_validation import validate_link_types
from base_station.web.daq_config.node_specs import validate_spec_node

AIN_PATTERN = re.compile(r"^AIN(\d{1,3})$")
MEASUREMENT_TYPES = {"labjack-ain", "labjack-current", "labjack-thermocouple"}
VALID_RANGES = {10.0, 1.0, 0.1, 0.01}
THERMOCOUPLE_TYPES = {"B", "E", "J", "K", "N", "R", "S", "T", "C"}


def validate_graph(graph: object) -> list[dict[str, str]]:
    issues: list[dict[str, str]] = []
    if not isinstance(graph, dict):
        return [_issue("graph", "Configuration must be a JSON object")]
    nodes = graph.get("nodes")
    links = graph.get("links")
    if not isinstance(nodes, list) or not isinstance(links, list):
        return [_issue("graph", "Configuration requires nodes[] and links[]")]
    if len(nodes) > 250 or len(links) > 500:
        issues.append(_issue("graph", "Configuration is larger than the supported editor limit"))
    metadata = graph.get("metadata") if isinstance(graph.get("metadata"), dict) else {}
    scan_rate = metadata.get("scanRate", 1000)
    if not isinstance(scan_rate, (int, float)) or not 1 <= scan_rate <= 100_000:
        issues.append(_issue("graph", "Scan rate must be between 1 and 100,000 samples/s"))
    resolution = metadata.get("streamResolutionIndex", 0)
    if not isinstance(resolution, (int, float)) or int(resolution) not in range(9):
        issues.append(_issue("graph", "Stream resolution must be Auto or index 1 through 8"))
    settling = metadata.get("streamSettlingUs", 0)
    if not isinstance(settling, (int, float)) or settling < 0:
        issues.append(_issue("graph", "Stream settling time cannot be negative"))

    node_map: dict[str, dict] = {}
    for node in nodes:
        if not isinstance(node, dict) or not isinstance(node.get("id"), str):
            issues.append(_issue("node", "Every node requires a string id"))
            continue
        node_id = node["id"]
        if node_id in node_map:
            issues.append(_issue(node_id, "Duplicate node id"))
        node_map[node_id] = node
        if not isinstance(node.get("pins"), list):
            issues.append(_issue(node_id, "Node pins must be an array"))

    for link in links:
        if not isinstance(link, dict):
            issues.append(_issue("link", "Every link must be an object"))
            continue
        _validate_link(link, node_map, issues)
    issues.extend(validate_link_types(graph))

    incoming = _incoming_links(links)
    mux_enabled = bool(metadata.get("mux80Enabled", False))
    for node in nodes:
        if not isinstance(node, dict):
            continue
        _validate_required_inputs(node, incoming, issues)
        if node.get("nodeType") in {"labjack-channel", "labjack-channel-pair"}:
            _validate_channel(node, mux_enabled, issues)
        if node.get("nodeType") in MEASUREMENT_TYPES:
            _validate_measurement(node, node_map, incoming, issues)
        spec_messages = validate_spec_node(node)
        if spec_messages is not None:
            issues.extend(_issue(node["id"], message) for message in spec_messages)
        _validate_transform(node, node_map, incoming, issues)
    return issues


def blocking_issues(issues: list[dict[str, str]]) -> list[dict[str, str]]:
    return [issue for issue in issues if issue.get("severity") == "error"]


def _validate_required_inputs(
    node: dict,
    incoming: dict[str, dict[str, dict]],
    issues: list[dict[str, str]],
) -> None:
    node_id = node.get("id")
    if not isinstance(node_id, str):
        return
    connected = incoming.get(node_id, {})
    for pin in node.get("pins", []):
        if not isinstance(pin, dict) or pin.get("direction") != "input" or pin.get("optional"):
            continue
        pin_id = pin.get("id")
        if pin_id not in connected:
            label = str(pin.get("label") or pin_id or "Input")
            issues.append(_issue(node_id, f"{label} is not connected", severity="warning"))


def _validate_link(link: dict, nodes: dict[str, dict], issues: list[dict[str, str]]) -> None:
    source = nodes.get(link.get("fromNode"))
    target = nodes.get(link.get("toNode"))
    if source is None or target is None:
        issues.append(_issue(str(link.get("id", "link")), "Link references a missing node"))
        return
    source_pins = {pin.get("id") for pin in source.get("pins", []) if isinstance(pin, dict)}
    target_pins = {pin.get("id") for pin in target.get("pins", []) if isinstance(pin, dict)}
    if link.get("fromPin") not in source_pins or link.get("toPin") not in target_pins:
        issues.append(_issue(str(link.get("id", "link")), "Link references a missing pin"))


def _validate_channel(node: dict, mux_enabled: bool, issues: list[dict[str, str]]) -> None:
    config = node.get("config") if isinstance(node.get("config"), dict) else {}
    channel = config.get("channel")
    number = _ain_number(channel)
    if number is None:
        issues.append(_issue(node["id"], "Select a valid LabJack AIN channel"))
        return
    valid = 0 <= number <= 13 or (mux_enabled and 48 <= number <= 127)
    if not valid:
        issues.append(_issue(node["id"], "AIN channel is unavailable for the selected hardware"))
    if mux_enabled and 4 <= number <= 13:
        issues.append(_issue(node["id"], "AIN4-AIN13 are occupied when MUX80 is enabled"))
    if node.get("nodeType") == "labjack-channel-pair" and not _valid_differential_positive(number):
        issues.append(_issue(node["id"], "Selected AIN cannot start a differential pair"))



def _validate_measurement(
    node: dict,
    nodes: dict[str, dict],
    incoming: dict[str, dict[str, dict]],
    issues: list[dict[str, str]],
) -> None:
    config = node.get("config") if isinstance(node.get("config"), dict) else {}
    if float(config.get("rangeV", 0.1)) not in VALID_RANGES:
        issues.append(_issue(node["id"], "AIN range must be one of ±10, ±1, ±0.1, or ±0.01 V"))
    node_type = node.get("nodeType")
    if node_type == "labjack-current":
        _require_channel_ref(node, "channel", nodes, incoming, issues)
        shunt = _linked_constant(node, "shunt", nodes, incoming)
        literal_shunt = config.get("shuntOhms")
        if shunt is not None and shunt.get("config", {}).get("unit") != "Ω":
            issues.append(_issue(node["id"], "Shunt input must use Ω"))
        elif shunt is not None and not _positive_number(shunt.get("config", {}).get("value")):
            issues.append(_issue(node["id"], "Shunt resistance must be positive"))
        elif shunt is None and not _positive_number(literal_shunt):
            issues.append(_issue(node["id"], "Enter a positive shunt resistance or connect an Ω constant"))
        return

    if node_type == "labjack-ain":
        source = _linked_node(node, "channel", nodes, incoming)
        if source is None or source.get("nodeType") not in {"labjack-channel", "labjack-channel-pair"}:
            issues.append(_issue(node["id"], "Channel requires a channel reference or channel pair"))
    if node_type == "labjack-thermocouple":
        source = _linked_node(node, "pair", nodes, incoming)
        if source is None or source.get("nodeType") != "labjack-channel-pair":
            issues.append(_issue(node["id"], "Thermocouple requires a channel pair"))
        if config.get("thermocoupleType") not in THERMOCOUPLE_TYPES:
            issues.append(_issue(node["id"], "Unsupported thermocouple type"))


def _validate_transform(
    node: dict,
    nodes: dict[str, dict],
    incoming: dict[str, dict[str, dict]],
    issues: list[dict[str, str]],
) -> None:
    config = node.get("config") if isinstance(node.get("config"), dict) else {}
    if node.get("nodeType") == "pressure-calibration":
        points = {
            key: _literal_or_constant(node, key, config.get(key), nodes, incoming)
            for key in ("inputMin", "inputMax", "psiMin", "psiMax")
        }
        if not all(_finite_number(value) for value in points.values()):
            issues.append(_issue(node["id"], "Pressure calibration requires all four calibration values"))
        elif points["inputMin"] == points["inputMax"]:
            issues.append(_issue(node["id"], "Pressure calibration input span cannot be zero"))
    if node.get("nodeType") == "load-cell":
        rated = _literal_or_constant(node, "ratedOutputMvV", config.get("ratedOutputMvV"), nodes, incoming)
        capacity = _literal_or_constant(node, "capacity", config.get("capacity"), nodes, incoming)
        zero = _literal_or_constant(node, "zeroV", config.get("zeroV"), nodes, incoming)
        excitation = _literal_or_constant(node, "excitation", config.get("excitationV"), nodes, incoming)
        if not _positive_number(rated):
            issues.append(_issue(node["id"], "Load cell rated output must be positive"))
        if not _positive_number(capacity):
            issues.append(_issue(node["id"], "Load cell rated capacity must be positive"))
        if not _finite_number(zero):
            issues.append(_issue(node["id"], "Load cell zero offset is required"))
        if not _positive_number(excitation):
            issues.append(_issue(node["id"], "Load cell excitation must be positive"))


def _incoming_links(links: list) -> dict[str, dict[str, dict]]:
    incoming: dict[str, dict[str, dict]] = {}
    for link in links:
        if isinstance(link, dict):
            incoming.setdefault(str(link.get("toNode")), {})[str(link.get("toPin"))] = link
    return incoming


def _linked_node(
    node: dict,
    pin: str,
    nodes: dict[str, dict],
    incoming: dict[str, dict[str, dict]],
) -> dict | None:
    link = incoming.get(node["id"], {}).get(pin)
    return nodes.get(link.get("fromNode")) if link else None


def _linked_channel(node: dict, pin: str, nodes: dict[str, dict], incoming: dict[str, dict[str, dict]]) -> dict | None:
    source = _linked_node(node, pin, nodes, incoming)
    return source if source and source.get("nodeType") == "labjack-channel" else None


def _linked_constant(node: dict, pin: str, nodes: dict[str, dict], incoming: dict[str, dict[str, dict]]) -> dict | None:
    source = _linked_node(node, pin, nodes, incoming)
    return source if source and source.get("nodeType") == "constant" else None


def _literal_or_constant(
    node: dict,
    pin: str,
    literal: object,
    nodes: dict[str, dict],
    incoming: dict[str, dict[str, dict]],
) -> object:
    constant = _linked_constant(node, pin, nodes, incoming)
    if constant is not None:
        return constant.get("config", {}).get("value")
    return literal


def _require_channel_ref(
    node: dict,
    pin: str,
    nodes: dict[str, dict],
    incoming: dict[str, dict[str, dict]],
    issues: list[dict[str, str]],
) -> dict | None:
    source = _linked_channel(node, pin, nodes, incoming)
    if source is None:
        issues.append(_issue(node["id"], f"{pin.title()} requires a channel reference"))
    return source


def _ain_number(value: object) -> int | None:
    if not isinstance(value, str):
        return None
    match = AIN_PATTERN.fullmatch(value)
    return int(match.group(1)) if match else None


def _differential_negative(positive: int) -> int:
    if positive >= 16:
        return positive + 8
    return positive + 1


def _valid_differential_positive(channel: int) -> bool:
    if channel < 16:
        return channel % 2 == 0
    if not 48 <= channel <= 127:
        return False
    return ((channel - 48) // 8) % 2 == 0


def _issue(subject: str, message: str, severity: str = "error") -> dict[str, str]:
    return {"severity": severity, "subject": subject, "message": message}


def _finite_number(value: object) -> bool:
    return isinstance(value, (int, float)) and isfinite(float(value))


def _positive_number(value: object) -> bool:
    return _finite_number(value) and float(value) > 0

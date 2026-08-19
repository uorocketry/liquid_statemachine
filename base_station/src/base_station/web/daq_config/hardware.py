"""Low-rate command/response previews using the already-open LJM handle."""

from __future__ import annotations

from typing import TYPE_CHECKING

from base_station.web.daq_config.acquisition import preview_resolution_index

from base_station.web.daq_config.signal_math import current_from_shunt, scalar

if TYPE_CHECKING:
    from base_station.web.labjack_service import LabJackService



def read_physical_sources(service: LabJackService, graph: dict) -> tuple[dict, list[str]]:
    """Read configured physical source nodes without starting a stream."""
    sdk, constants = _sdk()
    with service.dashboard.lock:
        if service.dashboard.labjack.acquisition_state in {"starting", "running", "stopping"}:
            return {}, ["Live configuration preview is paused while acquisition is streaming"]
    with service.device_lock:
        handle = service.handle
        if handle is None:
            return {}, ["LabJack T7 is not connected"]
        values: dict[str, dict] = {}
        errors: list[str] = []
        nodes = {node.get("id"): node for node in graph.get("nodes", []) if isinstance(node, dict)}
        incoming = _incoming_links(graph)
        acquisition = graph.get("metadata") if isinstance(graph.get("metadata"), dict) else {}
        for node in graph.get("nodes", []):
            node_type = node.get("nodeType")
            if node_type not in {"labjack-ain", "labjack-current", "labjack-thermocouple"}:
                continue
            try:
                values[node["id"]] = _read_source(
                    handle, node, nodes, incoming, acquisition, sdk, constants
                )
            except Exception as error:
                errors.append(f"{node.get('title', node.get('id', 'source'))}: {error}")
        return values, errors


def _read_source(
    handle: int,
    node: dict,
    nodes: dict,
    incoming: dict,
    acquisition: dict,
    sdk,
    constants,
) -> dict:
    node_type = node["nodeType"]
    config = _measurement_config(node, nodes, incoming)
    config["resolutionIndex"] = preview_resolution_index(acquisition)
    config["settlingUs"] = float(acquisition.get("streamSettlingUs", 0))
    channel = config["channel"]
    _configure_ain(handle, channel, config, sdk)
    volts = float(sdk.eReadName(handle, channel))
    if node_type == "labjack-ain":
        return {"value": volts, "unit": "V", "rawVolts": volts}
    if node_type == "labjack-current":
        shunt = _linked_node(node, "shunt", nodes, incoming)
        shunt_ohms = shunt["config"]["value"] if shunt is not None else node.get("config", {}).get("shuntOhms")
        amps = scalar(current_from_shunt(volts, float(shunt_ohms)))
        return {"value": amps, "unit": "A", "rawVolts": volts}
    cj_temp_k = float(sdk.eReadName(handle, "TEMPERATURE_DEVICE_K"))
    tc_type = getattr(constants, f"tt{config['thermocoupleType']}")
    temperature_k = float(sdk.tcVoltsToTemp(tc_type, volts, cj_temp_k))
    return {
        "value": temperature_k,
        "unit": "K",
        "rawVolts": volts,
        "coldJunctionK": cj_temp_k,
    }


def _measurement_config(node: dict, nodes: dict, incoming: dict) -> dict:
    config = dict(node.get("config", {}))
    node_type = node.get("nodeType")
    pin = "channel" if node_type in {"labjack-current", "labjack-ain"} else "pair"
    source = _linked_node(node, pin, nodes, incoming)
    if source is None:
        raise ValueError(f"{pin.title()} is not connected")
    if node_type == "labjack-current" and source.get("nodeType") != "labjack-channel":
        raise ValueError("Current input requires a channel reference")
    if node_type == "labjack-thermocouple" and source.get("nodeType") != "labjack-channel-pair":
        raise ValueError("Thermocouple requires a channel pair")
    if node_type == "labjack-ain" and source.get("nodeType") not in {"labjack-channel", "labjack-channel-pair"}:
        raise ValueError("Analog input requires a channel reference or channel pair")
    config["channel"] = source["config"]["channel"]
    if source.get("nodeType") == "labjack-channel-pair":
        number = int(config["channel"][3:])
        config["mode"] = "differential"
        config["negativeChannel"] = f"AIN{number + (8 if number >= 16 else 1)}"
    else:
        config["mode"] = "single-ended"
    return config


def _configure_ain(handle: int, channel: str, config: dict, sdk) -> None:
    number = int(channel[3:])
    negative = 199
    if config.get("mode") == "differential":
        negative_name = config.get("negativeChannel")
        if not isinstance(negative_name, str) or not negative_name.startswith("AIN"):
            raise ValueError("Differential input requires a negative AIN channel")
        negative = int(negative_name[3:])
    names = [
        f"AIN{number}_NEGATIVE_CH",
        f"AIN{number}_RANGE",
        f"AIN{number}_RESOLUTION_INDEX",
        f"AIN{number}_SETTLING_US",
    ]
    values = [
        negative,
        float(config.get("rangeV", 0.1)),
        int(config.get("resolutionIndex", 0)),
        float(config.get("settlingUs", 0)),
    ]
    sdk.eWriteNames(handle, len(names), names, values)


def _incoming_links(graph: dict) -> dict[str, dict[str, dict]]:
    incoming: dict[str, dict[str, dict]] = {}
    for link in graph.get("links", []):
        incoming.setdefault(link["toNode"], {})[link["toPin"]] = link
    return incoming


def _linked_node(node: dict, pin: str, nodes: dict, incoming: dict) -> dict | None:
    link = incoming.get(node["id"], {}).get(pin)
    return nodes.get(link["fromNode"]) if link else None


def _sdk():
    """Load LJM lazily so unit-test discovery cannot shadow the package import."""
    from labjack import ljm
    from labjack.ljm import constants

    return ljm, constants

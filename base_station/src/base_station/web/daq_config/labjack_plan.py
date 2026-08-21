"""Compile DAQ graph hardware nodes into a LabJack acquisition plan."""

from __future__ import annotations

from dataclasses import dataclass
from math import isfinite

from base_station.web.daq_config.acquisition import SignalDescriptor


MEASUREMENT_TYPES = {"labjack-ain", "labjack-current", "labjack-thermocouple"}
THERMOCOUPLE_TYPES = frozenset({"B", "E", "J", "K", "N", "R", "S", "T", "C"})


@dataclass(frozen=True)
class LabJackChannel:
    name: str
    negative: int
    range_v: float
    resolution_index: int
    settling_us: float


@dataclass(frozen=True)
class LabJackMeasurement:
    signal: SignalDescriptor
    node_type: str
    channel: str
    shunt_ohms: float | None = None
    thermocouple_type: str | None = None


@dataclass(frozen=True)
class LabJackStreamPlan:
    scan_rate: int
    channels: tuple[LabJackChannel, ...]
    measurements: tuple[LabJackMeasurement, ...]
    source_id: str = "labjack-t7"

    @property
    def signals(self) -> tuple[SignalDescriptor, ...]:
        return tuple(measurement.signal for measurement in self.measurements)


def compile_stream_plan(graph: dict, settings: dict) -> LabJackStreamPlan:
    nodes = {
        node.get("id"): node
        for node in graph.get("nodes", [])
        if isinstance(node, dict) and isinstance(node.get("id"), str)
    }
    incoming = incoming_links(graph)
    scan_rate = integer(settings.get("scanRate", 1000), "Scan rate", minimum=1, maximum=100_000)
    resolution = integer(settings.get("resolutionIndex", 0), "Stream resolution", minimum=0, maximum=8)
    settling = number(settings.get("settlingUs", 0), "Stream settling time", minimum=0)

    channels: dict[str, LabJackChannel] = {}
    measurements: list[LabJackMeasurement] = []
    for node in graph.get("nodes", []):
        if not isinstance(node, dict) or node.get("nodeType") not in MEASUREMENT_TYPES:
            continue
        config = measurement_config(node, nodes, incoming)
        channel = config["channel"]
        channel_plan = LabJackChannel(
            name=channel,
            negative=negative_channel(config),
            range_v=float(config.get("rangeV", 0.1)),
            resolution_index=resolution,
            settling_us=settling,
        )
        previous = channels.get(channel)
        if previous is not None and previous != channel_plan:
            raise ValueError(f"{channel} has conflicting LabJack acquisition settings")
        channels.setdefault(channel, channel_plan)
        measurements.append(measurement(node, config, nodes, incoming))

    if not measurements:
        raise ValueError("DAQ graph has no LabJack measurement nodes to record")
    return LabJackStreamPlan(scan_rate, tuple(channels.values()), tuple(measurements))


def measurement(node: dict, config: dict, nodes: dict, incoming: dict) -> LabJackMeasurement:
    node_type = node["nodeType"]
    channel = config["channel"]
    unit = {"labjack-ain": "V", "labjack-current": "A", "labjack-thermocouple": "K"}[node_type]
    kind = {"labjack-ain": "voltage", "labjack-current": "current", "labjack-thermocouple": "temperature"}[node_type]
    signal = SignalDescriptor(id=node["id"], label=f"{channel} {kind}", unit=unit)
    thermocouple_type = config.get("thermocoupleType") if node_type == "labjack-thermocouple" else None
    if node_type == "labjack-thermocouple" and thermocouple_type not in THERMOCOUPLE_TYPES:
        raise ValueError("Select a supported thermocouple type before acquisition")
    return LabJackMeasurement(
        signal=signal,
        node_type=node_type,
        channel=channel,
        shunt_ohms=shunt_ohms(node, nodes, incoming) if node_type == "labjack-current" else None,
        thermocouple_type=thermocouple_type,
    )


def measurement_config(node: dict, nodes: dict, incoming: dict) -> dict:
    config = dict(node.get("config", {}))
    node_type = node.get("nodeType")
    pin = "channel" if node_type in {"labjack-current", "labjack-ain"} else "pair"
    source = linked_node(node, pin, nodes, incoming)
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
        channel_number = int(config["channel"][3:])
        config["mode"] = "differential"
        config["negativeChannel"] = f"AIN{channel_number + (8 if channel_number >= 16 else 1)}"
    else:
        config["mode"] = "single-ended"
    return config


def shunt_ohms(node: dict, nodes: dict, incoming: dict) -> float:
    shunt = linked_node(node, "shunt", nodes, incoming)
    value = shunt.get("config", {}).get("value") if shunt is not None else node.get("config", {}).get("shuntOhms")
    return number(value, "Shunt resistance", minimum=0, exclusive_minimum=True)


def negative_channel(config: dict) -> int:
    if config.get("mode") != "differential":
        return 199
    name = config.get("negativeChannel")
    if not isinstance(name, str) or not name.startswith("AIN"):
        raise ValueError("Differential input requires a negative AIN channel")
    return int(name[3:])


def incoming_links(graph: dict) -> dict[str, dict[str, dict]]:
    incoming: dict[str, dict[str, dict]] = {}
    for link in graph.get("links", []):
        incoming.setdefault(link["toNode"], {})[link["toPin"]] = link
    return incoming


def linked_node(node: dict, pin: str, nodes: dict, incoming: dict) -> dict | None:
    link = incoming.get(node["id"], {}).get(pin)
    return nodes.get(link["fromNode"]) if link else None


def number(value: object, label: str, *, minimum: float | None = None, maximum: float | None = None, exclusive_minimum: bool = False) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not isfinite(float(value)):
        raise ValueError(f"{label} must be a finite number")
    result = float(value)
    if minimum is not None and (result <= minimum if exclusive_minimum else result < minimum):
        comparison = "greater than" if exclusive_minimum else "at least"
        raise ValueError(f"{label} must be {comparison} {minimum:g}")
    if maximum is not None and result > maximum:
        raise ValueError(f"{label} must be at most {maximum:g}")
    return result


def integer(value: object, label: str, *, minimum: int, maximum: int) -> int:
    result = number(value, label, minimum=minimum, maximum=maximum)
    if not result.is_integer():
        raise ValueError(f"{label} must be an integer")
    return int(result)

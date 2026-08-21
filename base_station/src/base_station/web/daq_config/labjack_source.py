"""LabJack T7 preview and stream adapter for the DAQ graph."""

from __future__ import annotations

from dataclasses import dataclass
from math import isfinite
from threading import Event
from typing import TYPE_CHECKING, Iterator

from base_station.web.daq_config.acquisition import (
    SampleBatch,
    SignalDescriptor,
    preview_resolution_index,
)
from base_station.web.daq_config.signal_math import current_from_shunt, scalar

if TYPE_CHECKING:
    from base_station.web.labjack_service import LabJackService


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


def compile_stream_plan(graph: dict) -> LabJackStreamPlan:
    """Compile current LabJack measurement nodes into one aligned stream plan."""
    nodes = {
        node.get("id"): node
        for node in graph.get("nodes", [])
        if isinstance(node, dict) and isinstance(node.get("id"), str)
    }
    incoming = _incoming_links(graph)
    metadata = graph.get("metadata") if isinstance(graph.get("metadata"), dict) else {}
    scan_rate = _integer(metadata.get("scanRate", 1000), "Scan rate", minimum=1, maximum=100_000)
    resolution = _integer(
        metadata.get("streamResolutionIndex", 0),
        "Stream resolution",
        minimum=0,
        maximum=8,
    )
    settling = _number(metadata.get("streamSettlingUs", 0), "Stream settling time", minimum=0)

    channels: dict[str, LabJackChannel] = {}
    measurements: list[LabJackMeasurement] = []
    for node in graph.get("nodes", []):
        if not isinstance(node, dict) or node.get("nodeType") not in MEASUREMENT_TYPES:
            continue
        config = _measurement_config(node, nodes, incoming)
        channel = config["channel"]
        channel_plan = LabJackChannel(
            name=channel,
            negative=_negative_channel(config),
            range_v=float(config.get("rangeV", 0.1)),
            resolution_index=resolution,
            settling_us=settling,
        )
        previous = channels.get(channel)
        if previous is not None and previous != channel_plan:
            raise ValueError(f"{channel} has conflicting LabJack acquisition settings")
        channels.setdefault(channel, channel_plan)
        measurements.append(_measurement(node, config, nodes, incoming))

    if not measurements:
        raise ValueError("DAQ graph has no LabJack measurement nodes to record")
    return LabJackStreamPlan(
        scan_rate=scan_rate,
        channels=tuple(channels.values()),
        measurements=tuple(measurements),
    )


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
            if node.get("nodeType") not in MEASUREMENT_TYPES:
                continue
            try:
                values[node["id"]] = _read_source(
                    handle, node, nodes, incoming, acquisition, sdk, constants
                )
            except Exception as error:
                errors.append(f"{node.get('title', node.get('id', 'source'))}: {error}")
        return values, errors


def stream_batches(
    service: LabJackService,
    plan: LabJackStreamPlan,
    stop_event: Event,
) -> Iterator[SampleBatch]:
    """Yield aligned engineering-value batches until stop_event is set."""
    sdk, constants = _sdk()
    handle = service.handle
    if handle is None:
        raise RuntimeError("LabJack disconnected")
    _configure_channels(handle, plan.channels, sdk)
    addresses = sdk.namesToAddresses(len(plan.channels), [channel.name for channel in plan.channels])[0]
    scans_per_read = max(1, plan.scan_rate // 2)
    sdk.eStreamStart(handle, scans_per_read, len(addresses), addresses, plan.scan_rate)
    sample_index = 0
    try:
        while not stop_event.is_set():
            raw = sdk.eStreamRead(handle)[0]
            channel_count = len(plan.channels)
            sample_count = len(raw) // channel_count
            if sample_count <= 0:
                continue
            raw_by_channel = {
                channel.name: raw[index::channel_count][:sample_count]
                for index, channel in enumerate(plan.channels)
            }
            cjc_kelvin = (
                float(sdk.eReadName(handle, "TEMPERATURE_DEVICE_K"))
                if any(item.node_type == "labjack-thermocouple" for item in plan.measurements)
                else None
            )
            samples = {
                measurement.signal.id: _convert_measurement(
                    measurement,
                    raw_by_channel[measurement.channel],
                    sdk,
                    constants,
                    cjc_kelvin,
                )
                for measurement in plan.measurements
            }
            yield SampleBatch(start_index=sample_index, samples=samples)
            sample_index += sample_count
    finally:
        try:
            sdk.eStreamStop(handle)
        finally:
            _restore_channels(handle, plan.channels, sdk)


def _read_source(handle: int, node: dict, nodes: dict, incoming: dict, acquisition: dict, sdk, constants) -> dict:
    node_type = node["nodeType"]
    config = _measurement_config(node, nodes, incoming)
    config["resolutionIndex"] = preview_resolution_index(acquisition)
    config["settlingUs"] = float(acquisition.get("streamSettlingUs", 0))
    channel = config["channel"]
    _configure_channel(
        handle,
        LabJackChannel(
            name=channel,
            negative=_negative_channel(config),
            range_v=float(config.get("rangeV", 0.1)),
            resolution_index=int(config["resolutionIndex"]),
            settling_us=float(config["settlingUs"]),
        ),
        sdk,
    )
    volts = float(sdk.eReadName(handle, channel))
    if node_type == "labjack-ain":
        return {"value": volts, "unit": "V", "rawVolts": volts}
    if node_type == "labjack-current":
        shunt_ohms = _shunt_ohms(node, nodes, incoming)
        amps = scalar(current_from_shunt(volts, shunt_ohms))
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


def _measurement(node: dict, config: dict, nodes: dict, incoming: dict) -> LabJackMeasurement:
    node_type = node["nodeType"]
    channel = config["channel"]
    unit = {"labjack-ain": "V", "labjack-current": "A", "labjack-thermocouple": "K"}[node_type]
    kind = {"labjack-ain": "voltage", "labjack-current": "current", "labjack-thermocouple": "temperature"}[node_type]
    signal = SignalDescriptor(
        id=node["id"],
        label=f"{channel} {kind}",
        unit=unit,
    )
    thermocouple_type = config.get("thermocoupleType") if node_type == "labjack-thermocouple" else None
    if node_type == "labjack-thermocouple" and thermocouple_type not in THERMOCOUPLE_TYPES:
        raise ValueError("Select a supported thermocouple type before acquisition")
    return LabJackMeasurement(
        signal=signal,
        node_type=node_type,
        channel=channel,
        shunt_ohms=_shunt_ohms(node, nodes, incoming) if node_type == "labjack-current" else None,
        thermocouple_type=thermocouple_type,
    )


def _convert_measurement(measurement: LabJackMeasurement, raw: list[float], sdk, constants, cjc_kelvin: float | None) -> list[float]:
    if measurement.node_type == "labjack-ain":
        return [float(value) for value in raw]
    if measurement.node_type == "labjack-current":
        return [float(value) for value in current_from_shunt(raw, float(measurement.shunt_ohms))]
    if cjc_kelvin is None or not measurement.thermocouple_type:
        raise RuntimeError("Thermocouple conversion requires cold-junction temperature")
    tc_type = getattr(constants, f"tt{measurement.thermocouple_type}")
    return [float(sdk.tcVoltsToTemp(tc_type, float(value), cjc_kelvin)) for value in raw]


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


def _shunt_ohms(node: dict, nodes: dict, incoming: dict) -> float:
    shunt = _linked_node(node, "shunt", nodes, incoming)
    value = shunt.get("config", {}).get("value") if shunt is not None else node.get("config", {}).get("shuntOhms")
    return _number(value, "Shunt resistance", minimum=0, exclusive_minimum=True)


def _negative_channel(config: dict) -> int:
    if config.get("mode") != "differential":
        return 199
    name = config.get("negativeChannel")
    if not isinstance(name, str) or not name.startswith("AIN"):
        raise ValueError("Differential input requires a negative AIN channel")
    return int(name[3:])


def _configure_channels(handle: int, channels: tuple[LabJackChannel, ...], sdk) -> None:
    for channel in channels:
        _configure_channel(handle, channel, sdk)


def _configure_channel(handle: int, channel: LabJackChannel, sdk) -> None:
    number = int(channel.name[3:])
    names = [
        f"AIN{number}_NEGATIVE_CH",
        f"AIN{number}_RANGE",
        f"AIN{number}_RESOLUTION_INDEX",
        f"AIN{number}_SETTLING_US",
    ]
    values = [channel.negative, channel.range_v, channel.resolution_index, channel.settling_us]
    sdk.eWriteNames(handle, len(names), names, values)


def _restore_channels(handle: int, channels: tuple[LabJackChannel, ...], sdk) -> None:
    for channel in channels:
        sdk.eWriteName(handle, f"AIN{int(channel.name[3:])}_NEGATIVE_CH", 199)


def _incoming_links(graph: dict) -> dict[str, dict[str, dict]]:
    incoming: dict[str, dict[str, dict]] = {}
    for link in graph.get("links", []):
        incoming.setdefault(link["toNode"], {})[link["toPin"]] = link
    return incoming


def _linked_node(node: dict, pin: str, nodes: dict, incoming: dict) -> dict | None:
    link = incoming.get(node["id"], {}).get(pin)
    return nodes.get(link["fromNode"]) if link else None


def _number(
    value: object,
    label: str,
    *,
    minimum: float | None = None,
    maximum: float | None = None,
    exclusive_minimum: bool = False,
) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not isfinite(float(value)):
        raise ValueError(f"{label} must be a finite number")
    number = float(value)
    if minimum is not None and (number <= minimum if exclusive_minimum else number < minimum):
        comparison = "greater than" if exclusive_minimum else "at least"
        raise ValueError(f"{label} must be {comparison} {minimum:g}")
    if maximum is not None and number > maximum:
        raise ValueError(f"{label} must be at most {maximum:g}")
    return number


def _integer(value: object, label: str, *, minimum: int, maximum: int) -> int:
    number = _number(value, label, minimum=minimum, maximum=maximum)
    if not number.is_integer():
        raise ValueError(f"{label} must be an integer")
    return int(number)


def _sdk():
    """Load LJM lazily so unit-test discovery cannot shadow the package import."""
    from labjack import ljm
    from labjack.ljm import constants

    return ljm, constants

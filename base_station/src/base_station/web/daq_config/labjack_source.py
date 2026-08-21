"""LabJack T7 preview and stream adapter for the DAQ graph."""

from __future__ import annotations

from threading import Event
from typing import TYPE_CHECKING, Iterator

from base_station.web.daq_config.acquisition import SampleBatch
from base_station.web.daq_config.labjack_settings import preview_resolution_index
from base_station.web.daq_config.labjack_plan import (
    MEASUREMENT_TYPES,
    THERMOCOUPLE_TYPES,
    LabJackChannel,
    LabJackMeasurement,
    LabJackStreamPlan,
    compile_stream_plan,
    incoming_links,
    measurement_config,
    negative_channel,
    shunt_ohms,
)
from base_station.web.daq_config.signal_math import current_from_shunt, scalar

if TYPE_CHECKING:
    from base_station.web.labjack_service import LabJackService


def read_physical_sources(
    service: LabJackService,
    graph: dict,
    settings: dict,
) -> tuple[dict, list[str]]:
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
        incoming = incoming_links(graph)
        for node in graph.get("nodes", []):
            if node.get("nodeType") not in MEASUREMENT_TYPES:
                continue
            try:
                values[node["id"]] = _read_source(
                    handle, node, nodes, incoming, settings, sdk, constants
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


def _read_source(handle: int, node: dict, nodes: dict, incoming: dict, settings: dict, sdk, constants) -> dict:
    node_type = node["nodeType"]
    config = measurement_config(node, nodes, incoming)
    config["resolutionIndex"] = preview_resolution_index(settings)
    config["settlingUs"] = float(settings.get("settlingUs", 0))
    channel = config["channel"]
    _configure_channel(
        handle,
        LabJackChannel(
            name=channel,
            negative=negative_channel(config),
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
        resistance = shunt_ohms(node, nodes, incoming)
        amps = scalar(current_from_shunt(volts, resistance))
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


def _convert_measurement(measurement: LabJackMeasurement, raw: list[float], sdk, constants, cjc_kelvin: float | None) -> list[float]:
    if measurement.node_type == "labjack-ain":
        return [float(value) for value in raw]
    if measurement.node_type == "labjack-current":
        return [float(value) for value in current_from_shunt(raw, float(measurement.shunt_ohms))]
    if cjc_kelvin is None or not measurement.thermocouple_type:
        raise RuntimeError("Thermocouple conversion requires cold-junction temperature")
    tc_type = getattr(constants, f"tt{measurement.thermocouple_type}")
    return [float(sdk.tcVoltsToTemp(tc_type, float(value), cjc_kelvin)) for value in raw]


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


def _sdk():
    """Load LJM lazily so unit-test discovery cannot shadow the package import."""
    from labjack import ljm
    from labjack.ljm import constants

    return ljm, constants

"""Stable T7 capabilities exposed to the browser configuration editor."""

from __future__ import annotations

from base_station.web.models import DashboardState

BASE_AIN = tuple(f"AIN{index}" for index in range(14))
MUX80_AIN = tuple(f"AIN{index}" for index in range(48, 128))
T7_RANGES = (10.0, 1.0, 0.1, 0.01)
THERMOCOUPLES = ("B", "E", "J", "K", "N", "R", "S", "T", "C")


def labjack_capabilities(dashboard: DashboardState) -> dict:
    """Return T7 capabilities plus connection state from the existing handle."""
    with dashboard.lock:
        status = dashboard.labjack
        device = {
            "family": "T7",
            "connected": status.connected,
            "serial_number": status.serial_number,
            "ip": status.ip,
            "streaming": status.streaming,
            "acquisition_state": status.acquisition_state,
        }

    return {
        "device": device,
        "analog": {
            "base_channels": list(BASE_AIN),
            "ranges_v": list(T7_RANGES),
            "resolution_indices": list(range(9)),
            "single_ended_negative_channel": 199,
            "differential_pairs": [
                {"positive": f"AIN{index}", "negative": f"AIN{index + 1}"}
                for index in range(0, 14, 2)
            ],
        },
        "mux80": {
            "supported": True,
            "detected": None,
            "channels": list(MUX80_AIN),
            "differential_offset": 8,
        },
        "thermocouple": {
            "types": list(THERMOCOUPLES),
            "output_unit": "K",
            "cold_junction_register": "TEMPERATURE_DEVICE_K",
        },
        "stream": {
            "max_samples_per_second": 100_000,
            "resolution_indices": list(range(9)),
            "thermocouple_conversion": "host",
        },
    }

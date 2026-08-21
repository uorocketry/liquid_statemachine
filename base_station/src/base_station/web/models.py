"""Thread-safe dashboard state shared by hardware services and the API."""

from __future__ import annotations

from collections import deque
from dataclasses import asdict, dataclass, field
from datetime import datetime
from threading import Lock
from typing import Any

from base_station.web.devices import DEVICE_BY_ID, DEVICE_DEFINITIONS


@dataclass
class CartStatus:
    connected: bool = False
    health: str = "offline"
    host: str = "192.168.8.50"
    state: int | None = None
    transitions: list[int] = field(default_factory=list)
    pending_state: int | None = None
    transition_message: str | None = None
    reset_message: str | None = None
    firmware_version: str | None = None
    uptime_ms: int | None = None
    ethernet_link: bool = False
    modules_detected: int | None = None
    p1_initialized: bool = False
    initialization_status: str = "not_started"
    initialization_error: str | None = None
    response_time_ms: float | None = None
    last_seen: str | None = None
    consecutive_failures: int = 0
    error: str | None = None


@dataclass
class LabJackStatus:
    connected: bool = False
    streaming: bool = False
    acquisition_state: str = "idle"
    operation_message: str | None = None
    current_run_id: int | None = None
    ip: str = "192.168.8.51"
    serial_number: int | None = None
    scan_rate: int = 1000
    sample_count: int = 0
    error: str | None = None


class DashboardState:
    def __init__(self) -> None:
        self.lock = Lock()
        self.cart = CartStatus()
        self.labjack = LabJackStatus()
        self.logs: deque[dict[str, str | int]] = deque(maxlen=500)
        self._log_sequence = 0
        self.log("Base station ready")

    def log(self, message: str, level: str = "info", component: str = "system") -> None:
        now = datetime.now().astimezone()
        with self.lock:
            self._log_sequence += 1
            self.logs.append(
                {
                    "id": self._log_sequence,
                    "timestamp": now.isoformat(timespec="seconds"),
                    "time": now.strftime("%H:%M:%S"),
                    "component": component,
                    "message": message,
                    "level": level,
                }
            )

    def snapshot(self) -> dict[str, Any]:
        with self.lock:
            return {
                "cart": asdict(self.cart),
                "labjack": asdict(self.labjack),
                "logs": list(self.logs),
            }

    def navigation_status(self) -> dict[str, dict[str, str]]:
        """Small stable status payload used by the global sidebar stream."""
        with self.lock:
            return {
                device.id: {
                    "status": device.navigation_status(getattr(self, device.state_attribute))
                }
                for device in DEVICE_DEFINITIONS
            }

    def device_status(self, device_id: str) -> dict[str, Any] | None:
        """Return one detached detail snapshot for a device page."""
        device = DEVICE_BY_ID.get(device_id)
        if device is None:
            return None
        with self.lock:
            return asdict(getattr(self, device.state_attribute))

    def log_revision(self) -> int:
        with self.lock:
            return self._log_sequence

    def log_snapshot(
        self, level: str | None = None, component: str | None = None, limit: int = 200
    ) -> list[dict[str, str | int]]:
        with self.lock:
            entries = list(self.logs)
        if level:
            entries = [entry for entry in entries if entry["level"] == level]
        if component:
            entries = [entry for entry in entries if entry["component"] == component]
        return entries[-limit:]

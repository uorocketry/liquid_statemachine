"""Thread-safe dashboard state shared by hardware services and the API."""

from __future__ import annotations

from collections import deque
from dataclasses import asdict, dataclass, field
from threading import Lock
from datetime import datetime
from typing import Any


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
        self.channels = [deque(maxlen=30_000), deque(maxlen=30_000)]
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

    def add_samples(self, channel_1: list[float], channel_2: list[float]) -> None:
        with self.lock:
            self.channels[0].extend(channel_1)
            self.channels[1].extend(channel_2)
            self.labjack.sample_count += min(len(channel_1), len(channel_2))

    @staticmethod
    def _downsample(values: deque[float], limit: int = 700) -> list[float]:
        data = list(values)
        if len(data) <= limit:
            return data
        stride = max(1, len(data) // limit)
        return data[::stride][-limit:]

    def snapshot(self) -> dict[str, Any]:
        with self.lock:
            return {
                "cart": asdict(self.cart),
                "labjack": asdict(self.labjack),
                "channels": [self._downsample(channel) for channel in self.channels],
                "logs": list(self.logs),
            }

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

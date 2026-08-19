"""Fill Cart HTTP API client and background status polling."""

from __future__ import annotations

import http.client
import json
from datetime import datetime
from threading import Event, Thread
from time import monotonic

from base_station.web.models import DashboardState


STATE_NAMES = [
    "Valve testing",
    "Initialize",
    "Fuel fill",
    "LOX fill",
    "Fire",
    "Purge",
    "Overload",
    "Abort",
]


class CartService:
    def __init__(
        self,
        dashboard: DashboardState,
        host: str = "192.168.8.50",
        port: int = 80,
    ) -> None:
        self.dashboard = dashboard
        self.host = host
        self.port = port
        self.stop_event = Event()
        self.thread: Thread | None = None
        self.pending_since: float | None = None
        self.dashboard.cart.host = host

    def start(self) -> None:
        self.thread = Thread(target=self._poll, name="cart-poll", daemon=True)
        self.thread.start()

    def stop(self) -> None:
        self.stop_event.set()
        if self.thread:
            self.thread.join(timeout=2)

    def _request(self, method: str, path: str, timeout: float = 1) -> dict:
        connection = http.client.HTTPConnection(self.host, self.port, timeout=timeout)
        try:
            connection.request(method, path, headers={"Accept": "application/json"})
            response = connection.getresponse()
            body = response.read()
        finally:
            connection.close()

        payload = json.loads(body) if body else {}
        if response.status >= 400:
            message = payload.get("error", response.reason)
            raise ConnectionError(f"Cart HTTP {response.status}: {message}")
        return payload

    def get_status(self) -> dict:
        return self._request("GET", "/api/status")

    def initialize(self) -> dict:
        with self.dashboard.lock:
            self.dashboard.cart.initialization_status = "initializing"
            self.dashboard.cart.initialization_error = None
        self.dashboard.log("P1 rack initialization started", "info", "p1am")
        try:
            health = self._request("POST", "/api/p1/initialize", timeout=15)
        except (OSError, ConnectionError, ValueError) as error:
            message = f"P1 rack initialization failed: {error}"
            with self.dashboard.lock:
                self.dashboard.cart.initialization_status = "failed"
                self.dashboard.cart.initialization_error = str(error)
            self.dashboard.log(message, "error", "p1am")
            raise

        with self.dashboard.lock:
            self.dashboard.cart.initialization_status = "succeeded"
            self.dashboard.cart.initialization_error = None
        self.dashboard.log("P1 rack initialized", "success", "p1am")
        return health

    def set_state(self, state: int) -> None:
        if state not in range(len(STATE_NAMES)):
            raise ValueError(f"Invalid cart state: {state}")
        self._request("PUT", f"/api/state/{state}")
        with self.dashboard.lock:
            self.dashboard.cart.pending_state = state
            self.dashboard.cart.transition_message = f"Waiting for {STATE_NAMES[state]} confirmation"
        self.pending_since = monotonic()
        self.dashboard.log(f"Requested cart state: {STATE_NAMES[state]}")

    def reset(self) -> None:
        self._request("POST", "/api/reset")
        with self.dashboard.lock:
            self.dashboard.cart.reset_message = (
                "Restart accepted; waiting for the controller to return"
            )
        self.dashboard.log("P1AM controller restart requested", "warning", "p1am")

    def _poll(self) -> None:
        was_connected = False
        while not self.stop_event.is_set():
            try:
                started = monotonic()
                status = self.get_status()
                health = status["health"]
                state = int(status["state"])
                transitions = [int(item) for item in status["transitions"]]
                latency_ms = round((monotonic() - started) * 1000, 1)
                ethernet = health.get("ethernet", {})
                p1 = health.get("p1", {})
                healthy = bool(
                    health.get("ok")
                    and ethernet.get("link")
                    and p1.get("initialized")
                )
                previous_health = self.dashboard.cart.health
                with self.dashboard.lock:
                    self.dashboard.cart.connected = True
                    self.dashboard.cart.health = "healthy" if healthy else "degraded"
                    self.dashboard.cart.state = state
                    self.dashboard.cart.transitions = transitions
                    self.dashboard.cart.firmware_version = health.get("firmware_version")
                    self.dashboard.cart.uptime_ms = health.get("uptime_ms")
                    self.dashboard.cart.ethernet_link = bool(ethernet.get("link"))
                    self.dashboard.cart.modules_detected = p1.get("modules_detected")
                    self.dashboard.cart.p1_initialized = bool(p1.get("initialized"))
                    if self.dashboard.cart.p1_initialized:
                        self.dashboard.cart.initialization_status = "succeeded"
                        self.dashboard.cart.initialization_error = None
                    self.dashboard.cart.response_time_ms = latency_ms
                    self.dashboard.cart.last_seen = datetime.now().astimezone().isoformat(timespec="seconds")
                    self.dashboard.cart.consecutive_failures = 0
                    self.dashboard.cart.error = None
                    pending_state = self.dashboard.cart.pending_state
                    if pending_state == state:
                        self.dashboard.cart.pending_state = None
                        self.dashboard.cart.transition_message = (
                            f"Controller confirmed {STATE_NAMES[state]}"
                        )
                        self.pending_since = None
                    elif (
                        pending_state is not None
                        and self.pending_since is not None
                        and monotonic() - self.pending_since > 5
                    ):
                        self.dashboard.cart.pending_state = None
                        self.dashboard.cart.transition_message = "Transition confirmation timed out"
                        self.pending_since = None
                if not was_connected:
                    self.dashboard.log("Fill Cart connected", "success", "p1am")
                    with self.dashboard.lock:
                        if self.dashboard.cart.reset_message:
                            self.dashboard.cart.reset_message = (
                                "Controller restarted; initialize the P1 rack before operation"
                            )
                if not healthy and previous_health != "degraded":
                    self.dashboard.log("Fill Cart health degraded", "warning", "p1am")
                was_connected = True
            except (OSError, ConnectionError, ValueError, KeyError) as error:
                with self.dashboard.lock:
                    self.dashboard.cart.connected = False
                    self.dashboard.cart.health = "offline"
                    self.dashboard.cart.transitions = []
                    self.dashboard.cart.consecutive_failures += 1
                    self.dashboard.cart.error = str(error)
                if was_connected:
                    self.dashboard.log("Fill Cart connection lost", "error", "p1am")
                was_connected = False
            self.stop_event.wait(0.6)

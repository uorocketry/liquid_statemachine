"""P1AM lifecycle, health supervision, and state-transition coordination."""

from __future__ import annotations

from datetime import datetime
from threading import Event, Lock, Thread
from time import monotonic

from base_station.web.models import DashboardState

from .client import P1amClient, P1amProtocolError, P1amSnapshot
from .errors import diagnostic_signature, operator_message
from .states import STATE_BY_ID, state_name


class P1amService:
    def __init__(
        self,
        dashboard: DashboardState,
        host: str = "192.168.8.50",
        port: int = 80,
        client: P1amClient | None = None,
        poll_interval: float = 0.6,
    ) -> None:
        self.dashboard = dashboard
        self.client = client or P1amClient(host, port)
        self.poll_interval = poll_interval
        self.stop_event = Event()
        self.thread: Thread | None = None
        self.pending_since: float | None = None
        self._lifecycle_lock = Lock()
        self._last_error_signature: str | None = None
        self.dashboard.cart.host = self.client.host

    def start(self) -> None:
        with self._lifecycle_lock:
            if self.thread and self.thread.is_alive():
                return
            self.stop_event.clear()
            self.thread = Thread(target=self._poll, name="p1am-status", daemon=True)
            self.thread.start()

    def stop(self) -> None:
        with self._lifecycle_lock:
            self.stop_event.set()
            thread = self.thread
        if thread:
            thread.join(timeout=2)
        with self._lifecycle_lock:
            if self.thread is thread and (thread is None or not thread.is_alive()):
                self.thread = None

    def initialize(self) -> dict:
        with self.dashboard.lock:
            self.dashboard.cart.initialization_status = "initializing"
            self.dashboard.cart.initialization_error = None
        self.dashboard.log("P1 rack initialization started", "info", "p1am")
        try:
            snapshot = self.client.initialize()
        except (OSError, ConnectionError, P1amProtocolError) as error:
            with self.dashboard.lock:
                self.dashboard.cart.initialization_status = "failed"
                self.dashboard.cart.initialization_error = operator_message(error)
            self.dashboard.log(
                f"P1 rack initialization failed: {diagnostic_signature(error)}",
                "error",
                "p1am",
            )
            raise
        self._apply_snapshot(snapshot)
        self.dashboard.log("P1 rack initialized", "success", "p1am")
        return {"ok": True}

    def set_state(self, state: int) -> None:
        if state not in STATE_BY_ID:
            raise ValueError(f"Invalid cart state: {state}")
        self.client.set_state(state)
        with self.dashboard.lock:
            self.dashboard.cart.pending_state = state
            self.dashboard.cart.transition_message = f"Waiting for {state_name(state)} confirmation"
        self.pending_since = monotonic()
        self.dashboard.log(f"Requested cart state: {state_name(state)}", component="p1am")

    def reset(self) -> None:
        self.client.reset()
        with self.dashboard.lock:
            self.dashboard.cart.reset_message = "Restart accepted; waiting for the controller to return"
        self.dashboard.log("P1AM controller restart requested", "warning", "p1am")

    def _poll(self) -> None:
        was_connected = False
        while not self.stop_event.is_set():
            try:
                started = monotonic()
                snapshot = self.client.get_status()
                latency_ms = round((monotonic() - started) * 1000, 1)
                previous_health = self.dashboard.cart.health
                self._apply_snapshot(snapshot, latency_ms)
                if not was_connected:
                    self.dashboard.log("Fill Cart connected", "success", "p1am")
                    with self.dashboard.lock:
                        if self.dashboard.cart.reset_message:
                            self.dashboard.cart.reset_message = (
                                "Controller restarted; initialize the P1 rack before operation"
                            )
                if self.dashboard.cart.health == "degraded" and previous_health != "degraded":
                    self.dashboard.log("Fill Cart health degraded", "warning", "p1am")
                was_connected = True
                self._last_error_signature = None
            except Exception as error:  # keep the device supervisor alive after protocol/runtime faults
                was_connected = self._record_poll_failure(error, was_connected)
            self.stop_event.wait(self.poll_interval)

    def _apply_snapshot(self, snapshot: P1amSnapshot, latency_ms: float | None = None) -> None:
        healthy = snapshot.health_ok and snapshot.ethernet_link and snapshot.p1_initialized
        now = datetime.now().astimezone().isoformat(timespec="seconds")
        with self.dashboard.lock:
            cart = self.dashboard.cart
            cart.connected = True
            cart.health = "healthy" if healthy else "degraded"
            cart.state = snapshot.state
            cart.transitions = list(snapshot.transitions)
            cart.firmware_version = snapshot.firmware_version
            cart.uptime_ms = snapshot.uptime_ms
            cart.ethernet_link = snapshot.ethernet_link
            cart.modules_detected = snapshot.modules_detected
            cart.p1_initialized = snapshot.p1_initialized
            if snapshot.p1_initialized:
                cart.initialization_status = "succeeded"
                cart.initialization_error = None
            if latency_ms is not None:
                cart.response_time_ms = latency_ms
            cart.last_seen = now
            cart.consecutive_failures = 0
            cart.error = None
            self._update_pending_transition(snapshot.state)

    def _update_pending_transition(self, state: int) -> None:
        cart = self.dashboard.cart
        if cart.pending_state == state:
            cart.pending_state = None
            cart.transition_message = f"Controller confirmed {state_name(state)}"
            self.pending_since = None
        elif (
            cart.pending_state is not None
            and self.pending_since is not None
            and monotonic() - self.pending_since > 5
        ):
            cart.pending_state = None
            cart.transition_message = "Transition confirmation timed out"
            self.pending_since = None

    def _record_poll_failure(self, error: Exception, was_connected: bool) -> bool:
        signature = diagnostic_signature(error)
        with self.dashboard.lock:
            cart = self.dashboard.cart
            cart.connected = False
            cart.health = "offline"
            cart.transitions = []
            cart.consecutive_failures += 1
            cart.error = operator_message(error)
        if was_connected:
            self.dashboard.log(f"Fill Cart connection lost: {signature}", "error", "p1am")
        elif signature != self._last_error_signature:
            level = "error" if not isinstance(error, (OSError, ConnectionError)) else "warning"
            self.dashboard.log(f"P1AM status unavailable: {signature}", level, "p1am")
        self._last_error_signature = signature
        return False

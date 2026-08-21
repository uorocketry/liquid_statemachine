"""Process-owned live Dashboard sampling and bounded recent history."""

from __future__ import annotations

import json
import math
from collections import defaultdict, deque
from datetime import datetime
from threading import Event, Lock, RLock, Thread
from time import monotonic

from base_station.web.daq_config.node_specs import DASHBOARD_NODE_TYPES
from base_station.web.daq_config.preview import preview_graph
from base_station.web.daq_config.repository import DaqConfigRepository
from base_station.web.daq_config.validation import blocking_issues, validate_graph
from base_station.web.labjack_service import LabJackService
from base_station.web.models import DashboardState


SAMPLE_INTERVAL_SECONDS = 0.25
LIVE_HISTORY_SECONDS = 600.0


class DashboardTelemetryService:
    """Sample the saved graph once and fan out bounded history to all browsers."""

    def __init__(
        self,
        dashboard: DashboardState,
        labjack: LabJackService,
        repository: DaqConfigRepository,
    ) -> None:
        self.dashboard = dashboard
        self.labjack = labjack
        self.repository = repository
        self._lock = RLock()
        self._lifecycle_lock = Lock()
        self._stop = Event()
        self._thread: Thread | None = None
        self._revision = 0
        self._session_id = 0
        self._session_started_monotonic = monotonic()
        self._session_started_at = ""
        self._histories: dict[str, deque[dict]] = defaultdict(deque)
        self._segments: dict[str, int] = defaultdict(int)
        self._missing: set[str] = set()
        self._latest: dict = {"values": {}, "errors": [], "unresolved": []}
        self._config_revision = -1
        self._config_signature = ""
        self._graph: dict = {"nodes": [], "links": []}
        self._settings: dict = {}
        self._issues: list[dict] = []
        self._dashboard_ids: tuple[str, ...] = ()
        self._timeline_ids: tuple[str, ...] = ()
        self._published_signature = ""
        self._last_runtime_error = ""
        self.reset(log=False)

    def start(self) -> None:
        with self._lifecycle_lock:
            if self._thread and self._thread.is_alive():
                return
            self._stop.clear()
            self._thread = Thread(target=self._run, name="dashboard-telemetry", daemon=True)
            self._thread.start()

    def stop(self) -> None:
        with self._lifecycle_lock:
            self._stop.set()
            thread = self._thread
        if thread:
            thread.join(timeout=2)
        with self._lifecycle_lock:
            if self._thread is thread and (thread is None or not thread.is_alive()):
                self._thread = None

    def reset(self, *, log: bool = True) -> dict:
        with self._lock:
            self._session_id += 1
            self._session_started_monotonic = monotonic()
            self._session_started_at = datetime.now().astimezone().isoformat(timespec="seconds")
            self._histories.clear()
            self._segments.clear()
            self._missing.clear()
            self._published_signature = ""
            self._latest = {
                "values": {},
                "errors": [],
                "unresolved": [],
                "timestamp": 0.0,
                "sessionId": self._session_id,
                "segments": {},
            }
            self._revision += 1
            session = self._session_payload()
        if log:
            self.dashboard.log("Live Dashboard history reset", component="system")
        return session

    def snapshot(self) -> dict:
        with self._lock:
            return {
                "revision": self._revision,
                "session": self._session_payload(),
                "histories": {
                    node_id: list(samples)
                    for node_id, samples in self._histories.items()
                },
                "latest": dict(self._latest),
            }

    def latest(self) -> tuple[int, int, dict]:
        with self._lock:
            return self._revision, self._session_id, dict(self._latest)

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                self._refresh_configuration()
                if not self._dashboard_ids:
                    self._stop.wait(SAMPLE_INTERVAL_SECONDS)
                    continue
                if blocking_issues(self._issues):
                    self._publish({"values": {}, "errors": [], "issues": self._issues})
                else:
                    try:
                        payload = preview_graph(self.labjack, self._graph, self._settings)
                    except (RuntimeError, ValueError, OSError) as error:
                        payload = {"values": {}, "errors": [str(error)], "unresolved": []}
                    self._ingest(payload)
                if self._last_runtime_error:
                    self.dashboard.log("Live Dashboard telemetry recovered", "success", "system")
                    self._last_runtime_error = ""
            except Exception as error:  # keep the process-owned sampler supervised
                signature = f"{type(error).__name__}: {error}"
                self._publish({
                    "values": {},
                    "errors": ["Live Dashboard telemetry unavailable. See Logs."],
                    "unresolved": [],
                })
                if signature != self._last_runtime_error:
                    self.dashboard.log(
                        f"Live Dashboard telemetry failed: {signature}", "error", "system"
                    )
                    self._last_runtime_error = signature
            self._stop.wait(SAMPLE_INTERVAL_SECONDS)

    def _refresh_configuration(self) -> None:
        revision = self.repository.revision
        if revision == self._config_revision:
            return
        document = self.repository.load()
        graph = document["graph"]
        settings = document["sources"]["labjack"]
        signature = json.dumps({"graph": graph, "settings": settings}, sort_keys=True, separators=(",", ":"))
        changed = bool(self._config_signature and signature != self._config_signature)
        self._graph = graph
        self._settings = settings
        self._issues = validate_graph(graph, settings)
        self._dashboard_ids = tuple(
            node["id"]
            for node in graph.get("nodes", [])
            if node.get("nodeType") in DASHBOARD_NODE_TYPES
        )
        self._timeline_ids = tuple(
            node["id"]
            for node in graph.get("nodes", [])
            if node.get("nodeType") == "time-plot"
        )
        self._config_revision = revision
        self._config_signature = signature
        if changed:
            self.reset(log=False)
            self.dashboard.log("Live Dashboard history restarted after DAQ configuration change", component="system")

    def _ingest(self, payload: dict) -> None:
        values = payload.get("values", {})
        with self._lock:
            timestamp = monotonic() - self._session_started_monotonic
            for node_id in self._timeline_ids:
                reading = values.get(node_id)
                if not _finite_reading(reading):
                    self._missing.add(node_id)
                    continue
                if node_id in self._missing:
                    self._segments[node_id] += 1
                    self._missing.discard(node_id)
                history = self._histories[node_id]
                history.append({
                    "time": timestamp,
                    "value": float(reading["value"]),
                    "unit": str(reading.get("unit", "")),
                    "segment": self._segments[node_id],
                })
                cutoff = timestamp - LIVE_HISTORY_SECONDS
                while history and history[0]["time"] < cutoff:
                    history.popleft()
            enriched = dict(payload)
            enriched["timestamp"] = timestamp
            enriched["sessionId"] = self._session_id
            enriched["segments"] = {
                node_id: self._segments[node_id] for node_id in self._timeline_ids
            }
            self._latest = enriched
            self._published_signature = ""
            self._revision += 1

    def _publish(self, payload: dict) -> None:
        signature = json.dumps(payload, sort_keys=True, separators=(",", ":"))
        with self._lock:
            if signature == self._published_signature:
                return
            enriched = dict(payload)
            enriched["timestamp"] = monotonic() - self._session_started_monotonic
            enriched["sessionId"] = self._session_id
            self._latest = enriched
            self._published_signature = signature
            self._revision += 1

    def _session_payload(self) -> dict:
        return {
            "id": self._session_id,
            "startedAt": self._session_started_at,
            "retentionSeconds": LIVE_HISTORY_SECONDS,
        }


def _finite_reading(reading: object) -> bool:
    if not isinstance(reading, dict):
        return False
    value = reading.get("value")
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(float(value))
    )

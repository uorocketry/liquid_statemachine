"""Behavioral tests for process-owned live Dashboard history."""

from pathlib import Path
from tempfile import TemporaryDirectory
from time import monotonic, sleep
from unittest import TestCase
from unittest.mock import Mock, patch

from base_station.web.dashboard_telemetry import (
    DashboardTelemetryService,
    LIVE_HISTORY_SECONDS,
)
from base_station.web.daq_config.repository import DaqConfigRepository
from base_station.web.models import DashboardState


class DashboardTelemetryTests(TestCase):
    def setUp(self) -> None:
        self.temporary = TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.repository = DaqConfigRepository(Path(self.temporary.name) / "daq.json")
        self.repository.save(document("Plot"))
        self.dashboard = DashboardState()
        self.service = DashboardTelemetryService(
            self.dashboard,
            Mock(),
            self.repository,
        )
        self.service._refresh_configuration()
        self.service._session_started_monotonic = 0.0

    def test_history_is_bounded_by_live_retention_window(self) -> None:
        with patch("base_station.web.dashboard_telemetry.monotonic", side_effect=[1.0, LIVE_HISTORY_SECONDS + 2.0]):
            self.service._ingest(payload(10))
            self.service._ingest(payload(20))
        history = self.service.snapshot()["histories"]["plot"]
        self.assertEqual([sample["value"] for sample in history], [20.0])

    def test_reset_starts_new_session_without_touching_configuration(self) -> None:
        with patch("base_station.web.dashboard_telemetry.monotonic", return_value=5.0):
            self.service._ingest(payload(10))
        before = self.service.snapshot()
        graph = self.repository.load()["graph"]
        session = self.service.reset(log=False)
        after = self.service.snapshot()
        self.assertGreater(session["id"], before["session"]["id"])
        self.assertEqual(after["histories"], {})
        self.assertEqual(self.repository.load()["graph"], graph)

    def test_graph_change_restarts_history_instead_of_mixing_semantics(self) -> None:
        with patch("base_station.web.dashboard_telemetry.monotonic", return_value=1.0):
            self.service._ingest(payload(10))
        session_id = self.service.snapshot()["session"]["id"]
        self.repository.save_graph(self.repository.load()["graph"] | {
            "nodes": [
                {**node, "config": {**node["config"], "label": "Renamed"}}
                if node["id"] == "plot" else node
                for node in self.repository.load()["graph"]["nodes"]
            ]
        })
        self.service._refresh_configuration()
        snapshot = self.service.snapshot()
        self.assertGreater(snapshot["session"]["id"], session_id)
        self.assertEqual(snapshot["histories"], {})

    def test_sampler_survives_runtime_failure_and_recovers(self) -> None:
        refresh = Mock(side_effect=[RuntimeError("broken config"), None, None, None])
        with (
            patch.object(self.service, "_refresh_configuration", refresh),
            patch("base_station.web.dashboard_telemetry.preview_graph", return_value=payload(42)),
        ):
            self.service.start()
            deadline = monotonic() + 1.2
            while monotonic() < deadline:
                if self.service.snapshot()["latest"].get("values", {}).get("plot"):
                    break
                sleep(0.05)
            self.assertTrue(self.service._thread and self.service._thread.is_alive())
            self.assertEqual(
                self.service.snapshot()["latest"]["values"]["plot"]["value"],
                42,
            )
            messages = [entry["message"] for entry in self.dashboard.log_snapshot(limit=20)]
            self.assertTrue(any("telemetry failed" in message for message in messages))
            self.assertTrue(any("telemetry recovered" in message for message in messages))
            self.service.stop()


def document(label: str) -> dict:
    return {
        "graph": {
            "nodes": [
                {"id": "sine", "nodeType": "sine-wave", "config": {"unit": "psi"}},
                {"id": "plot", "nodeType": "time-plot", "config": {"label": label}},
            ],
            "links": [{
                "id": "link",
                "fromNode": "sine",
                "fromPin": "signal",
                "toNode": "plot",
                "toPin": "value",
            }],
        },
        "sources": {"labjack": {}},
        "dashboard": {"layout": {"items": {}}},
    }


def payload(value: float) -> dict:
    return {
        "values": {"plot": {"value": value, "unit": "psi"}},
        "errors": [],
        "unresolved": [],
    }

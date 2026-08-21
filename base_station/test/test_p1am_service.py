"""Unit tests for the Fill Cart HTTP client."""

from time import monotonic, sleep
from unittest import TestCase
from unittest.mock import Mock

from base_station.web.models import DashboardState
from base_station.web.p1am.client import P1amClient, P1amProtocolError, P1amSnapshot
from base_station.web.p1am.errors import operator_message
from base_station.web.p1am.service import P1amService


class P1amServiceTests(TestCase):
    def setUp(self) -> None:
        self.dashboard = DashboardState()
        self.client = Mock(spec=P1amClient)
        self.client.host = "192.168.8.50"
        self.client.get_status.return_value = snapshot()
        self.service = P1amService(self.dashboard, client=self.client)

    def test_get_status_uses_combined_http_endpoint(self) -> None:
        client = P1amClient("192.168.8.50")
        client._request = Mock(return_value=status_payload())
        self.assertEqual(client.get_status().state, 3)
        client._request.assert_called_once_with("GET", "/api/status")

    def test_initialize_uses_longer_http_timeout(self) -> None:
        self.client.initialize.return_value = snapshot(p1_initialized=True)
        self.service.initialize()
        self.client.initialize.assert_called_once_with()
        self.assertEqual(self.dashboard.cart.initialization_status, "succeeded")

    def test_set_state_uses_http_endpoint(self) -> None:
        self.service.set_state(4)
        self.client.set_state.assert_called_once_with(4)
        self.assertEqual(self.dashboard.cart.pending_state, 4)

    def test_set_state_rejects_unknown_state(self) -> None:
        with self.assertRaises(ValueError):
            self.service.set_state(8)

    def test_reset_uses_http_endpoint(self) -> None:
        self.service.reset()
        self.client.reset.assert_called_once_with()
        self.assertIn("Restart accepted", self.dashboard.cart.reset_message)

    def test_protocol_validation_rejects_malformed_health(self) -> None:
        payload = status_payload()
        payload["health"] = None
        with self.assertRaises(P1amProtocolError):
            P1amSnapshot.from_payload(payload)

    def test_service_can_restart_after_stop(self) -> None:
        self.service.stop_event.set()
        self.service.start()
        self.assertTrue(self.service.thread and self.service.thread.is_alive())
        self.service.stop()

    def test_poller_recovers_after_protocol_error(self) -> None:
        client = Mock(spec=P1amClient)
        client.host = "192.168.8.50"
        attempts = iter([P1amProtocolError("bad payload")])
        def next_status():
            error = next(attempts, None)
            if error:
                raise error
            return snapshot()
        client.get_status.side_effect = next_status
        service = P1amService(self.dashboard, client=client, poll_interval=0.01)
        service.start()
        deadline = monotonic() + 0.5
        while monotonic() < deadline and not self.dashboard.cart.connected:
            sleep(0.01)
        self.assertTrue(service.thread and service.thread.is_alive())
        self.assertTrue(self.dashboard.cart.connected)
        self.assertIsNone(self.dashboard.cart.error)
        service.stop()

    def test_protocol_validation_rejects_state_table_drift(self) -> None:
        payload = status_payload()
        payload["states"][4] = "Ignition"
        with self.assertRaisesRegex(P1amProtocolError, "state table"):
            P1amSnapshot.from_payload(payload)
        self.service.start()
        self.assertTrue(self.service.thread and self.service.thread.is_alive())
        self.service.stop()

    def test_operator_errors_hide_transport_details(self) -> None:
        self.assertEqual(operator_message(TimeoutError("timed out")), "Controller unreachable (request timed out)")
        self.assertEqual(
            operator_message(P1amProtocolError("controller state table does not match this base-station build")),
            "Controller firmware is incompatible with this base-station build",
        )


def snapshot(*, p1_initialized: bool = True) -> P1amSnapshot:
    return P1amSnapshot(
        state=3,
        transitions=(4,),
        health_ok=True,
        firmware_version="test",
        uptime_ms=1000,
        ethernet_link=True,
        modules_detected=2,
        p1_initialized=p1_initialized,
    )


def status_payload() -> dict:
    return {
        "health": {
            "ok": True,
            "firmware_version": "test",
            "uptime_ms": 1000,
            "ethernet": {"link": True},
            "p1": {"initialized": True, "modules_detected": 2},
        },
        "state": 3,
        "states": [
            "Valve testing", "Initialize", "Fuel fill", "LOX fill",
            "Fire", "Purge", "Overload", "Abort",
        ],
        "transitions": [4],
    }


if __name__ == "__main__":
    import unittest

    unittest.main()

"""Unit tests for the PHIL cart HTTP client."""

from unittest import TestCase
from unittest.mock import Mock

from base_station.web.cart_service import CartService
from base_station.web.models import DashboardState


class CartServiceTests(TestCase):
    def setUp(self) -> None:
        self.dashboard = DashboardState()
        self.service = CartService(self.dashboard)
        self.service._request = Mock(
            return_value={"health": {"ok": True}, "state": 3, "transitions": [4]}
        )

    def test_get_status_uses_combined_http_endpoint(self) -> None:
        self.assertEqual(self.service.get_status()["state"], 3)
        self.service._request.assert_called_once_with("GET", "/api/status")

    def test_initialize_uses_longer_http_timeout(self) -> None:
        self.service._request.return_value = {"ok": True}
        self.service.initialize()
        self.service._request.assert_called_once_with(
            "POST", "/api/p1/initialize", timeout=15
        )
        self.assertEqual(self.dashboard.cart.initialization_status, "succeeded")

    def test_set_state_uses_http_endpoint(self) -> None:
        self.service.set_state(4)
        self.service._request.assert_called_once_with("PUT", "/api/state/4")
        self.assertEqual(self.dashboard.cart.pending_state, 4)

    def test_set_state_rejects_unknown_state(self) -> None:
        with self.assertRaises(ValueError):
            self.service.set_state(8)

    def test_reset_uses_http_endpoint(self) -> None:
        self.service.reset()
        self.service._request.assert_called_once_with("POST", "/api/reset")
        self.assertIn("Restart accepted", self.dashboard.cart.reset_message)


if __name__ == "__main__":
    import unittest

    unittest.main()

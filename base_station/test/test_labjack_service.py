import sys
from types import ModuleType
from unittest import TestCase
from unittest.mock import Mock

labjack_package = ModuleType("labjack")
labjack_package.ljm = Mock()
sys.modules["labjack"] = labjack_package

from base_station.web.labjack_service import LabJackService
from base_station.web.models import DashboardState


class LabJackServiceTests(TestCase):
    def test_repeated_start_does_not_replace_active_settings(self) -> None:
        dashboard = DashboardState()
        dashboard.labjack.scan_rate = 1_000
        service = LabJackService(dashboard, Mock())
        service.handle = 1
        service.stream_thread = Mock()
        service.stream_thread.is_alive.return_value = True

        with self.assertRaisesRegex(RuntimeError, "already active"):
            service.start_stream(2_000)

        self.assertEqual(dashboard.labjack.scan_rate, 1_000)

    def test_repeated_stop_is_safe_when_stream_is_already_idle(self) -> None:
        dashboard = DashboardState()
        dashboard.labjack.streaming = True
        dashboard.labjack.acquisition_state = "stopping"
        service = LabJackService(dashboard, Mock())

        service.stop_stream()
        service.stop_stream()

        self.assertFalse(dashboard.labjack.streaming)
        self.assertEqual(dashboard.labjack.acquisition_state, "idle")
        self.assertEqual(dashboard.labjack.operation_message, "Acquisition is idle")


if __name__ == "__main__":
    import unittest

    unittest.main()

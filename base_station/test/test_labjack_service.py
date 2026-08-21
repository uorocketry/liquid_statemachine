import sys
from types import ModuleType, SimpleNamespace
from unittest import TestCase
from unittest.mock import Mock, patch

labjack_package = ModuleType("labjack")
labjack_package.ljm = Mock()
sys.modules["labjack"] = labjack_package

from base_station.web.labjack_service import LabJackService
from base_station.web.daq_config.acquisition import SampleBatch, SignalDescriptor
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
            service.start_stream({"nodes": [], "links": [], "metadata": {"scanRate": 2_000}})

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

    def test_stream_service_only_coordinates_generic_batches(self) -> None:
        dashboard = DashboardState()
        runs = Mock()
        runs.start_run.return_value = 7
        service = LabJackService(dashboard, runs)
        service.handle = 42
        signal = SignalDescriptor("pressure", "Pressure", "psi")
        plan = SimpleNamespace(scan_rate=500, signals=(signal,), source_id="labjack-t7")
        batch = SampleBatch(0, {"pressure": [1.0, 2.0, 3.0]})
        fake_ljm = SimpleNamespace(LJMError=RuntimeError)

        with (
            patch("base_station.web.labjack_service._ljm", return_value=fake_ljm),
            patch("base_station.web.labjack_service.stream_batches", return_value=iter([batch])),
        ):
            service._stream(plan)

        runs.start_run.assert_called_once_with(500, (signal,), source_id="labjack-t7")
        runs.add_batch.assert_called_once_with(7, batch)
        runs.finish_run.assert_called_once_with(7, "completed", 3, None)
        self.assertEqual(dashboard.labjack.sample_count, 3)
        self.assertFalse(dashboard.labjack.streaming)


if __name__ == "__main__":
    import unittest

    unittest.main()

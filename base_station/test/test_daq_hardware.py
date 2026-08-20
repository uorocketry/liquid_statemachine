"""Tests for LabJack SDK-backed DAQ previews and host transforms."""

from unittest import TestCase
from threading import Lock
from types import SimpleNamespace
from unittest.mock import Mock, patch

from base_station.web.daq_config import hardware, preview
from base_station.web.models import DashboardState


class DaqHardwareTests(TestCase):
    def setUp(self) -> None:
        self.dashboard = DashboardState()
        self.dashboard.labjack.connected = True
        self.service = SimpleNamespace(
            dashboard=self.dashboard,
            handle=42,
            device_lock=Lock(),
        )
        self.sdk = Mock()
        self.constants = SimpleNamespace(
            ttB=6001, ttE=6002, ttJ=6003, ttK=6004, ttN=6005,
            ttR=6006, ttS=6007, ttT=6008, ttC=6009,
        )

    def test_differential_voltage_preview_configures_t7_registers(self) -> None:
        graph = {
            "nodes": [
                {"id": "pair", "nodeType": "labjack-channel-pair", "config": {"channel": "AIN0"}},
                {
                    "id": "pt", "title": "PT", "nodeType": "labjack-ain",
                    "config": {"rangeV": 0.1},
                },
            ],
            "links": [
                {"fromNode": "pair", "toNode": "pt", "toPin": "channel"},
            ],
            "metadata": {"streamResolutionIndex": 3, "streamSettlingUs": 20},
        }
        self.sdk.eReadName.return_value = 0.047
        with patch.object(hardware, "_sdk", return_value=(self.sdk, self.constants)):
            values, errors = hardware.read_physical_sources(self.service, graph)

        self.assertEqual(errors, [])
        self.assertAlmostEqual(values["pt"]["value"], 0.047)
        self.sdk.eWriteNames.assert_called_once_with(
            42,
            4,
            ["AIN0_NEGATIVE_CH", "AIN0_RANGE", "AIN0_RESOLUTION_INDEX", "AIN0_SETTLING_US"],
            [1, 0.1, 3, 20.0],
        )

    def test_auto_stream_resolution_previews_with_stream_default(self) -> None:
        graph = {
            "nodes": [
                {"id": "ain", "nodeType": "labjack-channel", "config": {"channel": "AIN2"}},
                {"id": "input", "nodeType": "labjack-ain", "config": {"rangeV": 1}},
            ],
            "links": [{"fromNode": "ain", "toNode": "input", "toPin": "channel"}],
            "metadata": {"streamResolutionIndex": 0, "streamSettlingUs": 0},
        }
        self.sdk.eReadName.return_value = 0.25
        with patch.object(hardware, "_sdk", return_value=(self.sdk, self.constants)):
            hardware.read_physical_sources(self.service, graph)
        self.assertEqual(self.sdk.eWriteNames.call_args.args[3][2:], [1, 0.0])

    def test_current_preview_uses_configured_shunt(self) -> None:
        graph = {
            "nodes": [
                {"id": "ain", "nodeType": "labjack-channel", "config": {"channel": "AIN2"}},
                {"id": "shunt", "nodeType": "constant", "config": {"value": 250, "unit": "Ω"}},
                {"id": "current", "title": "Current", "nodeType": "labjack-current", "config": {"rangeV": 10}},
            ],
            "links": [
                {"fromNode": "ain", "toNode": "current", "toPin": "channel"},
                {"fromNode": "shunt", "toNode": "current", "toPin": "shunt"},
            ],
        }
        self.sdk.eReadName.return_value = 5.0
        with patch.object(hardware, "_sdk", return_value=(self.sdk, self.constants)):
            values, _ = hardware.read_physical_sources(self.service, graph)
        self.assertAlmostEqual(values["current"]["value"], 0.020)
        self.assertEqual(values["current"]["unit"], "A")

    def test_thermocouple_preview_uses_ljm_host_conversion(self) -> None:
        graph = {
            "nodes": [
                {"id": "pair", "nodeType": "labjack-channel-pair", "config": {"channel": "AIN0"}},
                {
                    "id": "tc", "title": "TC", "nodeType": "labjack-thermocouple",
                    "config": {"rangeV": 0.01, "thermocoupleType": "K"},
                },
            ],
            "links": [
                {"fromNode": "pair", "toNode": "tc", "toPin": "pair"},
            ],
        }
        self.sdk.eReadName.side_effect = [0.0012, 296.5]
        self.sdk.tcVoltsToTemp.return_value = 326.4
        with patch.object(hardware, "_sdk", return_value=(self.sdk, self.constants)):
            values, _ = hardware.read_physical_sources(self.service, graph)
        self.assertEqual(values["tc"]["unit"], "K")
        self.assertAlmostEqual(values["tc"]["value"], 326.4)
        self.sdk.tcVoltsToTemp.assert_called_once_with(6004, 0.0012, 296.5)

    def test_preview_evaluates_pressure_and_dashboard_widget(self) -> None:
        graph = {
            "nodes": [
                {"id": "source", "nodeType": "labjack-current"},
                {"id": "scale", "nodeType": "pressure-calibration", "config": {
                    "inputMin": 0.004, "inputMax": 0.020, "psiMin": 0, "psiMax": 1000,
                }},
                {"id": "display", "nodeType": "number", "config": {}},
            ],
            "links": [
                {"fromNode": "source", "toNode": "scale", "toPin": "input"},
                {"fromNode": "scale", "toNode": "display", "toPin": "value"},
            ],
        }
        with patch.object(
            preview, "read_physical_sources",
            return_value=({"source": {"value": 0.012, "unit": "A"}}, []),
        ):
            result = preview.preview_graph(self.service, graph)
        self.assertAlmostEqual(result["values"]["scale"]["value"], 500.0)
        self.assertAlmostEqual(result["values"]["display"]["value"], 500.0)

    def test_load_cell_uses_graph_excitation_input(self) -> None:
        graph = {
            "nodes": [
                {"id": "bridge", "nodeType": "constant", "config": {"value": 0.01, "unit": "V"}},
                {"id": "excitation", "nodeType": "constant", "config": {"value": 5.0, "unit": "V"}},
                {"id": "load", "nodeType": "load-cell", "config": {
                    "ratedOutputMvV": 2.0, "capacity": 100.0, "zeroV": 0.0, "unit": "kg",
                }},
            ],
            "links": [
                {"fromNode": "bridge", "toNode": "load", "toPin": "input"},
                {"fromNode": "excitation", "toNode": "load", "toPin": "excitation"},
            ],
        }
        with patch.object(preview, "read_physical_sources", return_value=({}, [])):
            result = preview.preview_graph(self.service, graph)
        self.assertAlmostEqual(result["values"]["load"]["value"], 100.0)
        self.assertEqual(result["values"]["load"]["unit"], "kg")

    def test_preview_evaluates_simulation_math_without_hardware_values(self) -> None:
        graph = {
            "metadata": {"scanRate": 1000},
            "nodes": [
                {"id": "sine", "nodeType": "sine-wave", "config": {
                    "amplitude": 2.0, "periodS": 4.0, "offset": 10.0,
                    "phaseRad": 0.0, "randomness": 0.0, "unit": "psi",
                }},
                {"id": "gain", "nodeType": "gain", "config": {"gain": 0.5}},
                {"id": "bias", "nodeType": "constant", "config": {"value": 1.0, "unit": "psi"}},
                {"id": "sum", "nodeType": "add", "config": {}},
                {"id": "smooth", "nodeType": "moving-average", "config": {"windowS": 0.5}},
                {"id": "display", "nodeType": "time-plot", "config": {}},
            ],
            "links": [
                {"fromNode": "sine", "toNode": "gain", "toPin": "input"},
                {"fromNode": "gain", "toNode": "sum", "toPin": "a"},
                {"fromNode": "bias", "toNode": "sum", "toPin": "b"},
                {"fromNode": "sum", "toNode": "smooth", "toPin": "input"},
                {"fromNode": "smooth", "toNode": "display", "toPin": "value"},
            ],
        }
        with patch.object(
            preview, "read_physical_sources",
            return_value=({}, ["LabJack T7 is not connected"]),
        ):
            result = preview.preview_graph(self.service, graph, now_s=1.0)
        self.assertAlmostEqual(result["values"]["sine"]["value"], 12.0)
        self.assertAlmostEqual(result["values"]["gain"]["value"], 6.0)
        self.assertAlmostEqual(result["values"]["sum"]["value"], 7.0)
        self.assertAlmostEqual(result["values"]["smooth"]["value"], 7.0)
        self.assertAlmostEqual(result["values"]["display"]["value"], 7.0)
        self.assertEqual(result["values"]["display"]["unit"], "psi")


if __name__ == "__main__":
    import unittest

    unittest.main()

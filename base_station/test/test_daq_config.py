"""Tests for the current persisted DAQ blueprint schema and validation."""

from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase

from base_station.web.daq_config.repository import DaqConfigRepository
from base_station.web.daq_config.schema import normalize_graph
from base_station.web.daq_config.validation import blocking_issues, validate_graph


def channel(node_id: str, ain: str) -> dict:
    return {
        "id": node_id,
        "nodeType": "labjack-channel",
        "pins": [{"id": "channel", "direction": "output", "type": "channel-ref"}],
        "config": {"deviceSerial": None, "deviceIp": "192.168.8.51", "channel": ain},
    }


def pair(node_id: str, positive: str) -> dict:
    return {
        "id": node_id,
        "nodeType": "labjack-channel-pair",
        "pins": [{"id": "pair", "direction": "output", "type": "channel-pair-ref"}],
        "config": {"deviceSerial": None, "deviceIp": "192.168.8.51", "channel": positive},
    }


def differential_graph(positive: str, mux: bool = False) -> dict:
    return {
        "nodes": [
            pair("pair", positive),
            {
                "id": "measurement",
                "nodeType": "labjack-ain",
                "pins": [
                    {
                        "id": "channel",
                        "direction": "input",
                        "type": "channel / pair",
                        "expectedType": ["channel-ref", "channel-pair-ref"],
                    },
                    {"id": "voltage", "direction": "output", "type": "V"},
                ],
                "config": {"rangeV": 0.1},
            },
        ],
        "links": [
            {
                "id": "l1",
                "fromNode": "pair",
                "fromPin": "pair",
                "toNode": "measurement",
                "toPin": "channel",
            },
        ],
        "metadata": {
            "scanRate": 1000,
            "streamResolutionIndex": 0,
            "streamSettlingUs": 0,
            "mux80Enabled": mux,
        },
    }


class DaqConfigTests(TestCase):
    def test_valid_builtin_differential_source(self) -> None:
        self.assertEqual(validate_graph(differential_graph("AIN0")), [])

    def test_mux80_rejects_consumed_builtin_ain(self) -> None:
        graph = {
            "nodes": [channel("input", "AIN4")],
            "links": [],
            "metadata": {"scanRate": 1000, "mux80Enabled": True},
        }
        messages = [issue["message"] for issue in validate_graph(graph)]
        self.assertIn("AIN4-AIN13 are occupied when MUX80 is enabled", messages)

    def test_extended_differential_pair_is_plus_eight(self) -> None:
        self.assertEqual(validate_graph(differential_graph("AIN48", mux=True)), [])

    def test_current_schema_normalizes_only_current_fields(self) -> None:
        normalized = normalize_graph({
            "nodes": [
                {"id": "sine", "nodeType": "sine-wave", "config": {"amplitude": 2, "stale": 99}},
                {"id": "add", "nodeType": "add", "config": {}},
                {"id": "gain", "nodeType": "gain", "config": {}},
                {"id": "average", "nodeType": "moving-average", "config": {}},
                {"id": "number", "nodeType": "number", "config": {"label": "Pressure", "group": "Fuel"}},
                {"id": "gauge", "nodeType": "gauge", "config": {"label": "Pressure", "group": "Fuel"}},
                {"id": "plot", "nodeType": "time-plot", "config": {"label": "Pressure", "group": "Fuel"}},
                {"id": "ain", "nodeType": "labjack-ain", "config": {"rangeV": 1, "stale": 99}},
            ],
            "links": [],
            "metadata": {"name": "Liquid DAQ"},
        })
        nodes = {node["id"]: node for node in normalized["nodes"]}
        self.assertEqual(normalized["metadata"]["schemaVersion"], 1)
        self.assertEqual(normalized["metadata"]["scanRate"], 1000)
        self.assertEqual(normalized["metadata"]["streamResolutionIndex"], 0)
        self.assertEqual(normalized["metadata"]["streamSettlingUs"], 0.0)
        self.assertEqual(nodes["sine"]["config"], {
            "amplitude": 2,
            "periodS": 4,
            "offset": 0,
            "phaseRad": 0,
            "randomness": 0,
            "unit": "V",
        })
        self.assertEqual([pin["id"] for pin in nodes["add"]["pins"]], ["a", "b", "result"])
        self.assertEqual(nodes["gain"]["config"], {"gain": 1})
        self.assertEqual(nodes["average"]["config"], {"windowS": 0.5})
        self.assertEqual(nodes["number"]["config"]["showUnits"], True)
        self.assertNotIn("group", nodes["number"]["config"])
        self.assertEqual(nodes["gauge"]["config"]["type"], "dial-filled")
        self.assertEqual(nodes["gauge"]["config"]["max"], 100)
        self.assertNotIn("gauge", nodes["gauge"]["config"])
        self.assertNotIn("group", nodes["gauge"]["config"])
        self.assertEqual(nodes["plot"]["config"]["xRangeMode"], "shared")
        self.assertEqual(nodes["plot"]["config"]["xLabel"], "Elapsed time")
        self.assertEqual(nodes["plot"]["config"]["yAxisScale"], "linear")
        self.assertNotIn("yScale", nodes["plot"]["config"])
        self.assertEqual(nodes["plot"]["config"]["yRangeMode"], "auto")
        self.assertEqual(nodes["plot"]["config"]["showGrid"], True)
        self.assertEqual(nodes["plot"]["config"]["showMinorGrid"], False)
        self.assertNotIn("group", nodes["plot"]["config"])
        self.assertEqual(nodes["ain"]["config"], {"rangeV": 1})
        self.assertEqual(set(normalized["metadata"]["dashboardLayout"]["items"]), {"number", "gauge", "plot"})

    def test_dashboard_layout_is_bounded_overlap_preserving_and_current(self) -> None:
        normalized = normalize_graph({
            "nodes": [
                {"id": "number", "nodeType": "number", "config": {"label": "Value"}},
                {"id": "gauge", "nodeType": "gauge", "config": {"label": "Gauge"}},
                {"id": "plot", "nodeType": "time-plot", "config": {"label": "Plot"}},
            ],
            "links": [],
            "metadata": {
                "dashboardLayout": {
                    "stale": True,
                    "items": {
                        "number": {"x": 99, "y": -4, "w": 99, "h": 0, "z": 99, "visible": True, "stale": 1},
                        "gauge": {"x": 0, "y": 0, "w": 4, "h": 4, "z": 2, "visible": True},
                        "plot": {"x": 0, "y": 0, "w": 6, "h": 4, "z": 2, "visible": True},
                        "deleted": {"x": 0, "y": 0, "w": 1, "h": 1, "z": 0, "visible": True},
                    },
                },
            },
        })
        layout = normalized["metadata"]["dashboardLayout"]
        self.assertEqual(set(layout), {"items"})
        self.assertEqual(set(layout["items"]), {"number", "gauge", "plot"})
        for item in layout["items"].values():
            self.assertGreaterEqual(item["x"], 0)
            self.assertGreaterEqual(item["y"], 0)
            self.assertLessEqual(item["x"] + item["w"], 12)
            self.assertEqual(set(item), {"x", "y", "w", "h", "z", "visible"})
        self.assertEqual(layout["items"]["gauge"]["x"], 0)
        self.assertEqual(layout["items"]["plot"]["x"], 0)
        self.assertEqual(layout["items"]["gauge"]["y"], 0)
        self.assertEqual(layout["items"]["plot"]["y"], 0)
        self.assertEqual(sorted(item["z"] for item in layout["items"].values()), [0, 1, 2])

    def test_unsupported_node_type_is_rejected(self) -> None:
        graph = {
            "nodes": [{"id": "old", "nodeType": "obsolete-widget", "pins": [], "config": {}}],
            "links": [],
            "metadata": {},
        }
        self.assertIn(
            "Unsupported node type: obsolete-widget",
            [issue["message"] for issue in validate_graph(graph)],
        )

    def test_hardware_reference_cannot_feed_dashboard_widget_directly(self) -> None:
        graph = {
            "nodes": [
                pair("pair", "AIN0"),
                {
                    "id": "number",
                    "nodeType": "number",
                    "config": {"label": "Pressure", "precision": 1, "showUnits": True},
                    "pins": [{
                        "id": "value",
                        "direction": "input",
                        "type": "*",
                        "expectedType": "*",
                        "label": "Value",
                    }],
                },
            ],
            "links": [{"fromNode": "pair", "fromPin": "pair", "toNode": "number", "toPin": "value"}],
            "metadata": {"scanRate": 1000, "mux80Enabled": False},
        }
        messages = [issue["message"] for issue in validate_graph(graph)]
        self.assertIn("Value cannot accept channel-pair-ref", messages)

    def test_invalid_acquisition_settings_are_rejected(self) -> None:
        graph = {
            "nodes": [],
            "links": [],
            "metadata": {"scanRate": 100001, "streamResolutionIndex": 9, "streamSettlingUs": -1},
        }
        messages = [issue["message"] for issue in validate_graph(graph)]
        self.assertIn("Scan rate must be between 1 and 100,000 samples/s", messages)
        self.assertIn("Stream resolution must be Auto or index 1 through 8", messages)
        self.assertIn("Stream settling time cannot be negative", messages)

    def test_repository_round_trip(self) -> None:
        with TemporaryDirectory() as directory:
            path = Path(directory) / "daq.json"
            repository = DaqConfigRepository(path)
            graph = {"nodes": [channel("input", "AIN0")], "links": [], "metadata": {"scanRate": 500}}
            repository.save(graph)
            self.assertEqual(repository.load(), graph)

    def test_unknown_sensor_calibration_is_rejected(self) -> None:
        graph = {
            "nodes": [
                {"id": "pressure", "nodeType": "pressure-calibration", "pins": [], "config": {
                    "inputMin": None, "inputMax": None, "psiMin": None, "psiMax": None,
                }},
                {"id": "load", "nodeType": "load-cell", "pins": [], "config": {
                    "ratedOutputMvV": None, "capacity": None, "zeroV": None,
                    "excitationV": None, "unit": "kg",
                }},
            ],
            "links": [],
        }
        messages = [issue["message"] for issue in validate_graph(graph)]
        self.assertIn("Pressure calibration requires all four calibration values", messages)
        self.assertIn("Load cell rated output must be positive", messages)
        self.assertIn("Load cell zero offset is required", messages)
        self.assertIn("Load cell excitation must be positive", messages)

    def test_missing_required_input_is_a_non_blocking_warning(self) -> None:
        graph = {
            "nodes": [{
                "id": "load",
                "nodeType": "load-cell",
                "pins": [
                    {"id": "input", "label": "Bridge voltage", "direction": "input", "type": "V"},
                    {"id": "load", "label": "Load", "direction": "output", "type": "kg"},
                ],
                "config": {
                    "ratedOutputMvV": 1.0,
                    "capacity": 1.0,
                    "zeroV": 0.0,
                    "excitationV": 5.0,
                    "unit": "kg",
                },
            }],
            "links": [],
        }
        issues = validate_graph(graph)
        self.assertIn("Bridge voltage is not connected", [issue["message"] for issue in issues])
        self.assertEqual([issue["severity"] for issue in issues], ["warning"])
        self.assertEqual(blocking_issues(issues), [])

    def test_number_settings_are_constrained(self) -> None:
        graph = {
            "nodes": [{
                "id": "number",
                "nodeType": "number",
                "pins": [],
                "config": {"label": "", "precision": 9, "showUnits": "yes"},
            }],
            "links": [],
        }
        messages = [issue["message"] for issue in validate_graph(graph)]
        self.assertIn("Dashboard widget requires a label", messages)
        self.assertIn("Dashboard decimal places must be 0 through 6", messages)
        self.assertIn("Number showUnits must be on or off", messages)

    def test_gauge_settings_are_constrained(self) -> None:
        graph = {
            "nodes": [{
                "id": "gauge",
                "nodeType": "gauge",
                "pins": [],
                "config": {
                    "label": "Tank pressure",
                    "precision": 1,
                    "type": "dial-filled",
                    "showValue": True,
                    "showUnits": True,
                    "showRange": True,
                    "min": 100,
                    "low": 20,
                    "high": 10,
                    "max": 0,
                },
            }],
            "links": [],
        }
        self.assertIn(
            "Gauge maximum must be greater than minimum",
            [issue["message"] for issue in validate_graph(graph)],
        )

    def test_time_plot_settings_are_constrained(self) -> None:
        graph = {
            "nodes": [{
                "id": "plot",
                "nodeType": "time-plot",
                "pins": [],
                "config": {
                    "label": "Pressure",
                    "xRangeMode": "fixed",
                    "xMinS": 20,
                    "xMaxS": 10,
                    "xTickMode": "manual",
                    "xMajorStepS": 0,
                    "yAxisScale": "log10",
                    "yRangeMode": "fixed",
                    "yMin": 0,
                    "yMax": 5,
                    "yTickMode": "manual",
                    "yMajorStep": 0,
                },
            }],
            "links": [],
        }
        messages = [issue["message"] for issue in validate_graph(graph)]
        self.assertIn("Time-plot X maximum must be greater than X minimum", messages)
        self.assertIn("Time-plot X major step must be positive", messages)
        self.assertIn("Time-plot logarithmic Y minimum must be greater than zero", messages)

    def test_time_plot_soft_log_bounds_are_constrained(self) -> None:
        graph = {
            "nodes": [{
                "id": "plot",
                "nodeType": "time-plot",
                "pins": [],
                "config": {
                    "label": "Pressure",
                    "yAxisScale": "log10",
                    "yRangeMode": "soft",
                    "ySoftMin": -1,
                    "ySoftMax": 0,
                },
            }],
            "links": [],
        }
        messages = [issue["message"] for issue in validate_graph(graph)]
        self.assertIn("Time-plot logarithmic Y soft minimum must be greater than zero", messages)
        self.assertIn("Time-plot logarithmic Y soft maximum must be greater than zero", messages)

    def test_simulation_and_smoothing_parameters_are_constrained(self) -> None:
        graph = {
            "nodes": [
                {"id": "sine", "nodeType": "sine-wave", "pins": [], "config": {
                    "amplitude": 1.0,
                    "periodS": -1.0,
                    "offset": 0.0,
                    "phaseRad": 0.0,
                    "randomness": 0.0,
                    "unit": "V",
                }},
                {"id": "gain", "nodeType": "gain", "pins": [], "config": {"gain": float("inf")}},
                {"id": "average", "nodeType": "moving-average", "pins": [], "config": {"windowS": 0}},
            ],
            "links": [],
        }
        messages = [issue["message"] for issue in validate_graph(graph)]
        self.assertIn("Sine-wave period cannot be negative", messages)
        self.assertIn("Gain must be finite", messages)
        self.assertIn("Moving-average window must be positive", messages)


if __name__ == "__main__":
    import unittest

    unittest.main()

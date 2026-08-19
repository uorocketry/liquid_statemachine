"""Tests for persisted DAQ blueprint validation."""

from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase

from base_station.web.daq_config.migration import migrate_graph
from base_station.web.daq_config.repository import DaqConfigRepository
from base_station.web.daq_config.validation import validate_graph


def source(node_id: str, channel: str = "AIN0") -> dict:
    return {
        "id": node_id,
        "nodeType": "labjack-ain",
        "pins": [{"id": "voltage", "direction": "output", "type": "V"}],
        "config": {
            "channel": channel,
            "mode": "differential",
            "negativeChannel": f"AIN{int(channel[3:]) + (8 if int(channel[3:]) >= 16 else 1)}",
        },
    }


def channel(node_id: str, ain: str) -> dict:
    return {
        "id": node_id,
        "nodeType": "labjack-channel",
        "pins": [{"id": "channel", "direction": "output", "type": "channel-ref"}],
        "config": {"channel": ain},
    }


def pair(node_id: str, positive: str) -> dict:
    return {
        "id": node_id,
        "nodeType": "labjack-channel-pair",
        "pins": [{"id": "pair", "direction": "output", "type": "channel-pair-ref"}],
        "config": {"channel": positive},
    }


def differential_graph(positive: str, mux: bool = False) -> dict:
    return {
        "nodes": [
            pair("pair", positive),
            {
                "id": "measurement",
                "nodeType": "labjack-ain",
                "pins": [
                    {"id": "channel", "direction": "input", "type": "channel-pair-ref"},
                    {"id": "voltage", "direction": "output", "type": "V"},
                ],
                "config": {"rangeV": 0.1, "resolutionIndex": 0, "settlingUs": 0},
            },
        ],
        "links": [
            {"id": "l1", "fromNode": "pair", "fromPin": "pair", "toNode": "measurement", "toPin": "channel"},
        ],
        "metadata": {"scanRate": 1000, "mux80Enabled": mux},
    }


class DaqConfigTests(TestCase):
    def test_valid_builtin_differential_source(self) -> None:
        graph = differential_graph("AIN0")
        self.assertEqual(validate_graph(graph), [])

    def test_mux80_rejects_consumed_builtin_ain(self) -> None:
        graph = {"nodes": [channel("input", "AIN4")], "links": [], "metadata": {"scanRate": 1000, "mux80Enabled": True}}
        messages = [issue["message"] for issue in validate_graph(graph)]
        self.assertIn("AIN4-AIN13 are occupied when MUX80 is enabled", messages)

    def test_extended_differential_pair_is_plus_eight(self) -> None:
        graph = differential_graph("AIN48", mux=True)
        self.assertEqual(validate_graph(graph), [])

    def test_legacy_measurement_is_migrated_to_channel_references(self) -> None:
        migrated = migrate_graph({
            "nodes": [source("pressure")],
            "links": [],
            "metadata": {"scanRate": 1000, "mux80Enabled": False},
        })
        measurement = next(node for node in migrated["nodes"] if node["id"] == "pressure")
        pairs = [node for node in migrated["nodes"] if node.get("nodeType") == "labjack-channel-pair"]
        self.assertEqual(len(pairs), 1)
        self.assertNotIn("channel", measurement["config"])
        self.assertEqual({link["toPin"] for link in migrated["links"]}, {"channel"})
        self.assertEqual(validate_graph(migrated), [])

    def test_two_channel_reference_nodes_collapse_to_one_pair(self) -> None:
        graph = {
            "nodes": [
                {**channel("positive", "AIN0"), "x": 10, "y": 20},
                {**channel("negative", "AIN1"), "x": 10, "y": 120},
                {
                    "id": "measurement", "nodeType": "labjack-ain", "x": 300, "y": 40,
                    "pins": [
                        {"id": "positive", "direction": "input", "type": "channel-ref"},
                        {"id": "negative", "direction": "input", "type": "channel-ref"},
                        {"id": "voltage", "direction": "output", "type": "V"},
                    ],
                    "config": {"rangeV": 0.1, "resolutionIndex": 0, "settlingUs": 0},
                },
            ],
            "links": [
                {"id": "l1", "fromNode": "positive", "fromPin": "channel", "toNode": "measurement", "toPin": "positive"},
                {"id": "l2", "fromNode": "negative", "fromPin": "channel", "toNode": "measurement", "toPin": "negative"},
            ],
            "metadata": {"scanRate": 1000, "mux80Enabled": False},
        }
        migrated = migrate_graph(graph)
        self.assertEqual(len([node for node in migrated["nodes"] if node.get("nodeType") == "labjack-channel-pair"]), 1)
        self.assertFalse(any(node.get("id") in {"positive", "negative"} for node in migrated["nodes"]))
        self.assertEqual(migrated["links"][0]["toPin"], "channel")
        self.assertEqual(validate_graph(migrated), [])

    def test_hardware_reference_cannot_feed_dashboard_directly(self) -> None:
        graph = {
            "nodes": [
                {
                    "id": "pair", "nodeType": "labjack-channel-pair",
                    "config": {"channel": "AIN0"},
                    "pins": [{"id": "pair", "direction": "output", "type": "channel-pair-ref"}],
                },
                {
                    "id": "display", "nodeType": "dashboard-signal",
                    "config": {"label": "Pressure", "group": "Engine", "display": "both", "precision": 1},
                    "pins": [{"id": "value", "direction": "input", "type": "*", "expectedType": "*", "label": "Value"}],
                },
            ],
            "links": [{"fromNode": "pair", "fromPin": "pair", "toNode": "display", "toPin": "value"}],
            "metadata": {"scanRate": 1000, "mux80Enabled": False},
        }
        messages = [issue["message"] for issue in validate_graph(graph)]
        self.assertIn("Value cannot accept channel-pair-ref", messages)

    def test_invalid_scan_rate_is_rejected(self) -> None:
        graph = {"nodes": [], "links": [], "metadata": {"scanRate": 100001}}
        self.assertIn("Scan rate", validate_graph(graph)[0]["message"])

    def test_repository_round_trip(self) -> None:
        with TemporaryDirectory() as directory:
            path = Path(directory) / "daq.json"
            repository = DaqConfigRepository(path)
            graph = {"nodes": [source("pressure")], "links": [], "metadata": {"scanRate": 500}}
            repository.save(graph)
            self.assertEqual(repository.load(), graph)

    def test_unknown_sensor_calibration_is_rejected(self) -> None:
        graph = {
            "nodes": [
                {"id": "pressure", "nodeType": "pressure-calibration", "pins": [], "config": {
                    "inputMin": None, "inputMax": None, "psiMin": None, "psiMax": None,
                }},
                {"id": "load", "nodeType": "load-cell", "pins": [], "config": {
                    "ratedOutputMvV": None, "capacity": None, "zeroV": None, "unit": "kg",
                }},
            ],
            "links": [],
        }
        messages = [issue["message"] for issue in validate_graph(graph)]
        self.assertIn("Pressure calibration requires all four calibration values", messages)
        self.assertIn("Load cell rated output must be positive", messages)
        self.assertIn("Load cell zero offset is required", messages)
        self.assertIn("Load cell excitation must be positive", messages)

    def test_dashboard_metadata_is_constrained(self) -> None:
        graph = {
            "nodes": [{
                "id": "display", "nodeType": "dashboard-signal", "pins": [],
                "config": {"label": "", "group": "System", "display": "both", "precision": 9},
            }],
            "links": [],
        }
        messages = [issue["message"] for issue in validate_graph(graph)]
        self.assertIn("Dashboard signal requires a label", messages)
        self.assertIn("Dashboard group must be Fuel, LOX, or Engine", messages)
        self.assertIn("Dashboard decimal places must be 0 through 6", messages)


if __name__ == "__main__":
    import unittest

    unittest.main()

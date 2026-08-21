import sqlite3
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase

from base_station.web.daq_config.acquisition import SampleBatch, SignalDescriptor
from base_station.web.run_repository import RunRepository, SCHEMA_VERSION


SIGNALS = (
    SignalDescriptor("pressure", "Chamber pressure", "psi"),
    SignalDescriptor("temperature", "Injector temperature", "K"),
)


class RunRepositoryTests(TestCase):
    def setUp(self) -> None:
        self.temporary = TemporaryDirectory()
        self.repository = RunRepository(Path(self.temporary.name) / "runs.sqlite3")

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def start_run(self, rate: int = 1_000) -> int:
        return self.repository.start_run(rate, SIGNALS, source_id="test-source")

    def test_run_lifecycle_window_and_csv_export(self) -> None:
        run_id = self.start_run()
        self.repository.add_batch(run_id, SampleBatch(0, {
            "pressure": [1.0, 2.0, 3.0],
            "temperature": [290.0, 291.0, 292.0],
        }))
        self.repository.finish_run(run_id, "completed", 3, None)

        run = self.repository.get_run(run_id)
        self.assertEqual(run["sample_count"], 3)
        self.assertEqual(run["status"], "completed")
        self.assertEqual(run["source_id"], "test-source")
        self.assertEqual(run["signals"], [
            {"id": "pressure", "label": "Chamber pressure", "unit": "psi"},
            {"id": "temperature", "label": "Injector temperature", "unit": "K"},
        ])
        samples = self.repository.sample_window(run_id, 0, 3, 20)
        self.assertEqual(len(samples), 3)
        self.assertEqual(samples[1]["values"]["pressure"]["mean"], 2.0)
        exported = "".join(self.repository.csv_rows(run_id))
        self.assertIn("time_s,pressure,temperature", exported)
        self.assertIn("0.002000000,3,292", exported)

    def test_delete_removes_run_and_chunks(self) -> None:
        run_id = self.start_run(10)
        self.repository.add_batch(run_id, SampleBatch(0, {
            "pressure": [1.0], "temperature": [2.0],
        }))

        self.assertTrue(self.repository.delete_run(run_id))
        self.assertIsNone(self.repository.get_run(run_id))
        self.assertEqual(self.repository.sample_window(run_id, 0, 1, 20), [])

    def test_backup_is_a_readable_database(self) -> None:
        self.start_run(10)
        backup = self.repository.backup_bytes()
        self.assertTrue(backup.startswith(b"SQLite format 3"))

    def test_decimation_returns_bounded_statistics_and_export_stays_raw(self) -> None:
        run_id = self.start_run(10)
        self.repository.add_batch(run_id, SampleBatch(0, {
            "pressure": [0.0, 10.0, 0.0],
            "temperature": [0.0, 0.0, 9.0],
        }))

        samples = self.repository.sample_window(run_id, 0, 3, 2)

        self.assertEqual(len(samples), 2)
        pressure = samples[0]["values"]["pressure"]
        self.assertEqual(pressure["min"], 0.0)
        self.assertEqual(pressure["max"], 10.0)
        self.assertEqual(pressure["mean"], 5.0)
        self.assertEqual(samples[0]["sample_count"], 2)
        self.assertIn("0.100000000,10,0", "".join(self.repository.csv_rows(run_id)))

    def test_batches_must_match_run_signal_contract(self) -> None:
        run_id = self.start_run(10)
        with self.assertRaisesRegex(ValueError, "signal mismatch"):
            self.repository.add_batch(run_id, SampleBatch(0, {"pressure": [1.0]}))
        with self.assertRaisesRegex(ValueError, "equal lengths"):
            self.repository.add_batch(run_id, SampleBatch(0, {
                "pressure": [1.0], "temperature": [2.0, 3.0],
            }))
        with self.assertRaisesRegex(ValueError, "start index"):
            self.repository.add_batch(run_id, SampleBatch(-1, {
                "pressure": [1.0], "temperature": [2.0],
            }))

    def test_run_contract_rejects_invalid_source_metadata(self) -> None:
        with self.assertRaisesRegex(ValueError, "scan rate"):
            self.repository.start_run(0, SIGNALS, source_id="test")
        with self.assertRaisesRegex(ValueError, "source id"):
            self.repository.start_run(10, SIGNALS, source_id="")
        with self.assertRaisesRegex(ValueError, "display labels"):
            self.repository.start_run(
                10,
                (SignalDescriptor("signal", "", "V"),),
                source_id="test",
            )

    def test_current_schema_replaces_pre_release_two_channel_store(self) -> None:
        path = Path(self.temporary.name) / "legacy.sqlite3"
        with sqlite3.connect(path) as connection:
            connection.executescript(
                """
                CREATE TABLE runs (id INTEGER PRIMARY KEY, scan_rate INTEGER);
                CREATE TABLE samples (run_id INTEGER, channel_a REAL, channel_b REAL);
                INSERT INTO runs VALUES (1, 1000);
                """
            )
        repository = RunRepository(path)
        with repository._connect() as connection:
            version = connection.execute("PRAGMA user_version").fetchone()[0]
            columns = {
                row[1] for row in connection.execute("PRAGMA table_info(runs)")
            }
        self.assertEqual(version, SCHEMA_VERSION)
        self.assertIn("source_id", columns)
        self.assertEqual(repository.list_runs(), [])


if __name__ == "__main__":
    import unittest

    unittest.main()

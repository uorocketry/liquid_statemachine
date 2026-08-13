from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase

from base_station.web.run_repository import RunRepository


class RunRepositoryTests(TestCase):
    def setUp(self) -> None:
        self.temporary = TemporaryDirectory()
        self.repository = RunRepository(Path(self.temporary.name) / "runs.sqlite3")

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_run_lifecycle_window_and_csv_export(self) -> None:
        run_id = self.repository.start_run(1_000)
        self.repository.add_samples(run_id, 0, [1.0, 2.0, 3.0], [-1.0, -2.0, -3.0])
        self.repository.finish_run(run_id, "completed", 3, None)

        run = self.repository.get_run(run_id)
        self.assertEqual(run["sample_count"], 3)
        self.assertEqual(run["status"], "completed")
        self.assertEqual(len(self.repository.sample_window(run_id, 0, 3, 20)), 3)
        exported = "".join(self.repository.csv_rows(run_id))
        self.assertIn("time_s,ain0_minus_ain1_v", exported)
        self.assertIn("0.002000000,3,-3", exported)

    def test_delete_removes_run_and_samples(self) -> None:
        run_id = self.repository.start_run(10)
        self.repository.add_samples(run_id, 0, [1.0], [2.0])

        self.assertTrue(self.repository.delete_run(run_id))
        self.assertIsNone(self.repository.get_run(run_id))
        self.assertEqual(self.repository.sample_window(run_id, 0, 1, 20), [])

    def test_backup_is_a_readable_database(self) -> None:
        self.repository.start_run(10)
        backup = self.repository.backup_bytes()
        self.assertTrue(backup.startswith(b"SQLite format 3"))

    def test_decimation_returns_bounded_statistics_and_export_stays_raw(self) -> None:
        run_id = self.repository.start_run(10)
        self.repository.add_samples(run_id, 0, [0.0, 10.0, 0.0], [0.0, 0.0, 9.0])

        samples = self.repository.sample_window(run_id, 0, 3, 2)

        self.assertEqual(len(samples), 2)
        self.assertEqual(samples[0]["a_min"], 0.0)
        self.assertEqual(samples[0]["a_max"], 10.0)
        self.assertEqual(samples[0]["a_mean"], 5.0)
        self.assertEqual(samples[0]["sample_count"], 2)
        self.assertIn("0.100000000,10,0", "".join(self.repository.csv_rows(run_id)))

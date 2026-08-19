from __future__ import annotations

import unittest

from base_station import cli


class OtaLayoutTests(unittest.TestCase):
    def test_flash_regions_do_not_overlap(self) -> None:
        self.assertEqual(cli.UPDATER_BASE + cli.UPDATER_SIZE, cli.APP_A_BASE)
        self.assertEqual(cli.APP_A_BASE + cli.APP_SLOT_SIZE, cli.APP_B_BASE)
        self.assertLessEqual(cli.APP_B_BASE + cli.APP_SLOT_SIZE, 0x38000)

    def test_version_and_build_identity_are_available(self) -> None:
        self.assertRegex(cli._version(), r"^\d+\.\d+\.\d+$")
        build_id = cli._application_build_id()
        self.assertRegex(build_id, r"^[0-9a-f]{12}$")
        self.assertEqual(build_id, cli._application_build_id())

    def test_slot_addresses_are_the_ota_link_addresses(self) -> None:
        self.assertEqual(cli.SLOT_BASES, {"A": 0x08000, "B": 0x20000})


if __name__ == "__main__":
    unittest.main()

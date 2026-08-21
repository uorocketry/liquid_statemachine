"""Stable console entry points for P1AM firmware tooling."""

from base_station.firmware_cli.build import application_build_id as _application_build_id
from base_station.firmware_cli.build import compile_firmware, version as _version
from base_station.firmware_cli.ota import ota_firmware, system_firmware
from base_station.firmware_cli.paths import (
    APP_A_BASE, APP_B_BASE, APP_SLOT_SIZE, RECOVERY_BIN, SLOT_BASES,
    UPDATER_BASE, UPDATER_SIZE,
)
from base_station.firmware_cli.usb import upload_firmware

__all__ = [
    "compile_firmware", "upload_firmware", "ota_firmware", "system_firmware",
    "UPDATER_BASE", "UPDATER_SIZE", "APP_A_BASE", "APP_B_BASE", "APP_SLOT_SIZE",
    "SLOT_BASES", "RECOVERY_BIN", "_application_build_id", "_version",
]


if __name__ == "__main__":
    compile_firmware()

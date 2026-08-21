from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

FQBN = "P1AM-100:samd:P1AM-100_native"
PROJECT_DIR = Path(__file__).resolve().parents[3]
REPOSITORY_DIR = PROJECT_DIR.parent
SKETCH_DIR = REPOSITORY_DIR / "fill_cart"
UPDATER_SKETCH_DIR = REPOSITORY_DIR / "p1am_updater"
FIRMWARE_LIBRARIES_DIR = REPOSITORY_DIR / "firmware_libs"
BUILD_ROOT = PROJECT_DIR / ".build" / "ota"
UPDATER_BUILD_DIR = BUILD_ROOT / "updater"
APP_A_BUILD_DIR = BUILD_ROOT / "app_a"
APP_B_BUILD_DIR = BUILD_ROOT / "app_b"
RECOVERY_BIN = BUILD_ROOT / "p1am-recovery.bin"
MANIFEST_PATH = BUILD_ROOT / "manifest.json"
DEFAULT_HOST = "192.168.8.50"
DEFAULT_PORT = 80

UPDATER_BASE = 0x02000
UPDATER_SIZE = 0x06000
APP_A_BASE = 0x08000
APP_B_BASE = 0x20000
APP_SLOT_SIZE = 0x18000
RAM_BASE = 0x20000000
RAM_END = 0x20008000

SLOT_BASES = {"A": APP_A_BASE, "B": APP_B_BASE}
SLOT_BUILD_DIRS = {"A": APP_A_BUILD_DIR, "B": APP_B_BUILD_DIR}


def arduino_cli() -> str:
    executable = shutil.which("arduino-cli")
    if executable is None:
        raise SystemExit(
            "arduino-cli is not installed or is not on PATH. "
            "See https://arduino.github.io/arduino-cli/latest/installation/"
        )
    return executable


def run(command: list[str], *, cwd: Path | None = None) -> None:
    result = subprocess.run(command, cwd=cwd, check=False)
    if result.returncode:
        raise SystemExit(result.returncode)

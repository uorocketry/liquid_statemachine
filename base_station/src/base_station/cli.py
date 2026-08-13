"""Command-line entry points for the GUI and P1AM firmware."""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
from pathlib import Path

FQBN = "P1AM-100:samd:P1AM-100_native"
PROJECT_DIR = Path(__file__).resolve().parents[2]
REPOSITORY_DIR = PROJECT_DIR.parent
SKETCH_DIR = REPOSITORY_DIR / "phil_cart"
BUILD_DIR = PROJECT_DIR / ".build" / "arduino"


def _arduino_cli() -> str:
    executable = shutil.which("arduino-cli")
    if executable is None:
        raise SystemExit(
            "arduino-cli is not installed or is not on PATH. "
            "See https://arduino.github.io/arduino-cli/latest/installation/"
        )
    return executable


def _run_arduino(*arguments: str) -> None:
    if not SKETCH_DIR.is_dir():
        raise SystemExit(f"Firmware sketch not found: {SKETCH_DIR}")

    BUILD_DIR.mkdir(parents=True, exist_ok=True)
    command = [
        _arduino_cli(),
        "compile",
        "--fqbn",
        FQBN,
        "--build-path",
        str(BUILD_DIR),
        *arguments,
        str(SKETCH_DIR),
    ]
    raise SystemExit(subprocess.run(command, check=False).returncode)


def compile_firmware() -> None:
    """Compile the P1AM firmware without modifying connected hardware."""
    _run_arduino()


def _detect_p1am_port() -> str:
    result = subprocess.run(
        [_arduino_cli(), "board", "list", "--format", "json"],
        check=True,
        capture_output=True,
        text=True,
    )
    payload = json.loads(result.stdout)
    detected_ports: list[str] = []

    for item in payload.get("detected_ports", []):
        port = item.get("port", {})
        matching_boards = item.get("matching_boards", [])
        if any(board.get("fqbn") == FQBN for board in matching_boards):
            address = port.get("address")
            if address:
                detected_ports.append(address)

    if not detected_ports:
        raise SystemExit(
            "No connected P1AM-100 was detected. Connect it or pass "
            "`uv run upload --port /dev/cu...`."
        )
    if len(detected_ports) > 1:
        ports = ", ".join(detected_ports)
        raise SystemExit(
            f"Multiple P1AM-100 boards detected ({ports}). "
            "Select one with `uv run upload --port PORT`."
        )
    return detected_ports[0]


def upload_firmware() -> None:
    """Compile and upload the P1AM firmware."""
    parser = argparse.ArgumentParser(
        prog="upload",
        description="Compile and upload the phil_cart firmware to a P1AM-100.",
    )
    parser.add_argument(
        "--port",
        help="Serial port to use; auto-detected when omitted.",
    )
    arguments = parser.parse_args()
    port = arguments.port or _detect_p1am_port()
    print(f"Uploading P1AM firmware through {port}...")
    _run_arduino("--upload", "--port", port)

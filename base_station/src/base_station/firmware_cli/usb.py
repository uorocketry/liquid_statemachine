from __future__ import annotations

import argparse
import json
import subprocess

from .build import build_all
from .paths import FQBN, RECOVERY_BIN, UPDATER_SKETCH_DIR, arduino_cli, run


def detect_p1am_port() -> str:
    result = subprocess.run(
        [arduino_cli(), "board", "list", "--format", "json"],
        check=True, capture_output=True, text=True,
    )
    payload = json.loads(result.stdout)
    detected_ports = []
    for item in payload.get("detected_ports", []):
        port = item.get("port", {})
        if any(board.get("fqbn") == FQBN for board in item.get("matching_boards", [])):
            if address := port.get("address"):
                detected_ports.append(address)
    if not detected_ports:
        raise SystemExit("No connected P1AM-100 was detected. Connect it or pass `uv run upload --port /dev/cu...`.")
    if len(detected_ports) > 1:
        raise SystemExit(
            f"Multiple P1AM-100 boards detected ({', '.join(detected_ports)}). "
            "Select one with `uv run upload --port PORT`."
        )
    return detected_ports[0]


def upload_firmware() -> None:
    parser = argparse.ArgumentParser(
        prog="upload",
        description="Bootstrap/recover the P1AM OTA layout through its factory USB bootloader.",
    )
    parser.add_argument("--port", help="Serial port; auto-detected when omitted.")
    arguments = parser.parse_args()
    build_all()
    port = arguments.port or detect_p1am_port()
    print(f"Uploading complete recovery image through {port}...")
    run([
        arduino_cli(), "upload", "--fqbn", FQBN, "--port", port,
        "--input-file", str(RECOVERY_BIN), str(UPDATER_SKETCH_DIR),
    ])

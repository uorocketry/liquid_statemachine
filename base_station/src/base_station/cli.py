"""Command-line entry points for the GUI and P1AM firmware."""

from __future__ import annotations

import argparse
import hashlib
import http.client
import json
import re
import shutil
import struct
import subprocess
import time
import zlib
from pathlib import Path

FQBN = "P1AM-100:samd:P1AM-100_native"
PROJECT_DIR = Path(__file__).resolve().parents[2]
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


def _arduino_cli() -> str:
    executable = shutil.which("arduino-cli")
    if executable is None:
        raise SystemExit(
            "arduino-cli is not installed or is not on PATH. "
            "See https://arduino.github.io/arduino-cli/latest/installation/"
        )
    return executable


def _run(command: list[str], *, cwd: Path | None = None) -> None:
    result = subprocess.run(command, cwd=cwd, check=False)
    if result.returncode:
        raise SystemExit(result.returncode)


def _version() -> str:
    version_header = SKETCH_DIR / "version.h"
    match = re.search(
        r'^\s*#define\s+FILL_CART_VERSION\s+"([^"]+)"',
        version_header.read_text(),
        re.MULTILINE,
    )
    if match is None:
        raise SystemExit(f"FILL_CART_VERSION not found in {version_header}")
    return match.group(1)


def _application_build_id(extra_cpp_flags: tuple[str, ...] = ()) -> str:
    digest = hashlib.sha256()
    roots = [SKETCH_DIR, FIRMWARE_LIBRARIES_DIR / "P1AMOta"]
    for root in roots:
        for path in sorted(item for item in root.rglob("*") if item.is_file()):
            digest.update(path.relative_to(REPOSITORY_DIR).as_posix().encode())
            digest.update(b"\0")
            digest.update(path.read_bytes())
            digest.update(b"\0")
    for flag in extra_cpp_flags:
        digest.update(flag.encode())
        digest.update(b"\0")
    return "b" + digest.hexdigest()[:11]


def _compile_sketch(
    sketch_dir: Path,
    build_dir: Path,
    *,
    cpp_flags: tuple[str, ...] = (),
    link_address: int | None = None,
) -> None:
    if not sketch_dir.is_dir():
        raise SystemExit(f"Firmware sketch not found: {sketch_dir}")

    build_dir.mkdir(parents=True, exist_ok=True)
    command = [
        _arduino_cli(),
        "compile",
        "--fqbn",
        FQBN,
        "--libraries",
        str(FIRMWARE_LIBRARIES_DIR),
        "--build-path",
        str(build_dir),
    ]
    if cpp_flags:
        command.extend(
            [
                "--build-property",
                "compiler.cpp.extra_flags=" + " ".join(cpp_flags),
            ]
        )
    if link_address is not None:
        command.extend(
            [
                "--build-property",
                f"compiler.c.elf.extra_flags=-Wl,--section-start=.text=0x{link_address:x}",
            ]
        )
    command.append(str(sketch_dir))
    _run(command)


def _app_artifacts(slot: str) -> tuple[Path, Path]:
    build_dir = SLOT_BUILD_DIRS[slot]
    return build_dir / "fill_cart.ino.bin", build_dir / "fill_cart.ino.elf"


def _updater_artifacts() -> tuple[Path, Path]:
    return (
        UPDATER_BUILD_DIR / "p1am_updater.ino.bin",
        UPDATER_BUILD_DIR / "p1am_updater.ino.elf",
    )


def _objdump() -> str:
    candidates = sorted(
        (Path.home() / "Library/Arduino15/packages/arduino/tools/arm-none-eabi-gcc").glob(
            "*/bin/arm-none-eabi-objdump"
        )
    )
    if not candidates:
        executable = shutil.which("arm-none-eabi-objdump")
        if executable:
            return executable
        raise SystemExit("arm-none-eabi-objdump was not found")
    return str(candidates[-1])


def _text_address(elf_path: Path) -> int:
    result = subprocess.run(
        [_objdump(), "-h", str(elf_path)],
        check=True,
        capture_output=True,
        text=True,
    )
    for line in result.stdout.splitlines():
        columns = line.split()
        if len(columns) >= 6 and columns[1] == ".text":
            return int(columns[3], 16)
    raise SystemExit(f"Could not find .text in {elf_path}")


def _validate_binary(binary_path: Path, expected_base: int, max_size: int, label: str) -> dict:
    payload = binary_path.read_bytes()
    if not payload:
        raise SystemExit(f"{label} binary is empty: {binary_path}")
    if len(payload) > max_size:
        raise SystemExit(
            f"{label} is {len(payload)} bytes, exceeding its {max_size}-byte flash reservation"
        )

    if label.startswith("App"):
        if len(payload) < 8:
            raise SystemExit(f"{label} binary is too small to contain a vector table")
        stack_pointer, reset_handler = struct.unpack_from("<II", payload)
        reset_address = reset_handler & ~1
        if not RAM_BASE <= stack_pointer <= RAM_END:
            raise SystemExit(
                f"{label} initial stack pointer 0x{stack_pointer:08x} is outside SAMD21 SRAM"
            )
        if not (reset_handler & 1) or not expected_base <= reset_address < expected_base + max_size:
            raise SystemExit(
                f"{label} reset vector 0x{reset_handler:08x} is outside its flash slot"
            )

    return {
        "bytes": len(payload),
        "crc32": f"{zlib.crc32(payload) & 0xFFFFFFFF:08x}",
    }


def _compile_updater() -> dict:
    print("Compiling P1AM second-stage updater...")
    _compile_sketch(UPDATER_SKETCH_DIR, UPDATER_BUILD_DIR)
    binary_path, elf_path = _updater_artifacts()
    address = _text_address(elf_path)
    if address != UPDATER_BASE:
        raise SystemExit(f"Updater .text is at 0x{address:x}, expected 0x{UPDATER_BASE:x}")
    info = _validate_binary(binary_path, UPDATER_BASE, UPDATER_SIZE, "Updater")
    info["address"] = f"0x{UPDATER_BASE:05x}"
    return info


def _compile_app(
    slot: str,
    *,
    build_id: str | None = None,
    extra_cpp_flags: tuple[str, ...] = (),
) -> dict:
    if slot not in SLOT_BASES:
        raise ValueError(slot)
    build_id = build_id or _application_build_id(extra_cpp_flags)
    cpp_flags = (
        f"-DP1AM_OTA_SLOT={0 if slot == 'A' else 1}",
        f"-DP1AM_OTA_BUILD_TOKEN={build_id}",
        *extra_cpp_flags,
    )
    print(f"Compiling Fill Cart for slot {slot} @ 0x{SLOT_BASES[slot]:05x} (build {build_id})...")
    _compile_sketch(
        SKETCH_DIR,
        SLOT_BUILD_DIRS[slot],
        cpp_flags=cpp_flags,
        link_address=SLOT_BASES[slot],
    )
    binary_path, elf_path = _app_artifacts(slot)
    address = _text_address(elf_path)
    if address != SLOT_BASES[slot]:
        raise SystemExit(
            f"App {slot} .text is at 0x{address:x}, expected 0x{SLOT_BASES[slot]:x}"
        )
    info = _validate_binary(binary_path, SLOT_BASES[slot], APP_SLOT_SIZE, f"App {slot}")
    info.update(
        address=f"0x{SLOT_BASES[slot]:05x}",
        version=_version(),
        build=build_id,
        binary=str(binary_path),
    )
    return info


def _build_recovery(updater_info: dict, app_a_info: dict) -> dict:
    updater_bin, _ = _updater_artifacts()
    app_a_bin, _ = _app_artifacts("A")
    updater = updater_bin.read_bytes()
    app_a = app_a_bin.read_bytes()
    app_offset = APP_A_BASE - UPDATER_BASE
    if len(updater) > app_offset:
        raise SystemExit("Updater overlaps App A in the recovery image")

    payload = updater + b"\xff" * (app_offset - len(updater)) + app_a
    BUILD_ROOT.mkdir(parents=True, exist_ok=True)
    RECOVERY_BIN.write_bytes(payload)
    return {
        "bytes": len(payload),
        "crc32": f"{zlib.crc32(payload) & 0xFFFFFFFF:08x}",
        "binary": str(RECOVERY_BIN),
        "updater": updater_info,
        "app_a": app_a_info,
    }


def _write_manifest(manifest: dict) -> None:
    BUILD_ROOT.mkdir(parents=True, exist_ok=True)
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2) + "\n")


def _build_all() -> dict:
    updater = _compile_updater()
    build_id = _application_build_id()
    app_a = _compile_app("A", build_id=build_id)
    app_b = _compile_app("B", build_id=build_id)
    recovery = _build_recovery(updater, app_a)
    manifest = {
        "version": _version(),
        "build": build_id,
        "updater": updater,
        "slots": {"A": app_a, "B": app_b},
        "recovery": recovery,
    }
    _write_manifest(manifest)
    return manifest


def compile_firmware() -> None:
    """Compile updater, A/B applications, and the USB recovery image."""
    manifest = _build_all()
    print(
        f"OTA artifacts ready: updater {manifest['updater']['bytes']} B, "
        f"A {manifest['slots']['A']['bytes']} B, B {manifest['slots']['B']['bytes']} B"
    )
    print(f"Recovery image: {RECOVERY_BIN}")


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
    """Build and USB-flash the complete updater + App A recovery image."""
    parser = argparse.ArgumentParser(
        prog="upload",
        description="Bootstrap/recover the P1AM OTA layout through its factory USB bootloader.",
    )
    parser.add_argument("--port", help="Serial port; auto-detected when omitted.")
    arguments = parser.parse_args()
    _build_all()
    port = arguments.port or _detect_p1am_port()
    print(f"Uploading complete recovery image through {port}...")
    _run(
        [
            _arduino_cli(),
            "upload",
            "--fqbn",
            FQBN,
            "--port",
            port,
            "--input-file",
            str(RECOVERY_BIN),
            str(UPDATER_SKETCH_DIR),
        ]
    )


def _request_json(
    host: str,
    method: str,
    path: str,
    *,
    body: bytes | None = None,
    headers: dict[str, str] | None = None,
    timeout: float = 4.0,
) -> dict:
    connection = http.client.HTTPConnection(host, DEFAULT_PORT, timeout=timeout)
    request_headers = {"Accept": "application/json", "Connection": "close"}
    if headers:
        request_headers.update(headers)
    try:
        connection.request(method, path, body=body, headers=request_headers)
        response = connection.getresponse()
        payload = response.read()
    finally:
        connection.close()
    try:
        decoded = json.loads(payload) if payload else {}
    except json.JSONDecodeError as error:
        raise SystemExit(f"Controller returned invalid JSON from {path}: {payload!r}") from error
    if response.status >= 400:
        raise SystemExit(
            f"Controller HTTP {response.status} {response.reason}: "
            f"{decoded.get('error', decoded)}"
        )
    return decoded


def _system(host: str, timeout: float = 3.0) -> dict:
    return _request_json(host, "GET", "/api/system", timeout=timeout)


def system_firmware() -> None:
    """Print the running slot/build and last OTA/rollback state."""
    parser = argparse.ArgumentParser(prog="system")
    parser.add_argument("--host", default=DEFAULT_HOST)
    arguments = parser.parse_args()
    print(json.dumps(_system(arguments.host), indent=2))


def _wait_for_trial(host: str, expected_slot: str, expected_build: str, timeout: float = 18.0) -> dict:
    deadline = time.monotonic() + timeout
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            status = _system(host, timeout=1.5)
            firmware = status.get("firmware", {})
            if (
                firmware.get("slot") == expected_slot
                and firmware.get("build") == expected_build
                and firmware.get("trial") is True
            ):
                return status
        except (OSError, http.client.HTTPException, SystemExit) as error:
            last_error = error
        time.sleep(0.5)
    detail = f"; last error: {last_error}" if last_error else ""
    raise SystemExit(f"New trial firmware did not come online before the confirmation deadline{detail}")


def ota_firmware() -> None:
    """Compile for the inactive slot, upload by Ethernet, verify, and confirm it."""
    parser = argparse.ArgumentParser(
        prog="ota",
        description="Deploy Fill Cart to the inactive A/B slot over Ethernet.",
    )
    parser.add_argument("--host", default=DEFAULT_HOST)
    arguments = parser.parse_args()
    host = arguments.host

    before = _system(host)
    running_slot = before.get("firmware", {}).get("slot")
    if running_slot not in {"A", "B"}:
        raise SystemExit(f"Controller reported an unknown running slot: {running_slot!r}")
    if before.get("firmware", {}).get("trial"):
        raise SystemExit("Controller is already running unconfirmed trial firmware")
    target = "B" if running_slot == "A" else "A"

    build_id = _application_build_id()
    artifact = _compile_app(target, build_id=build_id)
    binary_path, _ = _app_artifacts(target)
    payload = binary_path.read_bytes()
    crc32 = f"{zlib.crc32(payload) & 0xFFFFFFFF:08x}"

    print(
        f"Uploading {artifact['version']} build {build_id} to inactive slot {target} "
        f"({len(payload)} bytes, CRC32 {crc32})..."
    )
    response = _request_json(
        host,
        "POST",
        "/api/firmware",
        body=payload,
        headers={
            "Content-Type": "application/octet-stream",
            "Content-Length": str(len(payload)),
            "X-Firmware-Version": artifact["version"],
            "X-Firmware-Build": build_id,
            "X-Firmware-CRC32": crc32,
        },
        timeout=20.0,
    )
    if response.get("target_slot") != target:
        raise SystemExit(f"Controller staged unexpected slot: {response}")

    print("Controller accepted the image and is rebooting into trial firmware...")
    trial = _wait_for_trial(host, target, build_id)
    print(
        f"Trial {target}/{build_id} is online; "
        f"confirmation window {trial.get('ota', {}).get('confirm_window_remaining_ms')} ms."
    )

    confirmed = _request_json(host, "POST", "/api/firmware/confirm", timeout=4.0)
    firmware = confirmed.get("firmware", {})
    boot = confirmed.get("boot", {})
    if firmware.get("slot") != target or firmware.get("trial") is not False:
        raise SystemExit(f"Firmware confirmation returned an unexpected state: {confirmed}")
    if boot.get("known_good_slot") != target:
        raise SystemExit(f"Firmware did not become known-good: {confirmed}")

    print(
        f"OTA complete: slot {target}, version {firmware.get('version')}, "
        f"build {firmware.get('build')} is now known-good."
    )


if __name__ == "__main__":
    compile_firmware()

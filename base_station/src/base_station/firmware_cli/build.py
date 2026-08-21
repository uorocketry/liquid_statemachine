from __future__ import annotations

import hashlib
import json
import re
import shutil
import struct
import subprocess
import zlib
from pathlib import Path

from .paths import (
    APP_A_BASE, APP_SLOT_SIZE, BUILD_ROOT, FIRMWARE_LIBRARIES_DIR, FQBN,
    MANIFEST_PATH, RAM_BASE, RAM_END, RECOVERY_BIN, REPOSITORY_DIR, SKETCH_DIR,
    SLOT_BASES, SLOT_BUILD_DIRS, UPDATER_BASE, UPDATER_BUILD_DIR,
    UPDATER_SIZE, UPDATER_SKETCH_DIR, arduino_cli, run,
)


def version() -> str:
    version_header = SKETCH_DIR / "version.h"
    match = re.search(
        r'^\s*#define\s+FILL_CART_VERSION\s+"([^"]+)"',
        version_header.read_text(),
        re.MULTILINE,
    )
    if match is None:
        raise SystemExit(f"FILL_CART_VERSION not found in {version_header}")
    return match.group(1)


def application_build_id(extra_cpp_flags: tuple[str, ...] = ()) -> str:
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


def compile_sketch(
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
        arduino_cli(), "compile", "--fqbn", FQBN,
        "--libraries", str(FIRMWARE_LIBRARIES_DIR),
        "--build-path", str(build_dir),
    ]
    if cpp_flags:
        command.extend(["--build-property", "compiler.cpp.extra_flags=" + " ".join(cpp_flags)])
    if link_address is not None:
        command.extend([
            "--build-property",
            f"compiler.c.elf.extra_flags=-Wl,--section-start=.text=0x{link_address:x}",
        ])
    command.append(str(sketch_dir))
    run(command)


def app_artifacts(slot: str) -> tuple[Path, Path]:
    build_dir = SLOT_BUILD_DIRS[slot]
    return build_dir / "fill_cart.ino.bin", build_dir / "fill_cart.ino.elf"


def updater_artifacts() -> tuple[Path, Path]:
    return UPDATER_BUILD_DIR / "p1am_updater.ino.bin", UPDATER_BUILD_DIR / "p1am_updater.ino.elf"


def objdump() -> str:
    candidates = sorted(
        (Path.home() / "Library/Arduino15/packages/arduino/tools/arm-none-eabi-gcc").glob(
            "*/bin/arm-none-eabi-objdump"
        )
    )
    if candidates:
        return str(candidates[-1])
    executable = shutil.which("arm-none-eabi-objdump")
    if executable:
        return executable
    raise SystemExit("arm-none-eabi-objdump was not found")


def text_address(elf_path: Path) -> int:
    result = subprocess.run([objdump(), "-h", str(elf_path)], check=True, capture_output=True, text=True)
    for line in result.stdout.splitlines():
        columns = line.split()
        if len(columns) >= 6 and columns[1] == ".text":
            return int(columns[3], 16)
    raise SystemExit(f"Could not find .text in {elf_path}")


def validate_binary(binary_path: Path, expected_base: int, max_size: int, label: str) -> dict:
    payload = binary_path.read_bytes()
    if not payload:
        raise SystemExit(f"{label} binary is empty: {binary_path}")
    if len(payload) > max_size:
        raise SystemExit(f"{label} is {len(payload)} bytes, exceeding its {max_size}-byte flash reservation")
    if label.startswith("App"):
        if len(payload) < 8:
            raise SystemExit(f"{label} binary is too small to contain a vector table")
        stack_pointer, reset_handler = struct.unpack_from("<II", payload)
        reset_address = reset_handler & ~1
        if not RAM_BASE <= stack_pointer <= RAM_END:
            raise SystemExit(f"{label} initial stack pointer 0x{stack_pointer:08x} is outside SAMD21 SRAM")
        if not (reset_handler & 1) or not expected_base <= reset_address < expected_base + max_size:
            raise SystemExit(f"{label} reset vector 0x{reset_handler:08x} is outside its flash slot")
    return {"bytes": len(payload), "crc32": f"{zlib.crc32(payload) & 0xFFFFFFFF:08x}"}


def compile_updater() -> dict:
    print("Compiling P1AM second-stage updater...")
    compile_sketch(UPDATER_SKETCH_DIR, UPDATER_BUILD_DIR)
    binary_path, elf_path = updater_artifacts()
    address = text_address(elf_path)
    if address != UPDATER_BASE:
        raise SystemExit(f"Updater .text is at 0x{address:x}, expected 0x{UPDATER_BASE:x}")
    info = validate_binary(binary_path, UPDATER_BASE, UPDATER_SIZE, "Updater")
    info["address"] = f"0x{UPDATER_BASE:05x}"
    return info


def compile_app(slot: str, *, build_id: str | None = None, extra_cpp_flags: tuple[str, ...] = ()) -> dict:
    if slot not in SLOT_BASES:
        raise ValueError(slot)
    build_id = build_id or application_build_id(extra_cpp_flags)
    cpp_flags = (
        f"-DP1AM_OTA_SLOT={0 if slot == 'A' else 1}",
        f"-DP1AM_OTA_BUILD_TOKEN={build_id}",
        *extra_cpp_flags,
    )
    print(f"Compiling Fill Cart for slot {slot} @ 0x{SLOT_BASES[slot]:05x} (build {build_id})...")
    compile_sketch(SKETCH_DIR, SLOT_BUILD_DIRS[slot], cpp_flags=cpp_flags, link_address=SLOT_BASES[slot])
    binary_path, elf_path = app_artifacts(slot)
    address = text_address(elf_path)
    if address != SLOT_BASES[slot]:
        raise SystemExit(f"App {slot} .text is at 0x{address:x}, expected 0x{SLOT_BASES[slot]:x}")
    info = validate_binary(binary_path, SLOT_BASES[slot], APP_SLOT_SIZE, f"App {slot}")
    info.update(address=f"0x{SLOT_BASES[slot]:05x}", version=version(), build=build_id, binary=str(binary_path))
    return info


def build_recovery(updater_info: dict, app_a_info: dict) -> dict:
    updater_bin, _ = updater_artifacts()
    app_a_bin, _ = app_artifacts("A")
    updater = updater_bin.read_bytes()
    app_a = app_a_bin.read_bytes()
    app_offset = APP_A_BASE - UPDATER_BASE
    if len(updater) > app_offset:
        raise SystemExit("Updater overlaps App A in the recovery image")
    payload = updater + b"\xff" * (app_offset - len(updater)) + app_a
    BUILD_ROOT.mkdir(parents=True, exist_ok=True)
    RECOVERY_BIN.write_bytes(payload)
    return {
        "bytes": len(payload), "crc32": f"{zlib.crc32(payload) & 0xFFFFFFFF:08x}",
        "binary": str(RECOVERY_BIN), "updater": updater_info, "app_a": app_a_info,
    }


def build_all() -> dict:
    updater = compile_updater()
    build_id = application_build_id()
    app_a = compile_app("A", build_id=build_id)
    app_b = compile_app("B", build_id=build_id)
    recovery = build_recovery(updater, app_a)
    manifest = {
        "version": version(), "build": build_id, "updater": updater,
        "slots": {"A": app_a, "B": app_b}, "recovery": recovery,
    }
    BUILD_ROOT.mkdir(parents=True, exist_ok=True)
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


def compile_firmware() -> None:
    manifest = build_all()
    print(
        f"OTA artifacts ready: updater {manifest['updater']['bytes']} B, "
        f"A {manifest['slots']['A']['bytes']} B, B {manifest['slots']['B']['bytes']} B"
    )
    print(f"Recovery image: {RECOVERY_BIN}")

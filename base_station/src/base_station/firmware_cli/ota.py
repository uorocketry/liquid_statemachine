from __future__ import annotations

import argparse
import http.client
import json
import time
import zlib

from .build import app_artifacts, application_build_id, compile_app
from .paths import DEFAULT_HOST, DEFAULT_PORT


def request_json(
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
        raise SystemExit(f"Controller HTTP {response.status} {response.reason}: {decoded.get('error', decoded)}")
    return decoded


def system(host: str, timeout: float = 3.0) -> dict:
    return request_json(host, "GET", "/api/system", timeout=timeout)


def system_firmware() -> None:
    parser = argparse.ArgumentParser(prog="system")
    parser.add_argument("--host", default=DEFAULT_HOST)
    arguments = parser.parse_args()
    print(json.dumps(system(arguments.host), indent=2))


def wait_for_trial(host: str, expected_slot: str, expected_build: str, timeout: float = 18.0) -> dict:
    deadline = time.monotonic() + timeout
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            status = system(host, timeout=1.5)
            firmware = status.get("firmware", {})
            if firmware.get("slot") == expected_slot and firmware.get("build") == expected_build and firmware.get("trial") is True:
                return status
        except (OSError, http.client.HTTPException, SystemExit) as error:
            last_error = error
        time.sleep(0.5)
    detail = f"; last error: {last_error}" if last_error else ""
    raise SystemExit(f"New trial firmware did not come online before the confirmation deadline{detail}")


def ota_firmware() -> None:
    parser = argparse.ArgumentParser(prog="ota", description="Deploy Fill Cart to the inactive A/B slot over Ethernet.")
    parser.add_argument("--host", default=DEFAULT_HOST)
    host = parser.parse_args().host
    before = system(host)
    running_slot = before.get("firmware", {}).get("slot")
    if running_slot not in {"A", "B"}:
        raise SystemExit(f"Controller reported an unknown running slot: {running_slot!r}")
    if before.get("firmware", {}).get("trial"):
        raise SystemExit("Controller is already running unconfirmed trial firmware")
    target = "B" if running_slot == "A" else "A"

    build_id = application_build_id()
    artifact = compile_app(target, build_id=build_id)
    binary_path, _ = app_artifacts(target)
    payload = binary_path.read_bytes()
    crc32 = f"{zlib.crc32(payload) & 0xFFFFFFFF:08x}"
    print(f"Uploading {artifact['version']} build {build_id} to inactive slot {target} ({len(payload)} bytes, CRC32 {crc32})...")
    response = request_json(
        host, "POST", "/api/firmware", body=payload,
        headers={
            "Content-Type": "application/octet-stream", "Content-Length": str(len(payload)),
            "X-Firmware-Version": artifact["version"], "X-Firmware-Build": build_id,
            "X-Firmware-CRC32": crc32,
        },
        timeout=20.0,
    )
    if response.get("target_slot") != target:
        raise SystemExit(f"Controller staged unexpected slot: {response}")
    print("Controller accepted the image and is rebooting into trial firmware...")
    trial = wait_for_trial(host, target, build_id)
    print(f"Trial {target}/{build_id} is online; confirmation window {trial.get('ota', {}).get('confirm_window_remaining_ms')} ms.")
    confirmed = request_json(host, "POST", "/api/firmware/confirm", timeout=4.0)
    firmware = confirmed.get("firmware", {})
    boot = confirmed.get("boot", {})
    if firmware.get("slot") != target or firmware.get("trial") is not False:
        raise SystemExit(f"Firmware confirmation returned an unexpected state: {confirmed}")
    if boot.get("known_good_slot") != target:
        raise SystemExit(f"Firmware did not become known-good: {confirmed}")
    print(f"OTA complete: slot {target}, version {firmware.get('version')}, build {firmware.get('build')} is now known-good.")

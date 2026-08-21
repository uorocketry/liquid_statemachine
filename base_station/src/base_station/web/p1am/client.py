"""Serialized HTTP transport and protocol validation for the P1AM controller."""

from __future__ import annotations

import http.client
import json
from dataclasses import dataclass
from threading import Lock
from typing import Mapping

from .states import STATE_BY_ID, STATE_NAMES


class P1amProtocolError(ValueError):
    """The controller replied, but the payload did not match the expected API."""


@dataclass(frozen=True)
class P1amSnapshot:
    state: int
    transitions: tuple[int, ...]
    health_ok: bool
    firmware_version: str | None
    uptime_ms: int | None
    ethernet_link: bool
    modules_detected: int | None
    p1_initialized: bool

    @classmethod
    def from_payload(cls, payload: object) -> "P1amSnapshot":
        root = _mapping(payload, "status")
        health = _mapping(root.get("health"), "health")
        ethernet = _mapping(health.get("ethernet"), "health.ethernet")
        p1 = _mapping(health.get("p1"), "health.p1")

        state = _integer(root.get("state"), "state")
        if state not in STATE_BY_ID:
            raise P1amProtocolError(f"state {state} is outside the supported state table")

        raw_transitions = root.get("transitions")
        if not isinstance(raw_transitions, list):
            raise P1amProtocolError("transitions must be an array")
        transitions = tuple(_integer(value, "transition") for value in raw_transitions)
        invalid = [value for value in transitions if value not in STATE_BY_ID]
        if invalid:
            raise P1amProtocolError(f"unsupported transition ids: {invalid}")
        advertised_states = root.get("states")
        if advertised_states is not None:
            if not isinstance(advertised_states, list) or not all(isinstance(value, str) for value in advertised_states):
                raise P1amProtocolError("states must be an array of names")
            if advertised_states != STATE_NAMES:
                raise P1amProtocolError(
                    "controller state table does not match this base-station build"
                )

        return cls(
            state=state,
            transitions=transitions,
            health_ok=_boolean(health.get("ok"), "health.ok"),
            firmware_version=_optional_string(health.get("firmware_version"), "health.firmware_version"),
            uptime_ms=_optional_integer(health.get("uptime_ms"), "health.uptime_ms"),
            ethernet_link=_boolean(ethernet.get("link"), "health.ethernet.link"),
            modules_detected=_optional_integer(p1.get("modules_detected"), "health.p1.modules_detected"),
            p1_initialized=_boolean(p1.get("initialized"), "health.p1.initialized"),
        )


class P1amClient:
    """One serialized connection boundary for polling and operator commands."""

    def __init__(self, host: str, port: int = 80) -> None:
        self.host = host
        self.port = port
        self._request_lock = Lock()

    def get_status(self) -> P1amSnapshot:
        return P1amSnapshot.from_payload(self._request("GET", "/api/status"))

    def initialize(self) -> P1amSnapshot:
        return P1amSnapshot.from_payload(
            self._request("POST", "/api/p1/initialize", timeout=15)
        )

    def set_state(self, state: int) -> None:
        self._request("PUT", f"/api/state/{state}")

    def reset(self) -> None:
        self._request("POST", "/api/reset")

    def _request(self, method: str, path: str, timeout: float = 1) -> dict:
        with self._request_lock:
            connection = http.client.HTTPConnection(self.host, self.port, timeout=timeout)
            try:
                connection.request(method, path, headers={"Accept": "application/json"})
                response = connection.getresponse()
                body = response.read()
            except http.client.HTTPException as error:
                raise ConnectionError(
                    f"P1AM HTTP transport error: {type(error).__name__}"
                ) from error
            finally:
                connection.close()

        try:
            payload = json.loads(body) if body else {}
        except json.JSONDecodeError as error:
            raise P1amProtocolError(f"{path} returned invalid JSON") from error
        if not isinstance(payload, dict):
            raise P1amProtocolError(f"{path} returned a non-object JSON payload")
        if response.status >= 400:
            message = payload.get("error", response.reason)
            raise ConnectionError(f"P1AM HTTP {response.status}: {message}")
        return payload


def _mapping(value: object, label: str) -> Mapping[str, object]:
    if not isinstance(value, Mapping):
        raise P1amProtocolError(f"{label} must be an object")
    return value


def _integer(value: object, label: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool):
        raise P1amProtocolError(f"{label} must be an integer")
    return value


def _optional_integer(value: object, label: str) -> int | None:
    if value is None:
        return None
    return _integer(value, label)


def _boolean(value: object, label: str) -> bool:
    if not isinstance(value, bool):
        raise P1amProtocolError(f"{label} must be a boolean")
    return value


def _optional_string(value: object, label: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise P1amProtocolError(f"{label} must be a string")
    return value

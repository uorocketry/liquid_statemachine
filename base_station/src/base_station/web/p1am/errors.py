"""Operator-facing P1AM errors kept separate from diagnostic log detail."""

from __future__ import annotations

from .client import P1amProtocolError


def diagnostic_signature(error: Exception) -> str:
    if error.__cause__ is not None:
        cause = error.__cause__
        return f"{type(cause).__name__}: {cause}"
    return f"{type(error).__name__}: {error}"


def operator_message(error: Exception) -> str:
    if isinstance(error, P1amProtocolError):
        if "state table" in str(error):
            return "Controller firmware is incompatible with this base-station build"
        return "Controller returned invalid status data"
    if isinstance(error, TimeoutError):
        return "Controller unreachable (request timed out)"
    if isinstance(error, ConnectionRefusedError):
        return "Controller unreachable (connection refused)"
    if isinstance(error, ConnectionError):
        detail = str(error)
        if detail.startswith("P1AM HTTP ") and ": " in detail:
            return f"Controller rejected request: {detail.split(': ', 1)[1]}"
        return "Controller connection failed"
    if isinstance(error, OSError):
        return "Controller unreachable"
    return "P1AM service error"

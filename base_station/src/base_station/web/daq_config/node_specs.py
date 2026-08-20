"""Canonical definitions for hardware-independent DAQ graph nodes."""

from __future__ import annotations

from copy import deepcopy
from math import isfinite, radians


GAUGE_TYPES = {
    "dial-filled",
    "dial-needle",
    "meter-horizontal",
    "meter-vertical",
    "meter-vertical-inverted",
}

DEFAULT_GAUGE = {
    "type": "dial-filled",
    "showValue": True,
    "showUnits": True,
    "showRange": True,
    "min": 0,
    "low": 10,
    "high": 90,
    "max": 100,
}

DEFAULT_CONFIGS = {
    "sine-wave": {
        "amplitude": 1,
        "periodS": 4,
        "offset": 0,
        "phaseRad": 0,
        "randomness": 0,
        "unit": "V",
    },
    "constant": {"value": 0, "unit": "kg"},
    "add": {},
    "subtract": {},
    "gain": {"gain": 1},
    "moving-average": {"windowS": 0.5},
    "rate-of-change": {"windowS": 0.5},
    "dashboard-signal": {
        "label": "",
        "group": "Engine",
        "display": "both",
        "precision": 1,
    },
}

SPEC_NODE_TYPES = frozenset(DEFAULT_CONFIGS)


def canonicalize_spec_node(node: dict) -> bool:
    """Apply current defaults/pins to one declarative node, if recognized."""
    node_type = node.get("nodeType")
    if node_type not in SPEC_NODE_TYPES:
        return False
    config = node.get("config") if isinstance(node.get("config"), dict) else {}
    node["config"] = config
    if node_type == "sine-wave":
        _migrate_sine_aliases(config)
    _deep_defaults(config, DEFAULT_CONFIGS[node_type])
    if node_type == "dashboard-signal" and config.get("display") == "gauge":
        gauge = config.setdefault("gauge", {})
        if not isinstance(gauge, dict):
            gauge = {}
            config["gauge"] = gauge
        _deep_defaults(gauge, DEFAULT_GAUGE)
    node["pins"] = _pins(node_type, config)
    return True


def validate_spec_node(node: dict) -> list[str] | None:
    """Return validation messages for a declarative node or None if custom."""
    node_type = node.get("nodeType")
    if node_type not in SPEC_NODE_TYPES:
        return None
    source_config = deepcopy(node.get("config") if isinstance(node.get("config"), dict) else {})
    if node_type == "sine-wave":
        _migrate_sine_aliases(source_config)
    config = deepcopy(DEFAULT_CONFIGS[node_type])
    _deep_update(config, source_config)
    if node_type == "sine-wave":
        return _validate_sine(config)
    if node_type == "constant":
        return [] if _finite(config.get("value")) else ["Constant value must be finite"]
    if node_type == "gain":
        return [] if _finite(config.get("gain")) else ["Gain must be finite"]
    if node_type == "moving-average":
        return [] if _positive(config.get("windowS")) else ["Moving-average window must be positive"]
    if node_type == "rate-of-change":
        return [] if _positive(config.get("windowS")) else ["Rate-of-change window must be positive"]
    if node_type == "dashboard-signal":
        return _validate_dashboard(config)
    return []


def _migrate_sine_aliases(config: dict) -> None:
    frequency = config.pop("frequencyHz", None)
    if "periodS" not in config and _finite(frequency):
        frequency_value = float(frequency)
        config["periodS"] = 0 if frequency_value == 0 else 1 / frequency_value
    phase_deg = config.pop("phaseDeg", None)
    if "phaseRad" not in config and _finite(phase_deg):
        config["phaseRad"] = radians(float(phase_deg))


def _pins(node_type: str, config: dict) -> list[dict]:
    if node_type == "sine-wave":
        return [_output("signal", "Signal", str(config.get("unit", "V")))]
    if node_type == "constant":
        return [_output("value", "Value", str(config.get("unit", "kg")))]
    if node_type in {"add", "subtract"}:
        label = "A + B" if node_type == "add" else "A − B"
        return [
            _input("a", "A", "infer", "*"),
            _input("b", "B", "infer", "*"),
            _output("result", label, "infer"),
        ]
    if node_type in {"gain", "moving-average"}:
        label = "Scaled" if node_type == "gain" else "Average"
        return [_input("input", "Signal", "infer", "*"), _output("result", label, "infer")]
    if node_type == "rate-of-change":
        return [_input("input", "Signal", "infer", "*"), _output("rate", "Rate", "infer")]
    return [_input("value", "Value", "*", "*")]


def _validate_sine(config: dict) -> list[str]:
    issues: list[str] = []
    for key, label in (
        ("amplitude", "amplitude"),
        ("periodS", "period"),
        ("offset", "offset"),
        ("phaseRad", "phase"),
        ("randomness", "randomness"),
    ):
        if not _finite(config.get(key)):
            issues.append(f"Sine-wave {label} must be finite")
    if _finite(config.get("periodS")) and float(config["periodS"]) < 0:
        issues.append("Sine-wave period cannot be negative")
    if _finite(config.get("randomness")) and not 0 <= float(config["randomness"]) <= 1:
        issues.append("Sine-wave randomness must be between 0 and 1")
    if not str(config.get("unit", "")).strip():
        issues.append("Sine-wave unit is required")
    return issues


def _validate_dashboard(config: dict) -> list[str]:
    issues: list[str] = []
    if not str(config.get("label", "")).strip():
        issues.append("Dashboard signal requires a label")
    if config.get("group") not in {"Fuel", "LOX", "Engine"}:
        issues.append("Dashboard group must be Fuel, LOX, or Engine")
    if config.get("display") not in {"number", "plot", "both", "gauge"}:
        issues.append("Dashboard display must be number, plot, both, or gauge")
    precision = config.get("precision")
    if isinstance(precision, bool) or not isinstance(precision, int) or not 0 <= precision <= 6:
        issues.append("Dashboard decimal places must be 0 through 6")
    if config.get("display") != "gauge":
        return issues
    gauge = deepcopy(DEFAULT_GAUGE)
    if isinstance(config.get("gauge"), dict):
        _deep_update(gauge, config["gauge"])
    if gauge.get("type") not in GAUGE_TYPES:
        issues.append("Select a supported dashboard gauge type")
    for key in ("showValue", "showUnits", "showRange"):
        if not isinstance(gauge.get(key), bool):
            issues.append(f"Gauge {key} must be on or off")
    minimum = gauge.get("min")
    maximum = gauge.get("max")
    if not _finite(minimum) or not _finite(maximum) or float(maximum) <= float(minimum):
        issues.append("Gauge maximum must be greater than minimum")
        return issues
    low = gauge.get("low")
    high = gauge.get("high")
    if not _optional_limit(low, float(minimum), float(maximum), high_side=False):
        issues.append("Gauge low limit must be within the display range")
    if not _optional_limit(high, float(minimum), float(maximum), high_side=True):
        issues.append("Gauge high limit must be within the display range")
    if _finite(low) and _finite(high) and float(low) > float(high):
        issues.append("Gauge low limit cannot exceed the high limit")
    return issues


def _optional_limit(value: object, minimum: float, maximum: float, *, high_side: bool) -> bool:
    if value in (None, ""):
        return True
    if not _finite(value):
        return False
    number = float(value)
    return minimum < number <= maximum if high_side else minimum <= number < maximum


def _deep_defaults(target: dict, defaults: dict) -> None:
    for key, default in defaults.items():
        if key not in target:
            target[key] = deepcopy(default)
        elif isinstance(default, dict) and isinstance(target[key], dict):
            _deep_defaults(target[key], default)


def _deep_update(target: dict, source: dict) -> None:
    for key, value in source.items():
        if isinstance(value, dict) and isinstance(target.get(key), dict):
            _deep_update(target[key], value)
        else:
            target[key] = deepcopy(value)


def _input(pin_id: str, label: str, pin_type: str, expected: str | None = None) -> dict:
    return {
        "id": pin_id,
        "label": label,
        "type": pin_type,
        "expectedType": expected or pin_type,
        "direction": "input",
        "kind": "data",
    }


def _output(pin_id: str, label: str, pin_type: str) -> dict:
    return {"id": pin_id, "label": label, "type": pin_type, "direction": "output", "kind": "result"}


def _finite(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and isfinite(float(value))


def _positive(value: object) -> bool:
    return _finite(value) and float(value) > 0

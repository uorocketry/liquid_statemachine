"""Canonical definitions for hardware-independent DAQ graph nodes."""

from __future__ import annotations

from copy import deepcopy
from math import isfinite


DASHBOARD_NODE_TYPES = frozenset({"number", "gauge", "time-plot"})
GAUGE_TYPES = {
    "dial-filled",
    "dial-needle",
    "meter-horizontal",
    "meter-vertical",
    "meter-vertical-inverted",
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
    "number": {
        "label": "",
        "precision": 1,
        "showUnits": True,
    },
    "gauge": {
        "label": "",
        "precision": 1,
        "type": "dial-filled",
        "showValue": True,
        "showUnits": True,
        "showRange": True,
        "min": 0,
        "low": 10,
        "high": 90,
        "max": 100,
    },
    "time-plot": {
        "label": "",
        "xRangeMode": "shared",
        "xWindowS": 10,
        "xMinS": 0,
        "xMaxS": 100,
        "xTickMode": "auto",
        "xMajorStepS": 10,
        "xLabel": "Elapsed time",
        "yAxisScale": "linear",
        "yRangeMode": "auto",
        "yMin": 0,
        "yMax": 100,
        "ySoftMin": None,
        "ySoftMax": None,
        "yTickMode": "auto",
        "yMajorStep": 10,
        "yLabel": "",
        "showGrid": True,
        "showMinorGrid": False,
    },
}

SPEC_NODE_TYPES = frozenset(DEFAULT_CONFIGS)


def normalize_spec_node(node: dict) -> bool:
    """Apply current defaults and pins to a recognized declarative node."""
    node_type = node.get("nodeType")
    if node_type not in SPEC_NODE_TYPES:
        return False
    source = node.get("config") if isinstance(node.get("config"), dict) else {}
    config = {
        key: deepcopy(source[key]) if key in source else deepcopy(default)
        for key, default in DEFAULT_CONFIGS[node_type].items()
    }
    node["config"] = config
    node["pins"] = _pins(node_type, config)
    return True


def validate_spec_node(node: dict) -> list[str] | None:
    """Return validation messages for a declarative node or None if custom."""
    node_type = node.get("nodeType")
    if node_type not in SPEC_NODE_TYPES:
        return None
    config = deepcopy(DEFAULT_CONFIGS[node_type])
    if isinstance(node.get("config"), dict):
        for key in config:
            if key in node["config"]:
                config[key] = deepcopy(node["config"][key])

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
    if node_type == "number":
        return _validate_number(config)
    if node_type == "gauge":
        return _validate_gauge(config)
    if node_type == "time-plot":
        return _validate_time_plot(config)
    return []


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


def _validate_dashboard_identity(config: dict) -> list[str]:
    issues: list[str] = []
    if not str(config.get("label", "")).strip():
        issues.append("Dashboard widget requires a label")
    return issues


def _validate_precision(value: object) -> list[str]:
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 6:
        return ["Dashboard decimal places must be 0 through 6"]
    return []


def _validate_number(config: dict) -> list[str]:
    issues = [*_validate_dashboard_identity(config), *_validate_precision(config.get("precision"))]
    if not isinstance(config.get("showUnits"), bool):
        issues.append("Number showUnits must be on or off")
    return issues


def _validate_gauge(config: dict) -> list[str]:
    issues = [*_validate_dashboard_identity(config), *_validate_precision(config.get("precision"))]
    if config.get("type") not in GAUGE_TYPES:
        issues.append("Select a supported dashboard gauge type")
    for key in ("showValue", "showUnits", "showRange"):
        if not isinstance(config.get(key), bool):
            issues.append(f"Gauge {key} must be on or off")

    minimum = config.get("min")
    maximum = config.get("max")
    if not _finite(minimum) or not _finite(maximum) or float(maximum) <= float(minimum):
        issues.append("Gauge maximum must be greater than minimum")
        return issues
    low = config.get("low")
    high = config.get("high")
    if not _optional_limit(low, float(minimum), float(maximum), high_side=False):
        issues.append("Gauge low limit must be within the display range")
    if not _optional_limit(high, float(minimum), float(maximum), high_side=True):
        issues.append("Gauge high limit must be within the display range")
    if _finite(low) and _finite(high) and float(low) > float(high):
        issues.append("Gauge low limit cannot exceed the high limit")
    return issues


def _validate_time_plot(config: dict) -> list[str]:
    issues = _validate_dashboard_identity(config)
    if config.get("xRangeMode") not in {"shared", "auto", "window", "fixed"}:
        issues.append("Time-plot X range must use Dashboard view, Auto data extent, Trailing window, or Fixed bounds")
    if config.get("xRangeMode") == "window" and not _positive(config.get("xWindowS")):
        issues.append("Time-plot X window must be positive")
    if config.get("xRangeMode") == "fixed":
        minimum = config.get("xMinS")
        maximum = config.get("xMaxS")
        if not _finite(minimum) or not _finite(maximum) or float(maximum) <= float(minimum):
            issues.append("Time-plot X maximum must be greater than X minimum")
    if config.get("xTickMode") not in {"auto", "manual"}:
        issues.append("Time-plot X ticks must be Auto or Manual")
    if config.get("xTickMode") == "manual" and not _positive(config.get("xMajorStepS")):
        issues.append("Time-plot X major step must be positive")

    if config.get("yAxisScale") not in {"linear", "log10"}:
        issues.append("Time-plot Y scale must be Linear or Log 10")
    if config.get("yRangeMode") not in {"auto", "soft", "fixed"}:
        issues.append("Time-plot Y range must be Auto, Soft bounds, or Fixed bounds")
    if config.get("yRangeMode") == "fixed":
        minimum = config.get("yMin")
        maximum = config.get("yMax")
        if not _finite(minimum) or not _finite(maximum) or float(maximum) <= float(minimum):
            issues.append("Time-plot Y maximum must be greater than Y minimum")
        elif config.get("yAxisScale") == "log10" and float(minimum) <= 0:
            issues.append("Time-plot logarithmic Y minimum must be greater than zero")
    if config.get("yRangeMode") == "soft":
        soft_min = config.get("ySoftMin")
        soft_max = config.get("ySoftMax")
        for value, label in ((soft_min, "soft minimum"), (soft_max, "soft maximum")):
            if value not in (None, "") and not _finite(value):
                issues.append(f"Time-plot Y {label} must be finite")
            elif config.get("yAxisScale") == "log10" and _finite(value) and float(value) <= 0:
                issues.append(f"Time-plot logarithmic Y {label} must be greater than zero")
        if _finite(soft_min) and _finite(soft_max) and float(soft_max) <= float(soft_min):
            issues.append("Time-plot Y soft maximum must be greater than soft minimum")
    if config.get("yTickMode") not in {"auto", "manual"}:
        issues.append("Time-plot Y ticks must be Auto or Manual")
    if config.get("yAxisScale") == "linear" and config.get("yTickMode") == "manual" and not _positive(config.get("yMajorStep")):
        issues.append("Time-plot Y major step must be positive")
    if not isinstance(config.get("showGrid"), bool):
        issues.append("Time-plot major grid must be on or off")
    if not isinstance(config.get("showMinorGrid"), bool):
        issues.append("Time-plot minor grid must be on or off")
    return issues


def _optional_limit(value: object, minimum: float, maximum: float, *, high_side: bool) -> bool:
    if value in (None, ""):
        return True
    if not _finite(value):
        return False
    number = float(value)
    return minimum < number <= maximum if high_side else minimum <= number < maximum


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

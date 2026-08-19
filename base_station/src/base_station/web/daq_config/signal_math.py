"""Vectorized engineering-unit math shared by preview and stream execution."""

from __future__ import annotations

import numpy as np
from numpy.typing import ArrayLike, NDArray


FloatArray = NDArray[np.float64]


def current_from_shunt(volts: ArrayLike, shunt_ohms: float) -> FloatArray:
    if shunt_ohms <= 0:
        raise ValueError("Shunt resistance must be positive")
    return _array(volts) / shunt_ohms


def linear_map(
    values: ArrayLike,
    input_min: float,
    input_max: float,
    output_min: float,
    output_max: float,
) -> FloatArray:
    span = input_max - input_min
    if span == 0:
        raise ValueError("Input span cannot be zero")
    fraction = (_array(values) - input_min) / span
    return output_min + fraction * (output_max - output_min)


def load_cell(
    volts: ArrayLike,
    *,
    excitation_v: float,
    rated_output_mv_v: float,
    zero_v: float,
    capacity: float,
) -> FloatArray:
    if excitation_v <= 0 or rated_output_mv_v <= 0:
        raise ValueError("Load-cell excitation and rated output must be positive")
    rated_v_v = rated_output_mv_v / 1000.0
    return ((_array(volts) - zero_v) / excitation_v) / rated_v_v * capacity


def subtract(left: ArrayLike, right: ArrayLike) -> FloatArray:
    return _array(left) - _array(right)


def rate_of_change(
    values: ArrayLike,
    sample_rate_hz: float,
    *,
    previous: float | None = None,
) -> FloatArray:
    if sample_rate_hz <= 0:
        raise ValueError("Sample rate must be positive")
    samples = _array(values).reshape(-1)
    if not samples.size:
        return samples
    prior = samples[0] if previous is None else float(previous)
    return np.diff(samples, prepend=prior) * sample_rate_hz


def scalar(value: ArrayLike) -> float:
    """Return one result from the scalar command/response preview path."""
    result = _array(value)
    if result.size != 1:
        raise ValueError("Expected one preview value")
    return float(result.reshape(-1)[0])


def _array(values: ArrayLike) -> FloatArray:
    return np.asarray(values, dtype=np.float64)

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


def add(left: ArrayLike, right: ArrayLike) -> FloatArray:
    return _array(left) + _array(right)


def gain(values: ArrayLike, factor: float) -> FloatArray:
    if not np.isfinite(float(factor)):
        raise ValueError("Gain must be finite")
    return _array(values) * float(factor)


def sine_wave(
    time_s: ArrayLike,
    *,
    amplitude: float,
    period_s: float,
    offset: float = 0.0,
    phase_rad: float = 0.0,
    randomness: float = 0.0,
    rng: np.random.Generator | None = None,
) -> FloatArray:
    parameters = (amplitude, period_s, offset, phase_rad, randomness)
    if not all(np.isfinite(float(value)) for value in parameters):
        raise ValueError("Sine-wave parameters must be finite")
    if period_s < 0:
        raise ValueError("Sine-wave period cannot be negative")
    if not 0 <= randomness <= 1:
        raise ValueError("Sine-wave randomness must be between 0 and 1")
    times = _array(time_s)
    phase = float(phase_rad)
    angle = np.full_like(times, phase) if period_s == 0 else (
        2.0 * np.pi * times / float(period_s) + phase
    )
    result = float(offset) + float(amplitude) * np.sin(angle)
    if randomness:
        generator = rng or np.random.default_rng()
        noise = generator.uniform(-1.0, 1.0, size=result.shape)
        result = result + abs(float(amplitude)) * float(randomness) * noise
    return result


def moving_average(values: ArrayLike, sample_rate_hz: float, *, window_s: float) -> FloatArray:
    if sample_rate_hz <= 0:
        raise ValueError("Sample rate must be positive")
    if window_s <= 0:
        raise ValueError("Moving-average window must be positive")
    samples = _array(values).reshape(-1)
    if not samples.size:
        return samples
    window = max(1, int(round(float(window_s) * float(sample_rate_hz))))
    cumulative = np.concatenate(([0.0], np.cumsum(samples, dtype=np.float64)))
    ends = np.arange(1, samples.size + 1)
    starts = np.maximum(ends - window, 0)
    return (cumulative[ends] - cumulative[starts]) / (ends - starts)


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

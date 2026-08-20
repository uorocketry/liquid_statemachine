"""Vectorized DAQ signal-math tests."""

from unittest import TestCase

import numpy as np

from base_station.web.daq_config import signal_math


class SignalMathTests(TestCase):
    def test_current_conversion_handles_chunks(self) -> None:
        result = signal_math.current_from_shunt([1.0, 5.0], 250.0)
        np.testing.assert_allclose(result, [0.004, 0.020])

    def test_linear_calibration_handles_chunks(self) -> None:
        result = signal_math.linear_map(
            [0.004, 0.012, 0.020], 0.004, 0.020, 0.0, 1000.0
        )
        np.testing.assert_allclose(result, [0.0, 500.0, 1000.0])

    def test_load_cell_handles_chunks(self) -> None:
        result = signal_math.load_cell(
            [0.0, 0.005, 0.010],
            excitation_v=5.0,
            rated_output_mv_v=2.0,
            zero_v=0.0,
            capacity=100.0,
        )
        np.testing.assert_allclose(result, [0.0, 50.0, 100.0])

    def test_rate_of_change_uses_sample_rate_and_previous_value(self) -> None:
        result = signal_math.rate_of_change(
            [0.0, 1.0, 3.0], 10.0, previous=-1.0
        )
        np.testing.assert_allclose(result, [10.0, 10.0, 20.0])

    def test_subtract_broadcasts_numpy_values(self) -> None:
        result = signal_math.subtract([10.0, 11.0], 3.0)
        np.testing.assert_allclose(result, [7.0, 8.0])

    def test_add_broadcasts_numpy_values(self) -> None:
        result = signal_math.add([10.0, 11.0], 3.0)
        np.testing.assert_allclose(result, [13.0, 14.0])

    def test_gain_scales_numpy_values(self) -> None:
        result = signal_math.gain([2.0, -4.0], 0.5)
        np.testing.assert_allclose(result, [1.0, -2.0])

    def test_sine_wave_uses_frequency_phase_offset_and_amplitude(self) -> None:
        result = signal_math.sine_wave(
            [0.0, 1.0], amplitude=2.0, frequency_hz=0.25, offset=10.0, phase_deg=0.0
        )
        np.testing.assert_allclose(result, [10.0, 12.0], atol=1e-12)

    def test_moving_average_uses_trailing_time_window(self) -> None:
        result = signal_math.moving_average([1.0, 3.0, 5.0, 7.0], 2.0, window_s=1.0)
        np.testing.assert_allclose(result, [1.0, 2.0, 4.0, 6.0])


if __name__ == "__main__":
    import unittest

    unittest.main()

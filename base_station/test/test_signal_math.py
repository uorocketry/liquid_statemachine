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


if __name__ == "__main__":
    import unittest

    unittest.main()

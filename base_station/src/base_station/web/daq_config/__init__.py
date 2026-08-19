"""DAQ blueprint persistence, validation, preview, and UI capabilities."""


def build_daq_router(*args, **kwargs):
    """Import the hardware-facing router only when the web app is assembled."""
    from .routes import build_daq_router as builder

    return builder(*args, **kwargs)


__all__ = ["build_daq_router"]

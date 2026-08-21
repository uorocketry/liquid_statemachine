"""LabJack connection and raw, durable acquisition recording."""

from __future__ import annotations

import sqlite3
from threading import Event, Lock, Thread, current_thread

from base_station.web.daq_config.labjack_source import (
    LabJackStreamPlan,
    compile_stream_plan,
    stream_batches,
)
from base_station.web.models import DashboardState
from base_station.web.run_repository import RunRepository


class LabJackService:
    def __init__(self, dashboard: DashboardState, runs: RunRepository) -> None:
        self.dashboard = dashboard
        self.runs = runs
        self.handle: int | None = None
        self.device_lock = Lock()
        self.operation_lock = Lock()
        self.stop_event = Event()
        self.stream_thread: Thread | None = None

    def connect(self, ip: str) -> None:
        ljm = _ljm()
        with self.device_lock:
            if self.handle is not None:
                self._close()
            try:
                self.handle = ljm.openS("T7", "ETHERNET", ip)
                info = ljm.getHandleInfo(self.handle)
            except ljm.LJMError as error:
                self.handle = None
                with self.dashboard.lock:
                    self.dashboard.labjack.error = str(error)
                raise RuntimeError(str(error)) from error

        with self.dashboard.lock:
            status = self.dashboard.labjack
            status.connected = True
            status.ip = ip
            status.serial_number = info[2]
            status.error = None
        self.dashboard.log(
            f"LabJack T7 connected · S/N {info[2]}", "success", "labjack"
        )

    def disconnect(self) -> None:
        self.stop_stream()
        with self.device_lock:
            self._close()
        with self.dashboard.lock:
            self.dashboard.labjack.connected = False
            self.dashboard.labjack.serial_number = None
        self.dashboard.log("LabJack disconnected", component="labjack")

    def _close(self) -> None:
        if self.handle is not None:
            ljm = _ljm()
            ljm.close(self.handle)
            self.handle = None

    def start_stream(self, graph: dict) -> None:
        with self.operation_lock:
            if self.handle is None:
                raise RuntimeError("Connect the LabJack before starting acquisition")
            if self.stream_thread and self.stream_thread.is_alive():
                raise RuntimeError("Acquisition is already active")
            plan = compile_stream_plan(graph)
            if not 1 <= plan.scan_rate <= 100_000:
                raise ValueError("Scan rate must be between 1 and 100,000 Hz")
            with self.dashboard.lock:
                status = self.dashboard.labjack
                status.scan_rate = plan.scan_rate
                status.sample_count = 0
                status.current_run_id = None
                status.error = None
                status.acquisition_state = "starting"
                status.operation_message = "Starting acquisition…"
            self.stop_event.clear()
            self.stream_thread = Thread(
                target=self._stream,
                args=(plan,),
                name="labjack-stream",
                daemon=True,
            )
            self.stream_thread.start()

    def stop_stream(self) -> None:
        with self.operation_lock:
            thread = self.stream_thread
            if thread is None or not thread.is_alive():
                with self.dashboard.lock:
                    status = self.dashboard.labjack
                    status.streaming = False
                    if status.acquisition_state != "error":
                        status.acquisition_state = "idle"
                        status.operation_message = "Acquisition is idle"
                return

            with self.dashboard.lock:
                status = self.dashboard.labjack
                status.acquisition_state = "stopping"
                status.operation_message = "Stopping acquisition and closing the stream…"
            self.stop_event.set()

        if thread is not current_thread():
            thread.join(timeout=3)
        if thread.is_alive():
            raise RuntimeError("LabJack is still stopping; wait and retry")

    def _stream(self, plan: LabJackStreamPlan) -> None:
        ljm = _ljm()
        started = False
        failed = False
        failure_message = None
        run_id = None
        sample_index = 0
        try:
            run_id = self.runs.start_run(
                plan.scan_rate,
                plan.signals,
                source_id=plan.source_id,
            )
            with self.dashboard.lock:
                self.dashboard.labjack.current_run_id = run_id
            started = True
            with self.dashboard.lock:
                self.dashboard.labjack.streaming = True
                self.dashboard.labjack.acquisition_state = "running"
                self.dashboard.labjack.operation_message = f"Recording at {plan.scan_rate:,} Hz"
            self.dashboard.log(
                f"Run {run_id} started at {plan.scan_rate:,} Hz · {len(plan.signals)} signals",
                "success",
                "labjack",
            )

            for batch in stream_batches(self, plan, self.stop_event):
                self.runs.add_batch(run_id, batch)
                sample_index = batch.start_index + batch.sample_count
                with self.dashboard.lock:
                    self.dashboard.labjack.sample_count = sample_index
        except (ljm.LJMError, RuntimeError, OSError, ValueError, sqlite3.Error) as error:
            failed = True
            failure_message = str(error)
            with self.dashboard.lock:
                self.dashboard.labjack.error = str(error)
                self.dashboard.labjack.acquisition_state = "error"
                self.dashboard.labjack.operation_message = "Acquisition failed. See Logs."
            self.dashboard.log(f"Acquisition error: {error}", "error", "labjack")
        finally:
            if run_id is not None:
                try:
                    self.runs.finish_run(
                        run_id,
                        "failed" if failed else "completed",
                        sample_index,
                        failure_message,
                    )
                except sqlite3.Error as error:
                    failed = True
                    with self.dashboard.lock:
                        status = self.dashboard.labjack
                        status.error = f"Run finalization failed: {error}"
                        status.acquisition_state = "error"
                        status.operation_message = status.error
                    self.dashboard.log(
                        f"Run {run_id} finalization failed: {error}", "error", "labjack"
                    )
            with self.dashboard.lock:
                self.dashboard.labjack.streaming = False
                if not failed:
                    self.dashboard.labjack.acquisition_state = "idle"
                    self.dashboard.labjack.operation_message = "Acquisition stopped"
            with self.operation_lock:
                if self.stream_thread is current_thread():
                    self.stream_thread = None
            if started and run_id is not None:
                self.dashboard.log(f"Run {run_id} stopped", component="labjack")


def _ljm():
    """Load the vendor SDK only at the hardware boundary."""
    from labjack import ljm

    return ljm

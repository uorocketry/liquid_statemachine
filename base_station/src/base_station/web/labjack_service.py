"""LabJack connection and raw, durable acquisition recording."""

from __future__ import annotations

import sqlite3
from threading import Event, Lock, Thread, current_thread

from labjack import ljm

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
            ljm.close(self.handle)
            self.handle = None

    def start_stream(
        self,
        scan_rate: int,
    ) -> None:
        if not 1 <= scan_rate <= 100_000:
            raise ValueError("Scan rate must be between 1 and 100,000 Hz")
        with self.operation_lock:
            if self.handle is None:
                raise RuntimeError("Connect the LabJack before starting acquisition")
            if self.stream_thread and self.stream_thread.is_alive():
                raise RuntimeError("Acquisition is already active")
            with self.dashboard.lock:
                status = self.dashboard.labjack
                status.scan_rate = scan_rate
                status.sample_count = 0
                status.current_run_id = None
                status.error = None
                status.acquisition_state = "starting"
                status.operation_message = "Starting acquisition…"
                for channel in self.dashboard.channels:
                    channel.clear()
            self.stop_event.clear()
            self.stream_thread = Thread(
                target=self._stream,
                args=(scan_rate,),
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

    def _stream(self, scan_rate: int) -> None:
        started = False
        failed = False
        failure_message = None
        run_id = None
        sample_index = 0
        try:
            run_id = self.runs.start_run(scan_rate)
            with self.dashboard.lock:
                self.dashboard.labjack.current_run_id = run_id
            handle = self.handle
            if handle is None:
                raise RuntimeError("LabJack disconnected")
            ljm.eWriteName(handle, "AIN0_NEGATIVE_CH", 1)
            ljm.eWriteName(handle, "AIN0_RANGE", 0.1)
            ljm.eWriteName(handle, "AIN2_NEGATIVE_CH", 3)
            ljm.eWriteName(handle, "AIN2_RANGE", 0.1)
            addresses = ljm.namesToAddresses(2, ["AIN0", "AIN2"])[0]
            ljm.eStreamStart(handle, max(1, scan_rate // 2), 2, addresses, scan_rate)
            started = True
            with self.dashboard.lock:
                self.dashboard.labjack.streaming = True
                self.dashboard.labjack.acquisition_state = "running"
                self.dashboard.labjack.operation_message = f"Recording at {scan_rate:,} Hz"
            self.dashboard.log(f"Run {run_id} started at {scan_rate:,} Hz", "success", "labjack")

            while not self.stop_event.is_set():
                chunk = ljm.eStreamRead(handle)[0]
                channels = [chunk[0::2], chunk[1::2]]
                self.dashboard.add_samples(channels[0], channels[1])
                self.runs.add_samples(run_id, sample_index, channels[0], channels[1])
                sample_index += len(channels[0])
        except (ljm.LJMError, RuntimeError, OSError) as error:
            failed = True
            failure_message = str(error)
            with self.dashboard.lock:
                self.dashboard.labjack.error = str(error)
                self.dashboard.labjack.acquisition_state = "error"
                self.dashboard.labjack.operation_message = f"Acquisition failed: {error}"
            self.dashboard.log(f"Acquisition error: {error}", "error", "labjack")
        finally:
            if started and self.handle is not None:
                try:
                    ljm.eStreamStop(self.handle)
                    ljm.eWriteName(self.handle, "AIN0_NEGATIVE_CH", 199)
                    ljm.eWriteName(self.handle, "AIN2_NEGATIVE_CH", 199)
                except ljm.LJMError:
                    pass
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

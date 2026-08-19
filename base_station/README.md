# Base Station

Local web dashboard for the PHIL cart state machine, LabJack data logging, and
P1AM firmware tooling. FastAPI and Jinja2 render the pages and authoritative UI
fragments; a pinned, vendored HTMX file swaps those fragments without a frontend
build system. Custom JavaScript is limited to the canvas telemetry charts and
their interaction controls.

## Prerequisites

- [uv](https://docs.astral.sh/uv/getting-started/installation/)
- [Arduino CLI](https://arduino.github.io/arduino-cli/latest/installation/)
- [LabJack LJM](https://support.labjack.com/docs/ljm-software-installer-downloads-t4-t7-t8-digit)
- The P1AM Arduino board core and the libraries listed in
  [`../phil_cart/README.txt`](../phil_cart/README.txt)

Install the locked Python environment:

```bash
cd base_station
uv sync --locked
```

## Commands

Run these from the `base_station` directory:

```bash
# Launch the operator GUI
uv run gui

# Build the second-stage updater, both A/B application images, and USB recovery image
uv run compile

# Show the running firmware slot/build and the last OTA/rollback result
uv run system

# Normal deployment: build for the inactive slot, upload by Ethernet, and confirm it
uv run ota

# Bootstrap/recovery only: flash updater + App A through the factory USB bootloader
uv run upload

# Select a directly attached serial port explicitly for USB recovery
uv run upload --port /dev/cu.usbmodem11301
```

The controller remains on `192.168.8.50`. Normal development uses `uv run ota`;
`upload` is the bootstrap/recovery path and preserves the factory P1AM SAM-BA
bootloader. The OTA updater uses two 96 KiB application slots. A newly uploaded
slot is a trial until the host sees `/api/system` from that exact build and sends
`POST /api/firmware/confirm`. If the trial hangs, resets, or never restores HTTP,
the watchdog causes the updater to return to the last confirmed slot.

Build artifacts live under `.build/ota/`; `p1am-recovery.bin` contains the
second-stage updater plus App A at their fixed flash offsets.

The macOS `BaseStation.command` and Windows `Base Station.bat` launchers run
`uv run gui`.

## Web interface

- `http://127.0.0.1:8000/` is the sunlight-readable operator dashboard.
- `http://127.0.0.1:8000/diagnostics` shows detailed P1AM and LabJack health,
  response timing, rack status, LabJack connection settings, controller restart,
  errors, and filterable structured logs.
- `http://127.0.0.1:8000/runs` lists durable acquisition runs, opens tiered
  history views, exports CSV files to the browser, and downloads database backups.
- `GET /api/status` supplies the live dashboard snapshot.
- `GET /api/logs` supplies up to 500 recent structured events and accepts the
  optional `level`, `component`, and `limit` query parameters.

There is intentionally no Node.js project, `package.json`, or npm build step.
HTMX 2.0.10 is stored under `src/base_station/web/static/vendor/` so the operator
interface does not depend on an internet connection.

FastAPI uses one background poller per process and reads the P1AM's combined
`GET /api/status` endpoint. Browser count therefore does not multiply routine
controller traffic. HTMX action controls use its request classes plus shared
CSS indicators; no custom spinner JavaScript is used.

The LabJack scan rate is captured when a run starts and remains locked until it
stops. Start and Stop are idempotence-guarded by an explicit
starting/running/stopping/idle lifecycle, so repeated UI requests cannot create
multiple stream threads or stop the device twice.

Every acquisition is recorded automatically in `data/acquisition.sqlite3`.
There is no record checkbox and no CSV file is written into the repository;
CSV is generated as a streaming browser download from the Runs page. SQLite is
part of Python's standard library, so durable history adds no runtime dependency.
Dashboard and recorded-run detail share the same Full/Context/Detail navigator
and playback implementation. Drag the navigator to move through time. Drag a
main graph to inspect statistics, or hold Shift while dragging to make the
selected interval the Context view. The dashboard uses one red Record control
that becomes Stop recording and reports duration from the authoritative acquired
sample count.

Runs always store raw differential samples. Graph settings are display-only:
The server bounds every graph response with SQLite time buckets containing the
raw minimum, maximum, mean, and count for both channels. The browser applies the
moving-average window or exponential-moving-average time constant to those
bounded means, so display work stays predictable even for long runs. Changing a
graph filter never changes the raw database, min/max envelope, or CSV export.

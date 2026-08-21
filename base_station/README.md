# Base Station

Operator UI, LabJack DAQ, run archive, and P1AM firmware tooling.

## Prerequisites

- [uv](https://docs.astral.sh/uv/getting-started/installation/)
- [Arduino CLI](https://arduino.github.io/arduino-cli/latest/installation/)
- [LabJack LJM](https://support.labjack.com/docs/ljm-software-installer-downloads-t4-t7-t8-digit)
- The P1AM Arduino board core and the libraries listed in
  [`../fill_cart/README.txt`](../fill_cart/README.txt)

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

# Build updater, both application slots, and USB recovery image
uv run compile

# Inspect the running P1AM firmware
uv run system

# Normal deployment over Ethernet
uv run ota

# Bootstrap/recovery through the factory USB bootloader
uv run upload

# Select a directly attached serial port explicitly for USB recovery
uv run upload --port /dev/cu.usbmodem11301
```

Normal development uses `uv run ota`; USB is not required. OTA writes the
inactive A/B slot, waits for that exact build to return, then confirms it.
Watchdog/reset failure rolls back to the last known-good slot. The factory
P1AM bootloader remains untouched.

Build artifacts live under `.build/ota/`; `p1am-recovery.bin` contains the
second-stage updater plus App A at their fixed flash offsets.

The macOS `BaseStation.command` and Windows `Base Station.bat` launchers run
`uv run gui`.

## Web interface

- `/dashboard` — read-only Live Dashboard and telemetry navigator.
- `/dashboard/layout` — Dashboard widget placement and visibility.
- `/dashboard/views` — Dashboard presentation-view authoring.
- `/state` — Fill Cart state transitions and controller health.
- `/signals` — Signal Graph editor and low-rate preview.
- `/runs` — Record/Stop, run archive, CSV export, and database backup.
- `/devices/p1am` — P1AM health, P1 rack initialization, and restart.
- `/devices/labjack` — LabJack connection and device health.
- `/logs` — structured system events.
- `/settings` — System/Light/Dark appearance.

DAQ configuration is saved to `data/daq-config.json` with independently owned
`graph`, `sources`, and `dashboard` sections. LabJack acquisition settings live
on `/devices/labjack`; Signal Graph saves topology only. Draft graph preview uses
one WebSocket connection. Engineering transforms are server-side NumPy-compatible
functions.

The LabJack adapter compiles the saved graph into a generic acquisition plan.
Recorded sources cross the shared `SignalDescriptor` / `SampleBatch` boundary,
so run storage, CSV export, decimation, and history rendering are not tied to a
fixed LabJack channel count.

There is no frontend build step. Jinja renders complete documents; native ES
modules use JSON `fetch` for commands/data and SSE/WebSocket for live updates.
Vendored Lit is used only for blueprint DOM updates. Browser dependencies are
served locally from `static/vendor/`. Because first-party ES
modules are intentionally unversioned, static assets use ETag revalidation
(`Cache-Control: no-cache`) rather than immutable caching; repeat navigation can
reuse cached bodies while an application restart cannot silently mix module generations.

Top-level page metadata (canonical route, sidebar label/icon, and browser title)
lives in `web/navigation.py`. Browser-owned SSE/WebSocket resources share the
small `static/page-resource-lifecycle.js` page/BFCache lifecycle helper.

The persistent sidebar is global-only and collapses from 260 px to a 52 px icon
rail. Page-specific actions stay in page content. Shared app chrome uses semantic
tokens from `static/design-tokens.css`; appearance can follow the OS or be pinned
to Light/Dark. Ordinary interaction/selection chrome is neutral rather than using
a global accent color; green is reserved for semantic success/healthy state.
First-party UI CSS intentionally avoids `box-shadow`.

UI chrome is intentionally sparse. Prefer typography, headings, grouping, and
whitespace over decorative separators, cards, or filled containers. Borders and
backgrounds should only exist when they communicate a real control/data boundary,
interaction affordance, or semantic state. Familiar icon actions stay visually
bare; route selection uses the same neutral surface family as hover rather than
the green accent. Standard rounded app chrome uses `--radius-ui` (10 px), while
tighter engineering controls may use smaller radii when appropriate. Large
canvas/editor surfaces should not receive page-sized focus outlines; focus rings
belong on the actual interactive control.

FastAPI polls the P1AM once per process through a serialized, validated client,
so opening more browsers does not multiply controller traffic or race operator
commands. Browser status/state updates use SSE rather than periodic HTML
polling. Dashboard telemetry and Logs are SSE streams; unsaved Signal Graph preview
uses WebSocket because graph revisions also travel from browser to server.

Live Dashboard sampling is process-owned rather than browser-owned. The server
keeps a bounded 10-minute recent-history window for Time Plot outputs, so
switching tabs or reloading restores recent context instead of starting at zero.
Both the server and browser prune outside that window, so a Dashboard left open
for hours has constant memory/data bounds. **New live session** clears only this
ephemeral Dashboard history; it does not delete saved recordings. Saving a
changed signal graph/source configuration also starts a new live session so
differently configured signals are never mixed in one history.

Dashboard authoring is split into dedicated pages. `/dashboard/layout` owns
widget visibility, position, size, and stacking on the canonical snap-grid
world. `/dashboard/views` owns three optional source rectangles drawn over that
same canonical 100%-zoom world. Both authoring pages may pan/zoom for editing,
but their saved coordinates are camera-independent.

`/dashboard` is the read-only Live Dashboard. It contains no layout toolbar or canvas
zoom controls; the telemetry navigator remains on the bottom row. Number keys
1–3 select saved views. Presentation projects the selected source rectangle to
the full Dashboard viewport by changing each widget's responsive
left/top/width/height box; widget contents are never CSS-scaled or distorted.

The LabJack source settings own acquisition scan rate, resolution, settling,
and MUX80 configuration. Runs displays and uses that saved source rate.
Start/Stop is guarded by an explicit starting/running/stopping/idle lifecycle.

Runs are durable high-rate recordings stored in `data/acquisition.sqlite3`.
CSV is generated on demand; no CSV files are written into the repository.
Record/Stop lives on `/runs` and is only shown when the LabJack is available;
the archive remains useful while hardware is offline. A live Dashboard session
is intentionally not a substitute for a durable recording. Runs are acquisition
artifacts rather than experiment metadata; if experiment tracking is added, an
Experiment should reference one or more run IDs instead of overloading the run
storage model with notes/procedures/state-machine context.

Run-history filtering is display-only. Stored samples and CSV exports remain raw.

## Tests

```bash
uv run python -m unittest discover -s test -v
```

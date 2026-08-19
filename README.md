# Liquid State Machine

Ground-station software, Fill Cart firmware, and P1AM OTA tooling.

## Architecture

- `base_station/` — FastAPI operator UI, LabJack DAQ, run storage, firmware tools.
- `fill_cart/` — P1AM state machine and P1 rack valve/igniter outputs.
- `p1am_updater/` — second-stage A/B Ethernet OTA updater.
- `firmware_libs/P1AMOta/` — shared OTA boot-state support.

The base station talks to both devices directly:

- P1AM: `192.168.8.50` — state machine and actuators.
- LabJack T7: `192.168.8.51` — sensor acquisition.

The P1AM does not control the LabJack.

## Quick start

```bash
cd base_station
uv sync --locked
uv run gui
```

Pages:

- `/` — live telemetry.
- `/state` — Fill Cart state control.
- `/configuration` — DAQ signal graph.
- `/runs` — Record/Stop and run archive.
- `/devices/p1am` — P1AM health, rack initialization, and restart.
- `/devices/labjack` — LabJack connection and device health.
- `/logs` — structured system events.
- `/settings` — appearance preferences.

The operator UI uses a global 260 px sidebar that collapses to a 52 px icon rail.
Device/navigation state lives there; route-specific controls stay on their pages.

## Firmware

Normal updates are Ethernet-only:

```bash
cd base_station
uv run system
uv run ota
```

USB is only for bootstrap/recovery:

```bash
uv run upload --port /dev/cu.usbmodemNNNN
```

See `base_station/README.md` and `fill_cart/README.txt` for details.

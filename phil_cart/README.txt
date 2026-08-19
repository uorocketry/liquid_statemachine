Arduino IDE Setup Instructions
-------------------------------

Bootloader / upload mode
------------------------

The reliable visual cue is the P1AM-100 status LED pulsing/flashing yellow.
Use the reset-button timing that produces that pattern (normally a quick
double-tap; an inconsistent tap can occasionally appear to do the same thing),
then upload while the USB port is visible. The normal application state does
not keep the yellow LED pulsing.

From this repository, list ports and upload with:

    arduino-cli board list
    cd base_station
    uv run upload --port /dev/cu.usbmodemNNNNN

Replace the example port with the port shown by `arduino-cli board list`.

Startup safety
--------------

Boot does not cycle valves or write every configured output automatically.
The controller starts in the `Valve Testing` state as an idle software state;
physical output actions require an explicit operator command. This also avoids
blocking startup when the connected P1 module layout differs from the expected
slot configuration.

1. Install
- the P1AM library: https://github.com/facts-engineering/P1AM?tab=readme-ov-file#installing-the-library
- the ArduinoJson, StateMachine, and TaskManagerIO library in the Arduino IDE

If you encounter an error like "No device found on ttyACM0", this probably means you don't have the right permissions for the /dev/ttyACM0 file. See https://stackoverflow.com/a/49063205.

Ethernet / OTA Setup
--------------------

The machine LAN is `192.168.8.0/24` behind the GL.iNet router. The controller is
static at `192.168.8.50`; the LabJack T7 is static at `192.168.8.51`.

The controller exposes HTTP/1.1 JSON at `http://192.168.8.50`:

- `GET /api/status` — health, current state, and allowed transitions.
- `GET /api/system` — running version/build/slot plus OTA/rollback state.
- `POST /api/p1/initialize` — initialize the P1 rack explicitly.
- `POST /api/reset` — put initialized outputs in the reset state and reboot.
- `PUT /api/state/{id}` — request a validated state transition.
- `POST /api/firmware` — stream a raw inactive-slot application image.
- `POST /api/firmware/confirm` — make the currently running trial known-good.

Do not normally call the firmware endpoints by hand. From `base_station/`, use:

    uv run system
    uv run ota

The factory P1AM USB bootloader remains untouched. `uv run upload` is reserved
for first-time bootstrap or recovery and installs the tiny second-stage updater
plus a known-good App A. Normal Ethernet deployment alternates between App A
and App B. The new slot must come back over HTTP and be explicitly confirmed;
otherwise watchdog/reset recovery returns to the last known-good slot.

Ethernet and health start before rack initialization. Until P1 initialization
succeeds, health is degraded, transitions are empty, and state-change requests
return `503 Service Unavailable`.

State indices are: valve testing `0`, initialize `1`, fuel fill `2`, LOX fill
`3`, fire `4`, purge `5`, overload `6`, and abort `7`.


Starting the Box
----------------
1. Breaker on
2. Blue button
3. Connect arduino
4. Make sure coaxial cable is connected
5. Connect ethernet

Stopping the Box
----------------
1. Breaker off

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

Ethernet Setup Instructions
---------------------------

2. Connect ethernet shield to computer (no power source is needed, it seems like the computer by itself can power the P1AM).

3. Give ethernet an ip address. Linux instructions:

    $ ip a
    ...
    7: enp0s20f0u2: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP group default qlen 1000
        link/ether 00:e0:4c:88:fb:b3 brd ff:ff:ff:ff:ff:ff
        altname enx00e04c88fbb3
        inet6 fe80::5d3b:7df6:d4bc:8a15/64 scope link tentative noprefixroute
           valid_lft forever preferred_lft forever

Note that the id here is enp0s20f0u2

    $ sudo ifconfig enp0s20f0u2 192.168.1.1

    $ ip a
    ...
    7: enp0s20f0u2: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP group default qlen 1000
        link/ether 00:e0:4c:88:fb:b3 brd ff:ff:ff:ff:ff:ff
        altname enx00e04c88fbb3
        inet 192.168.1.1/24 brd 192.168.1.255 scope global enp0s20f0u2
           valid_lft forever preferred_lft forever
        inet6 fe80::5d3b:7df6:d4bc:8a15/64 scope link noprefixroute
           valid_lft forever preferred_lft forever

Now, we have the ip 192.168.1.1, and can connect.


Talking to the Arduino
----------------------

The controller exposes an HTTP/1.1 JSON API at `http://192.168.0.50`:

- `GET /api/status` — health, current state, and allowed transitions in one
  response.
- `POST /api/p1/initialize` — initialize the P1 rack explicitly.
- `POST /api/reset` — close initialized valve outputs and software-restart the
  controller. Rack initialization is required again after restart.
- `PUT /api/state/{id}` — request a validated transition.

Responses use JSON and standard HTTP status codes. A valid transition request
returns `202 Accepted`; an unavailable transition returns `409 Conflict`.
The firmware has no legacy binary-protocol compatibility path.
Ethernet and health start before rack initialization. Until initialization
succeeds, health reports a degraded controller, transitions are empty, and
state-change requests return `503 Service Unavailable`.

State indices are: valve testing `0`, initialize `1`, fuel fill `2`, LOX fill
`3`, fire `4`, purge `5`, overload `6`, and abort `7`.

The base station provides the preferred interface; run it from `base_station/`
with `uv run gui` (or the equivalent alias `uv run web`).


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

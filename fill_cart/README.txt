Fill Cart / P1AM
================

The P1AM owns the cart state machine and drives valves/igniters through the P1
I/O rack. The LabJack is a separate Ethernet device controlled by the base
station.

Network
-------

P1AM:   192.168.8.50
LabJack: 192.168.8.51

After a power cycle, use `/devices/p1am` to initialize the P1 rack before state
transitions. Use `/state` for normal state control.

Valve outputs
-------------

All current actuator outputs use P1 rack slot 2:

  1  Fuel N2 pressure
  2  LOX vent
  3  Fuel vent
  4  LOX main
  6  Fuel main
  7  LOX N2 pressure
  9  Igniter 1
 10  Igniter 2

Firmware updates
----------------

Normal development is Ethernet OTA; leave USB unplugged:

    cd base_station
    uv run system
    uv run ota

OTA writes the inactive A/B slot. The new build is a trial until the host sees
that exact build over HTTP and confirms it. A watchdog/reset failure rolls back
to the last known-good slot.

USB is only for bootstrap/recovery. Put the factory bootloader in upload mode
(status LED pulsing yellow), then:

    arduino-cli board list
    cd base_station
    uv run upload --port /dev/cu.usbmodemNNNN

The factory P1AM bootloader is never replaced.

HTTP API
--------

  GET  /api/status             health, state, allowed transitions
  GET  /api/system             firmware slot/build and rollback state
  POST /api/p1/initialize      initialize the P1 rack
  POST /api/reset              close initialized outputs and reboot
  PUT  /api/state/{id}         request an allowed state transition
  POST /api/firmware           upload an inactive-slot image
  POST /api/firmware/confirm   confirm the running trial

Do not call firmware endpoints manually; use `uv run ota`.

States
------

0 Valve testing, 1 Initialize, 2 Fuel fill, 3 LOX fill, 4 Fire, 5 Purge,
6 Overload, 7 Abort.

Startup safety
--------------

Boot does not cycle valves. Valve Testing is an idle state; physical outputs
change only after an explicit command. Until P1 initialization succeeds,
transitions remain unavailable.

Build prerequisites
-------------------

Arduino CLI plus the P1AM, ArduinoJson, StateMachine, and TaskManagerIO Arduino
libraries are required. See `base_station/README.md` for host setup.

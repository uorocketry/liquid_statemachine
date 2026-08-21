# DAQ Graph browser modules

Browser code for `/configuration` owns **graph topology only**. LabJack
acquisition policy is edited on `/devices/labjack`; Dashboard frame geometry is
edited on the Dashboard. Those domains have separate API transactions.

## Node creation

`palette.js` owns the toolbar category registry and builds the category menus at
runtime. Current groups are LabJack inputs, Sensor transforms, Math +
Simulation, and Dashboard outputs. Add or reorganize a toolbar category there
rather than duplicating menu markup in the Jinja template.

`catalog.js` owns hardware-node factories. `node-specs.js` owns declarative
simulation/math/dashboard node presentation and receives its persisted defaults
from the server at bootstrap. `presentation.js` adds hardware-specific inline
controls and inferred units.

## Editing and save lifecycle

`app.js` owns page lifecycle, dirty state, graph validation, undo/redo/frame,
and canonical graph saves. There is intentionally no explicit Reload/Discard
button: normal navigation/reload uses the browser's unsaved-changes guard to
confirm discarding edits.

The Blueprint editor owns pending text/number drafts. `Cmd/Ctrl+S` or Save
flushes the pending draft before validation. The server returns the exact graph
it stored, and the editor adopts it. Do not recreate separate pending-edit
state in DAQ Graph code.

## Preview

`live-preview.js` owns one WebSocket to `/api/daq/preview/ws`. The browser sends
the current unsaved graph when it changes; the server continuously returns
preview values while that graph is valid. LabJack settings arrive as read-only
source context and are never written by this page. Simulation sources can
preview without connected hardware.

This bidirectional editor preview is intentionally separate from server-owned
Dashboard telemetry, which uses SSE. Do not turn either stream back into
periodic HTTP polling.

The reusable editor implementation remains in `static/blueprint/`; keep it
domain-neutral.

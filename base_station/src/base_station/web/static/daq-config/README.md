# DAQ configuration

Browser modules for `/configuration`. The graph is saved through FastAPI and
edited directly on nodes.

Page-specific controls are kept out of the global site sidebar. Nodes,
acquisition settings, validation issues, history, framing, reload, and save live
in the graph's bottom toolbar/popovers.

## Nodes

- channel / channel pair;
- analog current and voltage inputs;
- thermocouple;
- pressure calibration;
- load cell;
- simulation sine wave;
- constant, add, subtract, gain, moving average, rate-of-change;
- dashboard signal.

Linkable settings use literal-or-link inputs: type a value on the node or wire a
compatible output into the pin. Units propagate through derived nodes where
possible.

## Modules

- `app.js` — page lifecycle and save state.
- `catalog.js` — node factories.
- `presentation.js` — inline controls and inferred units.
- `validation.js` — browser validation.
- `live-preview.js` — low-rate preview/path highlighting.
- `api.js` — FastAPI client.

The reusable DOM/editor code lives in `static/blueprint/`.

## Preview

When the LabJack is connected and idle, preview reads configured inputs through
the existing LJM handle. A graph containing a simulation sine-wave source can
also preview while the LabJack is disconnected. Preview does not write power-up
defaults. Thermocouples use raw AIN voltage plus device cold-junction
temperature and host LJM conversion.

MUX80 channel rules remain supported in the model but are not exposed in the
normal UI until that optional hardware is needed.

Stream resolution and settling are graph-wide acquisition settings. Analog
input range remains node-specific.

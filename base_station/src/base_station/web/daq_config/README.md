# DAQ graph architecture

The DAQ graph separates **node schema**, **runtime math**, **hardware
integration**, and **dashboard rendering**. Keep those boundaries when adding
features.

## Current schema only

This project supports one graph schema at a time. `schema.py` normalizes the
current fields, pins, and graph-wide acquisition defaults. Unknown node types
are validation errors, and unknown config keys are discarded during
normalization. There is intentionally no compatibility layer for retired
schemas unless one is explicitly requested.

## Hardware-independent nodes

Simulation, math, and dashboard nodes live in two matching registries:

- Server: `node_specs.py` owns current defaults, persisted pins, and
  authoritative validation.
- Browser: `static/daq-config/node-specs.js` owns palette metadata, inline
  controls, presentation-only unit inference, and immediate client validation.

Their node-type names and config keys are a contract. Update both registries
and their contract tests together. Runtime computation belongs in
`node_runtime.py`; vectorized math belongs in `signal_math.py`.

## Hardware-specific nodes

LabJack sources and calibrated sensor nodes remain explicit in the hardware
catalog, presentation, validation, and preview modules. Their channel and
device semantics are different enough that forcing them through the generic
registry would hide useful behavior.

## Dashboard nodes

Dashboard presentation is modeled with first-class sink nodes:

- `number` owns numeric formatting and unit visibility.
- `gauge` owns gauge geometry, range limits, and gauge visibility settings.
- `time-plot` owns plot-specific Y-axis settings and participates in the
  shared time conductor.

All three receive an engineering value through their `value` input. Fan-out in
the graph is how one source is shown in more than one way; there is no combined
display mode.

Dashboard rendering is dispatched by `dashboard-widget-registry.js` to
dedicated renderers. Only `time-plot` nodes allocate history or enter the
timeline navigator. New visualization types should get their own node type,
schema, renderer, and tests rather than adding another mode to an existing
node.

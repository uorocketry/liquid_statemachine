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
- `time-plot` owns its plot axes and participates in the shared time
  conductor. X can follow the Dashboard view, show the full data extent, use a
  trailing window, or use fixed elapsed-time bounds. Y can use auto, soft, or
  fixed bounds with a linear or base-10 logarithmic scale. Major tick spacing
  can be automatic or explicit on linear axes; optional minor ticks/grid are
  derived by the renderer. Axis labels and grid visibility are node config.

All three receive an engineering value through their `value` input. Fan-out in
the graph is how one source is shown in more than one way; there is no combined
display mode.

Dashboard rendering is dispatched by `dashboard-widget-registry.js` to
dedicated renderers. Only `time-plot` nodes allocate history or enter the
timeline navigator. New visualization types should get their own node type,
schema, renderer, and tests rather than adding another mode to an existing
node.

Dashboard placement is separate from widget configuration. Canonical frame
geometry lives under `metadata.dashboardLayout.items` as integer `x`, `y`,
`w`, `h`, and `visible` fields on a 12-column grid. `dashboard_layout.py`
sanitizes that metadata and prevents overlapping visible frames.
`dashboard-layout-model.js` mirrors the small geometry contract in the browser,
while `dashboard-layout-editor.js` owns drag/resize/edit-session behavior.
Layout saves use the dedicated `/api/daq/dashboard-layout` endpoint so a stale
Dashboard tab never writes an old copy of the node graph back to disk.

Plot configuration describes **axis intent**, not raw canvas geometry.
`dashboard-axis-ticks.js` chooses bounded "nice" ticks,
`dashboard-plot-axis.js` resolves ranges/transforms/margins, and
`dashboard-axis-renderer.js` draws axes while suppressing overlapping labels.
`dashboard-time-renderer.js` only draws telemetry into that resolved plot
frame. This separation is intentional: malformed or extremely dense manual
tick requests must never create unbounded drawing work or unreadable labels.
Logarithmic plots skip non-positive samples rather than connecting across an
invalid domain. Time remains linear elapsed time even when Y is logarithmic.

Canvas plots expose a DOM description through `aria-describedby` and support
keyboard sample inspection with Left/Right/Home/End. Keep that accessible
fallback synchronized whenever axis semantics or inspection behavior changes.

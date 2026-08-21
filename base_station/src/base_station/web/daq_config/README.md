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

### Configuration persistence contract

All inline node controls use the Blueprint editor's shared draft/commit lifecycle.
Text and number inputs may remain as one pending draft while the user types;
selects and radios commit immediately. Save first flushes any pending draft, then
the server normalizes and validates the graph, atomically writes it, and returns
the exact canonical graph that was persisted. The editor adopts that returned
graph without resetting camera, selection, or undo history. Do not add page-level
shadow state for individual controls or assume that the submitted graph is the
same graph the server stored.

Inactive conditional settings remain persisted intentionally (for example a
Time Plot's previous trailing-window length while Fixed bounds are selected), so
switching modes restores the previous setup. Validation and rendering must only
apply the fields active for the selected mode. Live preview pauses while client
validation has blocking errors instead of sending known-invalid preview requests.
Graph-wide acquisition inputs use the same pattern through
`metadata-controls.js`: number fields keep a draft while typing, selects commit
immediately, and Save flushes metadata drafts before validation. This avoids
separate one-off save behavior for scan rate, resolution, or settling time.

## Acquisition sources

Hardware-specific node semantics stay explicit instead of being forced through
the declarative-node registry. The reusable boundary is the acquisition batch,
not a plugin framework:

- `acquisition.py` defines `SignalDescriptor` and `SampleBatch`.
- A source adapter compiles its hardware nodes from the current graph and
  yields aligned batches keyed by stable signal ids.
- `RunRepository` persists those descriptors/batches without importing or
  branching on the source type.
- Runs API/CSV/history render from persisted signal metadata, so adding a new
  source does not require new storage columns or run-history templates.

`labjack_source.py` is the T7 adapter. It owns both low-rate preview reads and
high-rate stream compilation/conversion. `LabJackService` owns only T7
connection/thread/status lifecycle and hands generic batches to the run store.
Do not put fixed AIN channel names in `LabJackService` or `RunRepository`.

To add a new acquisition source, implement its graph nodes/validation and a
source adapter that produces `SignalDescriptor` + `SampleBatch`. Source-specific
connect/disconnect/status UI can remain source-specific. A dynamic plugin loader
is intentionally not part of the architecture; explicit application wiring is
preferable while the source count is small.

The run database supports only its current pre-release schema. Recorded values
are stored in aligned binary chunks with per-chunk statistics, which keeps
high-rate writes compact while allowing bounded min/max/mean decimation for
history views. Changing that schema may reset local pre-release run history
rather than carrying compatibility code unless migration is explicitly needed.

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
`w`, `h`, `z`, and `visible` fields on a 12-column grid. Frames may overlap;
`z` is normalized to a compact deterministic stack, and grabbing a frame for
move/resize brings it to the front. `dashboard_layout.py` sanitizes persisted
metadata while `dashboard-layout-model.js` mirrors the geometry/stacking
contract in the browser. `dashboard-layout-editor.js` owns drag/resize/edit
session behavior.
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

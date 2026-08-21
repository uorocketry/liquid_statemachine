# DAQ configuration architecture

The DAQ subsystem has three independently owned configuration domains:

```text
daq-config.json
├── graph
│   ├── nodes
│   └── links
├── sources
│   └── labjack
│       ├── scanRate
│       ├── resolutionIndex
│       ├── settlingUs
│       └── mux80Enabled
└── dashboard
    └── layout
```

`DaqConfigRepository` is the only persistence boundary. It exposes section
writes (`save_graph`, `save_labjack_settings`, `save_dashboard_layout`) so one
page cannot overwrite stale state owned by another page. The project supports
one current schema only; retired schemas are not carried through production
code unless migration is explicitly requested.

Graph saves may reconcile dashboard **membership** because adding or deleting a
dashboard sink changes which frame ids are valid. Existing authored frame
geometry is preserved. Source settings and graph topology otherwise remain
independent transactions.

## Graph topology

`schema.py` normalizes only `nodes` and `links`. Device connection identity,
stream policy, and dashboard placement do not belong on graph nodes or graph
metadata.

Hardware-independent simulation, math, and dashboard nodes have matching
registries:

- `node_specs.py` owns authoritative defaults, canonical pins, and server
  validation.
- `static/daq-config/node-specs.js` owns editor controls, palette metadata,
  presentation-only unit inference, and fast client validation.
- `node_runtime.py` owns scalar preview execution.
- `signal_math.py` owns reusable/vectorized math.

The server remains authoritative. Inline text/number controls use the Blueprint
editor's shared draft lifecycle; Save flushes the pending draft, the server
normalizes and validates the graph, atomically stores it, and returns the exact
canonical graph. The editor adopts that returned graph without resetting camera
or selection. Do not add page-level shadow state for individual node controls.

## Source configuration and acquisition

LabJack-wide acquisition policy lives in `labjack_settings.py`, is edited on the
LabJack device page, and is persisted through `/api/sources/labjack/settings`.
The graph receives those settings only as read-only source context for channel
availability and validation.

Hardware-specific node semantics stay explicit. The reusable ingestion
boundary is deliberately small:

- `acquisition.py` defines `SignalDescriptor` and `SampleBatch`.
- A source adapter compiles its graph nodes plus source settings and yields
  aligned batches keyed by stable signal ids.
- `RunRepository` persists descriptors/batches without branching on hardware.
- Runs API, CSV export, decimation, and history rendering consume persisted
  signal metadata rather than LabJack-specific columns.

`labjack_source.py` is the T7 adapter. It owns low-rate reads, stream-plan
compilation, LJM configuration, and engineering-unit conversion.
`LabJackService` owns connection/thread/run lifecycle only.

To add another hardware family, add its hardware-node UI/validation and a
source adapter that produces the shared descriptors/batches, then wire its
service explicitly. Do not add a plugin loader until source count/operational
requirements justify one. Storage, CSV, Runs UI, Dashboard widgets, and generic
timeline code should not need source-specific branches.

One recorded run currently assumes one aligned source clock. Multi-device
synchronization should get an explicit timebase policy when it is actually
required rather than being guessed now.

## Dashboard

Dashboard presentation uses first-class sink nodes:

- `number` — formatting and unit visibility.
- `gauge` — geometry, engineering limits, value/unit/range visibility.
- `time-plot` — axes and shared timeline participation.

Fan-out is how one engineering signal is shown in multiple ways. There is no
generic Dashboard Signal/display-mode node.

Dashboard placement is separate configuration under `dashboard.layout` and is
saved through `/api/dashboard/layout`. `dashboard_layout.py` owns canonical
12-column geometry and compact z-order. Frames may overlap; normal-view clicks
raise a frame transiently, while Edit + Save persists authored stacking.

The Time Plot renderer is split by concern: tick selection,
range/transform/layout, axis drawing, telemetry drawing, and time navigation are
separate modules. Configuration describes axis intent, not raw canvas pixels.
Tick generation is bounded and label collision is handled by the renderer.

## Runtime status transport

Hardware services update `DashboardState` in memory. The global shell consumes
one SSE stream (`/api/status/events`) and patches stable device DOM nodes only
when status changes; device pages request extra detail over the same stream.
The Dashboard's saved-graph telemetry is also one-way server-owned data, so it
uses its own SSE stream (`/api/dashboard/telemetry/events`) instead of 4 Hz POST
polling. Commands such as connect/reset/start/stop remain ordinary
request-response actions.

This intentionally avoids both 1 Hz HTML-fragment polling and a WebSocket/DOM
diff framework. SSE is the current one-way status transport; if richer
bidirectional realtime interaction becomes necessary later, the UI-facing
status event contract can remain while the transport changes. DAQ Graph live
preview is intentionally different: the browser owns an unsaved draft graph,
so it uses one WebSocket (`/api/daq/preview/ws`) to send graph revisions upstream
and receive preview values downstream. The socket holds only ephemeral preview
state; Save remains an ordinary canonical HTTP transaction.

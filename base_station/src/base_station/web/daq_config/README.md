# DAQ graph architecture

The DAQ graph deliberately separates **node definition**, **runtime math**, and
**hardware integration**. Keep those boundaries when adding a node.

## Hardware-independent nodes

Simple simulation, math, and dashboard nodes live in two matching registries:

- Server: `node_specs.py` owns canonical defaults, persisted pins, migrations,
  and authoritative validation.
- Browser: `static/daq-config/node-specs.js` owns palette metadata, inline
  controls, presentation-only unit inference, and immediate client validation.

Their node-type names and persisted config keys are a contract. When adding or
renaming one, update both registries and their contract tests in the same
change. Do not add another parallel branch to `catalog.js`, `presentation.js`,
`validation.js`, or `preview.py` for a registry node.

Runtime computation for these nodes belongs in `node_runtime.py`; vectorized
math belongs in `signal_math.py`. This keeps persisted schema concerns out of
the evaluator and makes the math independently testable.

## Hardware-specific nodes

LabJack sources and calibrated sensor nodes remain explicit in the hardware
catalog, presentation, validation, and preview modules. Their channel and
device semantics are genuinely different enough that forcing them through the
simple-node registry would hide important behavior.

## Dashboard displays

`dashboard-signal` is the single graph sink for operator presentation. Its
`display` setting chooses number, plot, number + plot, or gauge. Do not create a
second sink type just to add another visualization.

Dashboard rendering is split by responsibility:

- `dashboard-signal-card.js` chooses the presentation.
- `dashboard-gauge.js` owns gauge geometry and live gauge state.
- `dashboard-time-*` owns plot history and the shared time conductor.

Only plot-capable signals enter timeline history. A gauge or number therefore
does not allocate unused plot history or create a meaningless navigator.

Gauge range settings are nested under `config.gauge` and are materialized only
when `display === "gauge"`; normal dashboard signals stay compact in persisted
JSON.

# Blueprint editor

Reusable custom elements for the DAQ graph. Native ES modules use the vendored
Lit runtime for keyed DOM updates; no frontend build step is required.

## Components

- `<liquid-blueprint-editor>` — graph, camera, selection, links, history, menus.
- `<liquid-blueprint-node>` — node presentation and inline controls.

Graph data is plain JSON. Public shapes are documented with JSDoc in `model.js`.

## Behavior

- drag/multi-select/marquee;
- typed pin connections;
- copy/cut/paste/duplicate/delete/break links;
- undo/redo;
- RMB node/wire/canvas menus;
- pan, zoom, frame graph;
- inline literal controls;
- ephemeral node previews and path highlighting.

Nodes and wires are keyed by stable IDs. Preview/selection updates preserve
focused inputs and existing SVG paths.

## Host hooks

The DAQ layer supplies node decoration, connection policy, validation, and
persistence. Useful events include `blueprint-change`,
`blueprint-selection-change`, and `blueprint-create-request`.

Preview values are not serialized into `editor.graph`.

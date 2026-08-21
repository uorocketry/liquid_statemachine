# Blueprint editor

Reusable custom elements for the DAQ graph. Native ES modules use the vendored
Lit runtime for keyed DOM updates; no frontend build step is required.

## Components

- `<liquid-blueprint-editor>` — graph, camera, selection, links, history, menus.
- `<liquid-blueprint-node>` — node presentation and inline controls.

Public graph/view methods live in `editor-api.js`. Clipboard, destructive edit,
and undo/redo commands live in `editor-commands.js`; keep new command behavior
there instead of turning the public API module into a catch-all.

Graph data is plain JSON. Public shapes are documented with JSDoc in `model.js`.

## Behavior

- Select (`V`) drag/multi-select/marquee and node movement;
- Hand (`H`) left-drag canvas panning;
- typed pin connections;
- copy/cut/paste/duplicate/delete/break links;
- undo/redo;
- RMB node/wire/canvas menus;
- shared engineering-canvas pan, continuous wheel zoom, interpolated click zoom targets, fit, and selection framing;
- inline literal controls;
- ephemeral node previews and path highlighting.

Nodes and wires are keyed by stable IDs. Preview/selection updates preserve
focused inputs and existing SVG paths.

## Host hooks

The DAQ layer supplies node decoration, connection policy, validation, and
persistence. Useful events include `blueprint-change`,
`blueprint-selection-change`, and `blueprint-create-request`.

Preview values are not serialized into `editor.graph`.

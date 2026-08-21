# Liquid State Machine contributor notes

These notes capture the current project state and UI decisions that should be preserved.

## Workflow

- Work directly on `main`; inspect `git status` before edits and preserve unrelated work.
- Keep changes small and trackable. Prefer modules under roughly 300 LOC and split by responsibility.
- Do not restructure working firmware/hardware code unless the task requires it.
- Treat Fill Cart/LabJack hardware as powered off until the user explicitly says it is available again.
- For trivial copy/CSS changes, prefer targeted source checks over a full browser/visual-QA cycle unless requested.
- Keep progress/final reports concise and concrete.

## System architecture

- `base_station/` — FastAPI operator UI, LabJack DAQ, run storage, firmware tooling.
- `fill_cart/` — P1AM state machine and P1 rack actuator firmware.
- P1AM: `192.168.8.50`; LabJack T7: `192.168.8.51`.
- The base station talks to both devices directly; the P1AM does not control the LabJack.
- Human-facing product name is **Fill Cart**.
- Prefer modules under roughly 300 LOC because responsibilities should split before files become catch-alls. Declarative registries may approach that size when keeping one change surface is clearer than artificial fragmentation.
- P1AM integration is split under `web/p1am/`: `client.py` owns serialized HTTP/protocol validation, `service.py` owns lifecycle/health/transition supervision, and `states.py` owns operator state semantics.
- Device identity/navigation metadata is declared once in `web/devices.py`; device-specific services/pages remain explicitly composed.
- Top-level operator route/label/icon/title metadata is declared once in `web/navigation.py`; templates and route decorators consume that registry instead of duplicating navigation strings.
- Acquisition sources meet the generic `SignalDescriptor` / `SampleBatch` boundary. Run storage/history/CSV must remain source-agnostic.

## Current web shell

- The persistent sidebar is global-only: brand, Devices, Navigation, Settings.
- Expanded width: 260 px. Collapsed mini-rail: 52 px.
- Do not add route/page-specific actions back into the global sidebar.
- Device rows link to `/devices/p1am` and `/devices/labjack`; route selection and device health are separate states.
- Main routes: `/dashboard`, `/dashboard/layout`, `/dashboard/views`, `/signals`, `/state`, `/runs`, `/logs`, `/settings`. `/` and `/configuration` are compatibility redirects only.
- Content pages are full-width. Do not reintroduce arbitrary page max-width wrappers or a second page-background layer.
- Page templates render complete documents. Do not reintroduce HTML fragment-response routes, template swap targets, or HTMX. Browser commands/data use JSON `fetch`; long-lived state uses the shared SSE/WebSocket lifecycle contract.

## UI design rules

- Prefer a clean, icon-forward engineering UI.
- Use icon-only controls for familiar actions when they have an accessible label/tooltip.
- Keep familiar icon actions bare by default: compact hit area, no border, no filled background, no pill/card treatment, and no decorative radius. Hover may strengthen icon color; keyboard focus uses `outline`.
- Keep visible text for ambiguous, safety-critical, or configuration controls (Fill Cart state transitions, Record/Stop, health, scan rate, resolution, settling).
- Use supplied SF Symbols for all generic app/navigation/action icons. Store the supplied SF set under `base_station/src/base_station/web/static/icons/sf/`; use `static/icons.css` plus `currentColor`/CSS masks instead of custom or ad-hoc SVG when a supplied symbol exists. Only actual vendor/device marks (Arduino/LabJack) may remain outside `sf/`.
- Avoid redundant headings, eyebrows, tutorial/helper prose, repeated device/page names, and text the UI already makes obvious.
- Default to less chrome. Do not add borders, separator lines, filled backgrounds, cards, or container decoration when headings, grouping, spacing, and typography already make the structure clear. A border/background should communicate a real control boundary, data boundary, interaction affordance, or semantic state—not merely decorate a section.
- **Do not use `box-shadow` in first-party UI CSS.** No inset accent rails, shadow-based active states, hover shadows, focus rings made with shadows, or decorative card shadows. Use semantic color/background/border and CSS `outline` for focus.
- Navigation hover and active/current-route states use the same neutral hover surface and normal text color. Do not use the green accent or a left accent rail for current-page navigation. Use `--radius-ui` for standard rounded app chrome; it is currently 10px. Keep tighter engineering controls/node internals smaller when that geometry reads better.
- There is no global app accent color. Ordinary selection/navigation/control chrome is neutral. Use semantic `success`/`warning`/`danger` colors only when the color communicates state, and use graph-specific data/highlight colors inside engineering visualizations instead of repurposing a global accent.
- Avoid page- or viewport-sized focus outlines. Focus indication belongs on the actual interactive control; large canvases/editors should not flash a full-page accent frame.
- Use semantic tokens from `static/design-tokens.css` for app chrome. Do not invent route-local surface/text/hover grays. Explicit data colors are fine when hue carries engineering meaning.
- Light/Dark/System appearance is controlled from `/settings`; shared chrome must stay readable in all modes.

## DAQ editor

- Node configuration belongs inside nodes.
- The global sidebar must not contain DAQ controls.
- DAQ page controls live in the bottom graph toolbar/popovers: categorized node creation, issues, undo/redo, frame, and save. Browser reload/navigation is the discard mechanism; do not add a second reload/discard transaction.
- LabJack acquisition settings (scan rate, resolution, settling, MUX80) belong to the LabJack device page, not graph topology.
- Persisted DAQ configuration is section-owned: `graph`, `sources.labjack`, and `dashboard.layout` have independent atomic save APIs.
- Low-rate draft preview uses one WebSocket because the browser owns unsaved graph state and readings flow back from the server.
- Browser-owned SSE/WebSocket resources use `static/page-resource-lifecycle.js`: start on page load, stop on `pagehide`, resume on persisted `pageshow`, and opt into visibility pausing only when the resource is intentionally idle in background tabs.
- Sidebar links remain ordinary document navigations. Native browser Back/Forward may use BFCache; `site-shell.js` checks the repository config-version token on persisted restore and reloads only when configuration changed while the page was away. Do not replace sidebar links with history manipulation.
- Engineering transforms use server-side NumPy-compatible signal math.
- The LabJack adapter compiles the saved graph into a generic stream plan; run storage must not contain fixed LabJack channel columns.

## Runs and devices

- Recording controls live inside `/runs`, not in the global sidebar.
- Runs are durable acquisition artifacts, not the generic experiment model. If experiment tracking is added, keep it as a separate domain that references run IDs.
- The LabJack source settings own scan rate; Runs displays/uses the saved source rate.
- P1AM and LabJack have separate device pages.
- Logs have a dedicated `/logs` page; do not recreate a combined Diagnostics page.
- Global/device health uses one SSE status connection and patches stable DOM. The State Machine page also consumes the P1AM detail payload from that stream; do not reintroduce periodic browser polling for cart state.
- Saved Dashboard telemetry and the Logs page use SSE. Operator commands and persistence remain normal request/response transactions.
- Dashboard live history is process-owned and bounded to 10 minutes; reload/tab changes restore that recent window. Starting a new live session clears only ephemeral Dashboard history, never durable Runs.
- `/dashboard/layout` manages visibility/position/size/stacking only for existing Number/Gauge/Time Plot outputs from the Signal Graph. Do not let Dashboard pages mutate graph topology.
- Dashboard authoring is split by responsibility: `/dashboard/layout` edits canonical snap-grid `items`; `/dashboard/views` edits three source rectangles over that canonical 100%-zoom world; `/dashboard` is read-only Live Dashboard presentation plus the telemetry navigator. Layout and view writes are section-scoped so one page cannot overwrite the other's newer state.
- Signal Graph and Dashboard authoring share the engineering-canvas contract: camera/world-coordinate math from `static/viewport-camera.js`, major/minor grid styling/control chrome from `static/engineering-canvas.css`, and `static/engineering-canvas-zoom.js`. Do not duplicate pan/zoom/fit/grid formulas in route-specific authoring modules.
- Engineering authoring canvases use the same interaction tools: `V` = Select and `H` = Hand. Hand makes left-drag pan; middle/right-drag remain pan shortcuts. Select owns domain editing (Signal Graph marquee/node movement, Dashboard Layout marquee/group movement, Dashboard Views view selection/draw/move/resize).
- The read-only Dashboard has no editor toolbar or zoom control. A saved view is projected edge-to-edge onto the viewport by remapping responsive widget `left/top/width/height` boxes from canonical 100%-zoom world geometry; never CSS-scale/distort rendered widget contents.
- Static browser modules are intentionally unbundled/unversioned. Serve them with `Cache-Control: no-cache` so ETags can produce cheap `304` revalidation without risking stale mixed module generations after an app restart. Do not add immutable caching without first adding real asset versioning.

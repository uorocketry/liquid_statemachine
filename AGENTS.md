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

## Current web shell

- The persistent sidebar is global-only: brand, Devices, Navigation, Settings.
- Expanded width: 260 px. Collapsed mini-rail: 52 px.
- Do not add route/page-specific actions back into the global sidebar.
- Device rows link to `/devices/p1am` and `/devices/labjack`; route selection and device health are separate states.
- Main routes: `/`, `/state`, `/configuration`, `/runs`, `/logs`, `/settings`.
- Content pages are full-width. Do not reintroduce arbitrary page max-width wrappers or a second page-background layer.

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
- DAQ page controls live in the bottom graph toolbar/popovers: node palette, acquisition, issues, undo/redo, frame, reload, save.
- Graph-wide stream settings are scan rate, stream resolution, and stream settling. Range remains per analog measurement node.
- Low-rate preview is server-side and starts automatically only when the LabJack is available and acquisition is idle.
- Engineering transforms use server-side NumPy-compatible signal math.
- The high-rate recorder still uses the legacy fixed stream/storage schema; saved-graph compilation into acquisition/storage is not complete yet.

## Runs and devices

- Recording controls live inside `/runs`, not in the global sidebar.
- DAQ Setup owns scan rate; Runs displays/uses the saved DAQ rate.
- P1AM and LabJack have separate device pages.
- Logs have a dedicated `/logs` page; do not recreate a combined Diagnostics page.

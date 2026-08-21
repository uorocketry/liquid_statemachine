"""Static contract checks for operator-facing controls and production routes."""

from pathlib import Path
from hashlib import sha256
from unittest import TestCase


ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "src" / "base_station" / "web"


def read(relative: str) -> str:
    return (WEB / relative).read_text(encoding="utf-8")


class FrontendContractTests(TestCase):
    def test_configuration_commands_have_handlers(self) -> None:
        template = read("templates/configuration.html")
        base = read("templates/base.html")
        app = read("static/daq-config/app.js")
        shell = read("static/site-shell.js")
        for element_id in (
            "daq-save", "daq-reload", "daq-scan-rate", "daq-stream-resolution",
            "daq-stream-settling", "daq-undo", "daq-redo", "daq-frame",
        ):
            self.assertIn(f'id="{element_id}"', template)
            self.assertIn(f"#{element_id}", app)
        self.assertIn('id="site-sidebar-toggle"', base)
        self.assertIn("#site-sidebar-toggle", shell)
        self.assertIn("saveButton.addEventListener('click', save)", app)
        self.assertIn("reloadButton.addEventListener('click', reload)", app)
        self.assertIn("undoButton.addEventListener('click', () => editor.undo())", app)
        self.assertIn("redoButton.addEventListener('click', () => editor.redo())", app)
        self.assertIn("frameButton.addEventListener('click', () => editor.fitGraph())", app)
        self.assertIn("if (capabilities?.device?.connected || hasSimulation) preview.start()", app)
        for removed in (
            "daq-live-toggle", "daq-preview-state", "daq-device-state",
            "daq-mux80", "daq-acquisition-menu", 'graph-title="Liquid DAQ"',
        ):
            self.assertNotIn(removed, template)
        self.assertIn('class="daq-floating-tools"', template)
        self.assertIn('id="daq-node-tools"', template)
        self.assertIn('id="daq-acquisition-tools"', template)
        self.assertIn('id="daq-issue-tools"', template)
        self.assertNotIn('site-sidebar-section', template)
        self.assertNotIn('class="daq-setup-header"', template)

    def test_site_navigation_uses_collapsible_global_sidebar(self) -> None:
        base = read("templates/base.html")
        shell = read("static/site-shell.js")
        shell_styles = read("static/site-shell.css")
        self.assertIn('class="site-shell"', base)
        self.assertIn('id="site-sidebar"', base)
        self.assertIn('<h2>Devices</h2>', base)
        self.assertNotIn('<h2>Navigation</h2>', base)
        self.assertNotIn('{% block sidebar_page %}', base)
        self.assertNotIn('{% block sidebar_footer %}', base)
        self.assertNotIn('class="topbar"', base)
        self.assertIn("liquid-site-sidebar", shell)
        self.assertNotIn("liquid-sidebar-open", shell)
        self.assertIn("--site-sidebar-collapsed-width: 52px", shell_styles)
        self.assertIn("grid-template-columns: var(--site-sidebar-collapsed-width)", shell_styles)
        self.assertIn("background: var(--color-canvas);", shell_styles)
        self.assertIn('<span>DAQ Graph</span>', base)
        self.assertIn("/static/icons/sf/daq-blueprint.svg", shell_styles)
        self.assertNotIn("DAQ Setup", base)
        self.assertNotIn("translateX(-100%)", shell_styles)
        self.assertIn('href="/settings"', base)
        self.assertIn("site-settings-link", shell_styles)

    def test_settings_and_theme_use_semantic_tokens(self) -> None:
        base = read("templates/base.html")
        settings = read("templates/settings.html")
        theme = read("static/theme.js")
        tokens = read("static/design-tokens.css")
        ui = read("ui_routes.py")
        self.assertIn('/static/design-tokens.css', base)
        self.assertIn('/static/theme.js', base)
        self.assertIn('@router.get("/settings"', ui)
        for option in ("system", "dark", "light"):
            self.assertIn(f'data-theme-option="{option}"', settings)
        self.assertIn("liquid-appearance", theme)
        self.assertIn('--color-surface-hover:', tokens)
        self.assertIn(':root[data-theme="dark"]', tokens)
        self.assertIn('--color-canvas: #000000;', tokens)

    def test_daq_editor_background_tracks_light_and_dark_canvas(self) -> None:
        setup = read("static/daq-config/setup.css")
        blueprint = read("static/blueprint/blueprint.css")
        self.assertIn('.daq-graph-stage .liquid-blueprint-editor { --blueprint-bg: var(--color-canvas);', setup)
        self.assertIn('linear-gradient(to right, var(--blueprint-grid-major) 1px, transparent 1px)', blueprint)
        self.assertIn('linear-gradient(to right, var(--blueprint-grid-minor) 1px, transparent 1px)', blueprint)

    def test_devices_keep_active_state_during_status_refresh(self) -> None:
        status = read("templates/fragments/system_status.html")
        ui = read("ui_routes.py")
        shell_styles = read("static/site-shell.css")
        self.assertIn("active_device == 'p1am'", status)
        self.assertIn("active_device == 'labjack'", status)
        self.assertIn('path = request.url.path', ui)
        self.assertIn('if path == "/fragments/system-status"', ui)
        self.assertIn('request.headers.get("HX-Current-URL")', ui)
        self.assertNotIn('request.headers.get("referer")', ui)
        self.assertIn(".service-status.active", shell_styles)

    def test_blueprint_has_no_tutorial_overlay(self) -> None:
        render = read("static/blueprint/editor-render.js")
        css = read("static/blueprint/blueprint.css")
        self.assertNotIn("blueprint-hint", render)
        self.assertNotIn(".blueprint-hint", css)

    def test_stream_quality_is_global_not_per_measurement_node(self) -> None:
        presentation = read("static/daq-config/presentation.js")
        validation = read("static/daq-config/validation.js")
        catalog = read("static/daq-config/catalog.js")
        self.assertNotIn("resolutionIndex", presentation)
        self.assertNotIn("settlingUs", presentation)
        self.assertNotIn("resolutionIndex", catalog)
        self.assertNotIn("settlingUs", catalog)
        self.assertIn("streamResolutionIndex", validation)
        self.assertIn("streamSettlingUs", validation)

    def test_configuration_is_edited_inside_nodes(self) -> None:
        template = read("templates/configuration.html")
        app = read("static/daq-config/app.js")
        node = read("static/blueprint/liquid-blueprint-node.js")
        controls = read("static/blueprint/node-controls-template.js")
        presentation = read("static/daq-config/presentation.js")
        specs = read("static/daq-config/node-specs.js")
        self.assertNotIn("daq-inspector", template)
        self.assertNotIn("renderInspector", app)
        self.assertIn("focusIssue(issue)", app)
        self.assertIn("editor.frameNode(issue.subject)", app)
        self.assertIn("Error · ${errors[0].message}", app)
        self.assertIn("extends LitElement", node)
        self.assertIn("data-blueprint-config-key", controls)
        self.assertIn("setLiteral(next, connected, 'shunt'", presentation)
        self.assertIn("setLiteral(node, connected, 'psiMin'", presentation)
        self.assertIn("'rate-of-change':", specs)
        self.assertIn("`${unit}/s`", specs)
        self.assertIn("node.nodeType === 'labjack-channel-pair'", presentation)

    def test_daq_toolbar_controls_do_not_leak_into_popover_buttons(self) -> None:
        css = read("static/daq-config/setup.css")
        self.assertIn(".daq-floating-tools > button,", css)
        self.assertIn(".daq-floating-tools > .daq-tool-menu > summary", css)
        self.assertNotIn(".daq-floating-tools button,", css)
        self.assertNotIn("width: 38px", css)
        self.assertNotIn("height: 38px", css)
        self.assertNotIn(".daq-node-popover { width:", css)
        self.assertNotIn(".daq-issues-popover { width:", css)
        self.assertIn(".daq-palette-item {\n  width: 100%;", css)
        self.assertNotIn(".daq-palette-item small", css)
        self.assertNotIn("#daq-palette.awaiting-placement", css)

    def test_simulation_and_common_math_nodes_are_available(self) -> None:
        catalog = read("static/daq-config/catalog.js")
        specs = read("static/daq-config/node-specs.js")
        editing = read("static/daq-config/node-editing.js")
        events = read("static/blueprint/editor-events.js")
        app = read("static/daq-config/app.js")
        live_preview = read("static/daq-config/live-preview.js")
        for node_type in ("sine-wave", "add", "gain", "moving-average"):
            self.assertIn(node_type, specs)
        self.assertIn("category: 'Simulation'", specs)
        self.assertIn("title: 'Sine wave'", specs)
        server_specs = read("daq_config/node_specs.py")
        self.assertIn("\"periodS\": 4", server_specs)
        self.assertIn("\"phaseRad\": 0", server_specs)
        self.assertIn("\"randomness\": 0", server_specs)
        self.assertIn("configureSpecDefaults", specs)
        self.assertIn("configureSpecDefaults(configuration.specDefaults)", app)
        self.assertNotIn("defaults: { amplitude", specs)
        self.assertIn("SPEC_NODE_CATALOG", catalog)
        self.assertNotIn("String(path).split('.')", editing)
        self.assertIn("input.dataset.valueType === 'boolean'", events)
        self.assertNotIn("node.nodeType === 'sine-wave'", catalog)
        self.assertNotIn("node.nodeType === 'sine-wave'", read("static/daq-config/presentation.js"))
        self.assertIn("hasSimulation", app)
        self.assertIn("isPreviewSourceNode", live_preview)
        self.assertIn("number:", specs)
        self.assertIn("gauge:", specs)
        self.assertIn("'time-plot':", specs)

    def test_blueprint_nodes_use_flat_engineering_chrome(self) -> None:
        css = read("static/blueprint/blueprint.css")
        self.assertNotIn("box-shadow", css)
        self.assertIn("background: #315c79;", css)
        self.assertNotIn("0 5px 16px", css)
        self.assertNotIn("preview-path .blueprint-node-header", css)

    def test_blueprint_toolbar_and_context_actions_are_dispatched(self) -> None:
        render = read("static/blueprint/editor-render.js")
        events = read("static/blueprint/editor-events.js")
        pointer = read("static/blueprint/editor-pointer.js")
        for action in ("undo", "redo", "fit", "zoom-in", "zoom-out"):
            self.assertIn(f'data-blueprint-action="{action}"', render)
            self.assertIn(f"action === '{action}'", events)
        for action in ("create", "paste", "cut", "copy", "duplicate", "break", "delete"):
            self.assertIn(f'data-menu-action="{action}"', render)
            self.assertIn(f"action === '{action}'", events)
        self.assertLess(
            pointer.index("event.target.closest('.blueprint-menu')"),
            pointer.index("this._closeMenus()"),
        )

    def test_blueprint_dom_uses_vendored_lit_without_destructive_node_renders(self) -> None:
        node = read("static/blueprint/liquid-blueprint-node.js")
        render = read("static/blueprint/editor-render.js")
        vendor = WEB / "static" / "vendor" / "lit" / "lit.js"
        license_file = WEB / "static" / "vendor" / "lit" / "LICENSE"
        self.assertTrue(vendor.exists())
        self.assertTrue(license_file.exists())
        self.assertIn("extends LitElement", node)
        self.assertIn("repeat(views", render)
        self.assertNotIn("replaceChildren", render)
        self.assertNotIn("_wireLayer.innerHTML", render)

    def test_vendored_lit_keeps_attribute_parser_whitespace(self) -> None:
        vendor = WEB / "static" / "vendor" / "lit" / "lit.js"
        self.assertEqual(
            sha256(vendor.read_bytes()).hexdigest(),
            "2d739f3737b4df8a4ae9bb97b57bc723c80f83b4e1e8d864ae33ef748436216d",
        )

    def test_blueprint_inline_controls_keep_units_and_select_state_clean(self) -> None:
        node_template = read("static/blueprint/node-template.js")
        controls = read("static/blueprint/node-controls-template.js")
        events = read("static/blueprint/editor-events.js")
        app = read("static/daq-config/app.js")
        channels = read("static/daq-config/channels.js")
        presentation = read("static/daq-config/presentation.js")
        self.assertIn("literalShowsSameUnit", node_template)
        self.assertIn(".selected=${String(value) === String(control.value ?? '')}", controls)
        self.assertIn('type="radio"', controls)
        self.assertIn("<span>${value ? 'True' : 'False'}</span>", controls)
        self.assertNotIn('type="checkbox"', controls)
        self.assertIn("input.value === 'true'", events)
        self.assertIn("blueprint-inline-draft-change", events)
        self.assertIn("this._inlineDraft", events)
        self.assertIn("flushInlineEdit()", events)
        self.assertIn("editor.hasPendingInlineEdit", app)
        self.assertNotIn("pendingInlineEdit", app)
        self.assertIn("editor.flushInlineEdit()", app)
        self.assertIn("editor.adoptGraph(result.graph)", app)
        metadata_controls = read("static/daq-config/metadata-controls.js")
        self.assertIn("new MetadataControls", app)
        self.assertIn("metadataControls?.flush()", app)
        self.assertIn("get hasPending()", metadata_controls)
        self.assertIn("this.editor.updateMetadata(patch)", metadata_controls)
        self.assertNotIn("scanRate.addEventListener('change'", app)
        live_preview = read("static/daq-config/live-preview.js")
        self.assertIn("blockingIssues(validateGraph(graph)).length", live_preview)
        self.assertIn("beforeunload", app)
        self.assertNotIn("T7 ${serial}", channels)
        self.assertIn("setPinLabel(next, 'channel', 'Reference')", presentation)
        self.assertIn("setPinLabel(next, 'pair', 'Reference')", presentation)

    def test_htmx_control_routes_exist(self) -> None:
        ui = read("ui_routes.py")
        for route in (
            '/ui/cart/state/{state}',
            '/ui/cart/initialize',
            '/ui/cart/reset',
            '/ui/labjack/connect',
            '/ui/labjack/disconnect',
            '/ui/labjack/stream/start',
            '/ui/labjack/stream/stop',
            '/ui/runs/{run_id}',
        ):
            self.assertIn(f'("{route}"', ui)

    def test_dashboard_telemetry_is_blueprint_driven(self) -> None:
        dashboard = read("templates/index.html")
        telemetry = read("static/dashboard-telemetry.js")
        registry = read("static/dashboard-widget-registry.js")
        number = read("static/dashboard-number.js")
        plot = read("static/dashboard-time-plot.js")
        gauge = read("static/dashboard-gauge.js")
        layout_editor = read("static/dashboard-layout-editor.js")
        layout_model = read("static/dashboard-layout-model.js")
        specs = read("static/daq-config/node-specs.js")
        controller = read("static/dashboard-time-controller.js")
        renderer = read("static/dashboard-time-renderer.js")
        axis = read("static/dashboard-plot-axis.js")
        axis_renderer = read("static/dashboard-axis-renderer.js")
        ticks = read("static/dashboard-axis-ticks.js")
        time_utils = read("static/dashboard-time-utils.js")
        self.assertIn('id="dashboard-widget-grid"', dashboard)
        self.assertIn('id="dashboard-widget-options"', dashboard)
        self.assertIn('id="telemetry-tier-navigator"', dashboard)
        self.assertIn('id="telemetry-return-tail"', dashboard)
        self.assertIn('id="dashboard-layout-edit"', dashboard)
        self.assertIn('id="dashboard-layout-save"', dashboard)
        self.assertIn('id="dashboard-layout-cancel"', dashboard)
        self.assertIn('src="/static/dashboard-telemetry.js"', dashboard)
        self.assertIn("DASHBOARD_NODE_TYPES.has(node.nodeType)", telemetry)
        self.assertIn("number:", registry)
        self.assertIn("gauge:", registry)
        self.assertIn("'time-plot':", registry)
        self.assertIn("previewConfiguration(graph)", telemetry)
        self.assertIn("DashboardTimeController", telemetry)
        self.assertIn("class DashboardTimeController", controller)
        self.assertIn("this.contextSeconds = 60", controller)
        self.assertIn("this.detailSeconds = 1", controller)
        self.assertIn("this.selectedRange", controller)
        self.assertIn("zoomToSelection", controller)
        self.assertIn("dataset.widgetValue", number)
        self.assertIn("dataset.signalChart", plot)
        self.assertIn("this.hoverTime", controller)
        self.assertIn("this.navigatorDrag", controller)
        self.assertIn("const range = [...(this.ranges[index]", controller)
        self.assertIn("state.navigatorHover?.time ?? state.hoverTime", renderer)
        self.assertIn("state.ranges.forEach((range, index) =>", renderer)
        self.assertIn("compactHistory(history)", telemetry)
        self.assertIn("sampleSegment += 1", telemetry)
        self.assertIn("segment: sampleSegment", telemetry)
        self.assertIn("if (document.hidden) return stopPolling()", telemetry)
        self.assertNotIn("history.splice(0, history.length - MAX_HISTORY_POINTS)", telemetry)
        self.assertNotIn("if (!selected.has(signal.id)) continue", telemetry)
        self.assertIn("export function summarizeSamples", time_utils)
        self.assertIn("export function compactHistory", time_utils)
        self.assertIn("currentBucket.segment !== segment", time_utils)
        self.assertIn("before.segment ?? 0", time_utils)
        self.assertIn("positiveMinimum", time_utils)
        self.assertIn("positiveMax", time_utils)
        self.assertIn("seconds >= 3600", time_utils)
        self.assertIn("bucket.segment !== previousSegment", renderer)
        self.assertIn("Drag any band to scrub the current graph view", dashboard)
        self.assertIn("renderPlot", renderer)
        self.assertIn("renderNavigator", renderer)
        self.assertNotIn("PLACEHOLDER_LABELS", telemetry)
        self.assertIn("new DashboardLayoutEditor", telemetry)
        self.assertIn("saveDashboardLayout(layout)", telemetry)
        dashboard_css = read("static/dashboard-telemetry.css")
        self.assertIn("grid-template-columns: repeat(12", dashboard_css)
        self.assertIn("isolation: isolate", dashboard_css)
        self.assertIn(".dashboard-widget[data-widget-type=\"time-plot\"] canvas { border-radius: var(--radius-ui); }", dashboard_css)
        self.assertIn("border-radius: var(--radius-ui);", dashboard_css)
        self.assertIn("this.viewLayout = cloneLayout(this.committed)", layout_editor)
        self.assertIn("bringToFront(this.viewLayout, widgetId)", layout_editor)
        self.assertIn("bringToFront(this.draft, widgetId)", layout_editor)
        self.assertIn("this.syncFrameStack(this.viewLayout)", layout_editor)
        self.assertIn("clampResize", layout_editor)
        self.assertIn("DASHBOARD_COLUMNS = 12", layout_model)
        self.assertIn("card.style.zIndex", layout_model)
        self.assertIn("bringToFront", layout_model)
        self.assertNotIn("collides(", layout_model)
        self.assertNotIn("dashboard-toolbar", dashboard)
        self.assertNotIn('telemetry-live-state', dashboard)
        self.assertNotIn("'Live'", telemetry)
        self.assertNotIn("AIN0", dashboard)
        self.assertNotIn("AIN2", dashboard)
        self.assertNotIn('fragments/cart.html', dashboard)
        self.assertNotIn('fragments/labjack.html', dashboard)
        self.assertNotIn('fragments/events.html', dashboard)
        for gauge_type in (
            "dial-filled", "dial-needle", "meter-horizontal", "meter-vertical", "meter-vertical-inverted",
        ):
            self.assertIn(gauge_type, specs)
        self.assertIn("const gauge = node.config", gauge)
        self.assertNotIn("DEFAULT_GAUGE", gauge)
        self.assertNotIn("normalizeGauge", gauge)
        self.assertIn("setDialThreshold", gauge)
        self.assertIn("gaugeState", gauge)
        self.assertIn("usesTimeline(widget)", telemetry)
        self.assertIn("navigatorWrap.hidden = layoutEditor.editing || timelinePlots.length === 0", telemetry)
        self.assertIn("timeControl.hidden = widgets.length === 0", telemetry)
        self.assertIn("plotTimeRange(plot, state, history)", renderer)
        self.assertIn("config.xRangeMode === 'fixed'", axis)
        self.assertIn("config.xRangeMode === 'auto'", axis)
        self.assertIn("config.xRangeMode !== 'window'", axis)
        self.assertIn("config.yAxisScale === 'log10'", axis)
        self.assertIn("config.yRangeMode === 'soft'", axis)
        self.assertIn("hoverTime < firstTime || hoverTime > lastTime", renderer)
        self.assertIn("fitText(context, axis.yTitle, frame.height)", axis_renderer)
        self.assertIn("buildLinearTicks", ticks)
        self.assertIn("buildLogTicks", ticks)
        self.assertIn("niceStep", ticks)
        self.assertIn("MAX_RENDERED_TICKS = 160", ticks)
        self.assertIn("nonOverlappingXLabels", axis_renderer)
        self.assertIn("nonOverlappingYLabels", axis_renderer)
        self.assertIn("drawPlotAxes", axis_renderer)
        self.assertIn("drawPlotGrid", axis_renderer)
        self.assertIn("aria-keyshortcuts", plot)
        self.assertIn("dataset.chartAccessible", plot)
        self.assertIn("Number", specs)
        self.assertIn("Gauge", specs)
        self.assertIn("Time plot", specs)
        self.assertNotIn("Group", specs)

    def test_dashboard_has_no_generic_display_node_or_compatibility_layer(self) -> None:
        paths = [
            "static/daq-config/node-specs.js",
            "static/dashboard-telemetry.js",
            "static/dashboard-widget-registry.js",
            "daq_config/node_specs.py",
            "daq_config/node_runtime.py",
            "daq_config/README.md",
        ]
        combined = "\n".join(read(path) for path in paths)
        self.assertNotIn("dashboard-signal", combined)
        self.assertNotIn("config.gauge", combined)
        self.assertNotIn("frequencyHz", combined)
        self.assertNotIn("phaseDeg", combined)
        self.assertFalse((WEB / "daq_config" / "migration.py").exists())

    def test_primary_pages_do_not_repeat_sidebar_route_titles(self) -> None:
        for template, duplicate in (
            ("templates/index.html", "Dashboard"),
            ("templates/state.html", "Fill Cart"),
            ("templates/runs.html", "Runs"),
            ("templates/logs.html", "Logs"),
            ("templates/settings.html", "Settings"),
            ("templates/device_p1am.html", "P1AM-100"),
            ("templates/device_labjack.html", "LabJack T7 Pro"),
        ):
            source = read(template)
            self.assertNotIn(f"<h1>{duplicate}</h1>", source)

    def test_state_page_keeps_device_diagnostics_out_of_control_surface(self) -> None:
        cart = read("templates/fragments/cart.html")
        self.assertNotIn("P1AM-100", cart)
        self.assertNotIn("Waiting for", cart)
        self.assertNotIn("Open device setup", cart)
        self.assertIn('aria-label="Current state"', cart)

    def test_runs_empty_state_does_not_reference_old_dashboard_recording(self) -> None:
        table = read("templates/fragments/run_table.html")
        self.assertIn("No runs recorded yet.", table)
        self.assertNotIn("Start acquisition from the dashboard", table)

    def test_state_machine_and_recording_have_dedicated_pages(self) -> None:
        base = read("templates/base.html")
        state = read("templates/state.html")
        runs = read("templates/runs.html")
        cart = read("templates/fragments/cart.html")
        ui = read("ui_routes.py")
        self.assertIn('href="/state"', base)
        self.assertIn('<span>State Machine</span>', base)
        self.assertIn('fragments/cart.html', state)
        self.assertIn('@router.get("/state"', ui)
        self.assertIn('fragments/labjack.html', runs)
        self.assertNotIn('Run summary', cart)

    def test_devices_and_logs_are_split_from_legacy_diagnostics(self) -> None:
        base = read("templates/base.html")
        status = read("templates/fragments/system_status.html")
        ui = read("ui_routes.py")
        self.assertIn('href="/devices/p1am"', status)
        self.assertIn('href="/devices/labjack"', status)
        self.assertIn('href="/logs"', base)
        self.assertIn('<span>Logs</span>', base)
        self.assertNotIn('>Diagnostics</a>', base)
        self.assertIn('@router.get("/devices/p1am"', ui)
        self.assertIn('@router.get("/devices/labjack"', ui)
        self.assertIn('@router.get("/logs"', ui)
        self.assertIn('RedirectResponse("/logs"', ui)

    def test_runs_use_saved_graph_and_generic_recorded_signals(self) -> None:
        fragment = read("templates/fragments/labjack.html")
        health = read("templates/fragments/labjack_health.html")
        connection = read("templates/fragments/labjack_connection.html")
        ui = read("ui_routes.py")
        run_detail = read("templates/run_detail.html")
        run_history = read("static/run-history.js")
        timeline = read("static/timeline.js")
        repository = read("run_repository.py")
        source = read("daq_config/labjack_source.py")
        self.assertNotIn('name="scan_rate"', fragment)
        self.assertIn('{{ configured_scan_rate }} samples/s', fragment)
        self.assertNotIn('LabJack offline', fragment)
        self.assertNotIn('{{ labjack.error }}', fragment)
        self.assertNotIn('{{ labjack.error', health)
        self.assertNotIn('{{ labjack.error', connection)
        self.assertIn('labjack.start_stream(configured_graph())', ui)
        self.assertIn('for signal in run.signals', run_detail)
        self.assertIn('data-run-signal-canvas', run_detail)
        self.assertIn('signals,', run_history)
        self.assertIn('row.values', timeline)
        self.assertNotIn('channel_a', repository)
        self.assertNotIn('channel_b', repository)
        self.assertIn('SignalDescriptor', repository)
        self.assertIn('def compile_stream_plan(graph: dict)', source)
        self.assertIn('plan = compile_stream_plan(graph)', read("labjack_service.py"))
        self.assertNotIn('AIN0_NEGATIVE_CH', read("labjack_service.py"))

    def test_run_history_timeline_controls_remain_connected(self) -> None:
        run_detail = read("templates/run_detail.html")
        run_history = read("static/run-history.js")
        timeline = read("static/timeline.js")
        self.assertIn('id="playback-toggle"', run_detail)
        self.assertIn('id="return-tail"', run_detail)
        self.assertIn('document.querySelector("#playback-toggle")', run_history)
        self.assertIn('document.querySelector("#return-tail")', run_history)
        self.assertIn('this.playButton.addEventListener("click"', timeline)
        self.assertIn('this.tailButton.addEventListener("click"', timeline)

    def test_action_button_macro_uses_htmx_and_request_locking(self) -> None:
        macro = read("templates/macros/actions.html")
        self.assertIn("hx-{{ method }}", macro)
        self.assertIn('hx-target="{{ target }}"', macro)
        self.assertIn('hx-disabled-elt="this"', macro)

    def test_daq_api_routes_exist(self) -> None:
        routes = read("daq_config/routes.py")
        app = read("static/daq-config/app.js")
        for route in ('/capabilities', '/configuration', '/dashboard-layout', '/preview'):
            self.assertIn(f'("{route}")', routes)
        self.assertIn("persist_configuration(repository, graph)", routes)
        self.assertIn("\"graph\": canonical", routes)
        self.assertIn("\"specDefaults\": spec_defaults()", routes)
        self.assertIn("\"editorContract\": EDITOR_CONTRACT_VERSION", routes)
        self.assertIn("DAQ editor/server versions do not match. Restart the base station.", app)
        self.assertIn("loadCapabilities().catch(() => null)", app)

    def test_development_demo_is_not_part_of_production_ui(self) -> None:
        self.assertNotIn("blueprint-demo", read("server.py"))
        self.assertFalse((WEB / "templates" / "blueprint_demo.html").exists())
        self.assertFalse((WEB / "static" / "blueprint-demo.js").exists())


if __name__ == "__main__":
    import unittest

    unittest.main()

"""Small, durable contracts for operator-facing UI surfaces.

Behavior belongs in Python/unit tests and browser QA. These checks only pin
intentional product structure that would be expensive to notice accidentally
missing in a code review.
"""

from pathlib import Path
from unittest import TestCase

from base_station.web.devices import DEVICE_DEFINITIONS
from base_station.web.navigation import NAVIGATION_PAGES, PRODUCT_NAME


ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "src" / "base_station" / "web"


def read(relative: str) -> str:
    return (WEB / relative).read_text(encoding="utf-8")


class FrontendContractTests(TestCase):
    def test_global_sidebar_exposes_current_application_routes(self) -> None:
        base = read("templates/base.html")
        shell = read("static/site-shell.js")
        self.assertEqual(PRODUCT_NAME, "Fill Cart")
        self.assertEqual(
            [(page.id, page.path, page.label) for page in NAVIGATION_PAGES],
            [
                ("dashboard", "/dashboard", "Live Dashboard"),
                ("dashboard-layout", "/dashboard/layout", "Dashboard Layout"),
                ("dashboard-views", "/dashboard/views", "Dashboard Views"),
                ("signals", "/signals", "Signal Graph"),
                ("state", "/state", "State Machine"),
                ("runs", "/runs", "Runs"),
                ("logs", "/logs", "Logs"),
                ("settings", "/settings", "Settings"),
            ],
        )
        self.assertEqual(
            {(device.route, device.label) for device in DEVICE_DEFINITIONS},
            {("/devices/p1am", "P1AM"), ("/devices/labjack", "LabJack")},
        )
        self.assertIn("for device in devices", base)
        self.assertIn("for page in navigation_pages", base)
        self.assertIn("{{ page.path }}", base)
        self.assertIn("{{ page.label }}", base)
        self.assertIn("{{ product_name }}", base)
        self.assertIn('<nav class="site-sidebar-nav"', base)
        self.assertIn('/static/sidebar-preferences.js', base)
        self.assertIn('root.dataset.sidebar', shell)
        self.assertNotIn("DAQ Setup", base)
        self.assertNotIn("history.back()", shell)
        self.assertNotIn("document.referrer", shell)

    def test_long_lived_browser_resources_share_page_lifecycle(self) -> None:
        lifecycle = read("static/page-resource-lifecycle.js")
        self.assertIn("pagehide", lifecycle)
        self.assertIn("pageshow", lifecycle)
        self.assertIn("visibilitychange", lifecycle)
        self.assertIn("onPageRestore", lifecycle)
        for relative in (
            "static/site-shell.js",
            "static/logs.js",
            "static/dashboard-live-stream.js",
            "static/daq-config/app.js",
        ):
            source = read(relative)
            self.assertIn("bindPageResource", source)
            self.assertNotIn("addEventListener('pagehide'", source)
            self.assertNotIn("addEventListener('pageshow'", source)

    def test_frontend_has_no_htmx_or_server_rendered_fragments(self) -> None:
        self.assertFalse((WEB / "static" / "vendor" / "htmx-2.0.10.min.js").exists())
        self.assertFalse((WEB / "templates" / "fragments").exists())
        base = read("templates/base.html")
        self.assertNotIn("htmx", base.lower())
        for path in (WEB / "templates").glob("*.html"):
            source = path.read_text(encoding="utf-8")
            self.assertNotIn("hx-", source, path.name)
            self.assertNotIn("fragments/", source, path.name)
        routes = read("ui_routes.py")
        self.assertNotIn("/fragments/", routes)
        self.assertNotIn("/ui/", routes)

    def test_native_command_surfaces_use_json_apis(self) -> None:
        self.assertIn("data-state-id", read("templates/state.html"))
        self.assertIn("data-p1am-action", read("templates/device_p1am.html"))
        self.assertIn("data-labjack-connect", read("templates/device_labjack.html"))
        self.assertIn("data-run-delete", read("templates/runs.html"))
        self.assertNotIn("data-run-rate", read("templates/runs.html"))
        self.assertNotIn("log-count", read("templates/logs.html"))
        self.assertIn("/api/cart/state", read("static/p1am-state.js"))
        self.assertIn("/api/cart/", read("static/p1am-device.js"))
        self.assertIn("/api/labjack/", read("static/labjack-connection.js"))
        self.assertIn("/api/runs", read("static/runs-recorder.js"))

    def test_signal_graph_toolbar_is_category_driven(self) -> None:
        template = read("templates/configuration.html")
        palette = read("static/daq-config/palette.js")
        for element_id in ("daq-node-tools", "daq-undo", "daq-redo", "daq-save"):
            self.assertIn(f'id="{element_id}"', template)
        for category in ("labjack", "sensors", "math", "outputs"):
            self.assertIn(f"id: '{category}'", palette)
        self.assertIn("icon: 'icon-math'", palette)
        self.assertNotIn('id="daq-reload"', template)
        self.assertNotIn('id="daq-frame"', template)
        self.assertIn('id="daq-save-feedback"', template)
        self.assertNotIn('id="daq-acquisition-tools"', template)
        self.assertNotIn('id="daq-scan-rate"', template)

    def test_labjack_page_owns_source_acquisition_settings(self) -> None:
        template = read("templates/device_labjack.html")
        for element_id in (
            "labjack-scan-rate",
            "labjack-resolution-index",
            "labjack-settling-us",
            "labjack-settings-save",
        ):
            self.assertIn(f'id="{element_id}"', template)
        self.assertIn('name="labjack-mux80"', template)
        self.assertIn('/static/labjack-settings.js', template)

    def test_blueprint_boolean_controls_are_explicit_true_false_radios(self) -> None:
        controls = read("static/blueprint/node-controls-template.js")
        self.assertIn('type="radio"', controls)
        self.assertIn("<span>${value ? 'True' : 'False'}</span>", controls)
        self.assertNotIn('type="checkbox"', controls)

    def test_vendored_lit_is_present_with_license(self) -> None:
        vendor = WEB / "static" / "vendor" / "lit" / "lit.js"
        license_file = WEB / "static" / "vendor" / "lit" / "LICENSE"
        self.assertTrue(vendor.exists())
        self.assertTrue(license_file.exists())
        self.assertIn("extends LitElement", read("static/blueprint/liquid-blueprint-node.js"))

    def test_dashboard_pages_split_read_only_layout_and_view_authoring(self) -> None:
        dashboard = read("templates/index.html")
        for element_id in ("dashboard-viewport", "dashboard-widget-grid", "telemetry-tier-navigator", "telemetry-return-tail"):
            self.assertIn(f'id="{element_id}"', dashboard)
        self.assertIn('src="/static/dashboard-presenter.js"', dashboard)
        self.assertNotIn('id="dashboard-zoom"', dashboard)
        self.assertNotIn('id="dashboard-layout-save"', dashboard)

        layout = read("templates/dashboard_layout.html")
        for element_id in ("dashboard-layout-viewport", "dashboard-layout-grid", "dashboard-widget-options", "dashboard-layout-save", "dashboard-layout-cancel", "dashboard-layout-zoom"):
            self.assertIn(f'id="{element_id}"', layout)
        self.assertNotIn("telemetry-tier-navigator", layout)
        self.assertIn('src="/static/dashboard-layout-page.js"', layout)
        self.assertIn('id="dashboard-layout-save" type="button"', layout)
        self.assertIn('title="Save dashboard layout" disabled', layout)
        self.assertIn("syncSaveState", read("static/dashboard-layout-page.js"))

        views = read("templates/dashboard_views.html")
        for element_id in ("dashboard-views-viewport", "dashboard-views-grid", "dashboard-view-layer", "dashboard-views-save", "dashboard-views-cancel", "dashboard-views-zoom"):
            self.assertIn(f'id="{element_id}"', views)
        self.assertIn('data-dashboard-view-slot-button="{{ slot }}"', views)
        self.assertNotIn("telemetry-tier-navigator", views)
        self.assertIn('src="/static/dashboard-views-page.js"', views)
        self.assertIn('title="Save dashboard views" disabled', views)
        self.assertIn("syncSaveState", read("static/dashboard-views-page.js"))
        self.assertIn("DASHBOARD_VIEW_SNAP = 0.25", read("static/dashboard-layout-model.js"))

    def test_engineering_canvases_share_select_and_hand_tools(self) -> None:
        toolset = read("static/engineering-canvas-toolset.js")
        self.assertIn("v: 'select'", toolset)
        self.assertIn("h: 'hand'", toolset)
        for relative in (
            "templates/configuration.html",
            "templates/dashboard_layout.html",
            "templates/dashboard_views.html",
        ):
            template = read(relative)
            self.assertIn('data-canvas-tool="select"', template)
            self.assertIn('data-canvas-tool="hand"', template)
            self.assertIn('aria-keyshortcuts="V"', template)
            self.assertIn('aria-keyshortcuts="H"', template)
        self.assertIn("this._interactionTool === 'hand'", read("static/blueprint/editor-pointer.js"))
        layout_selection = read("static/dashboard-layout-selection.js")
        self.assertIn("beginMarquee", layout_selection)
        self.assertIn("this.selected", layout_selection)
        views = read("static/dashboard-view-region-editor.js")
        self.assertIn("this.getTool() !== 'select'", views)
        self.assertIn("this.currentSlot", views)
        self.assertIn("this.selected = new Set", views)
        self.assertIn("beginMarquee", views)
        self.assertIn("drag.origins", views)
        self.assertIn("!viewFor(this.getLayout(), this.currentSlot)", views)
        self.assertIn("authoringBounds", read("static/dashboard-views-page.js"))

        authoring = read("static/dashboard-authoring-canvas.js")
        self.assertIn("addEventListener('contextmenu'", authoring)
        self.assertIn("event.preventDefault()", authoring)

    def test_device_pages_share_section_and_control_treatment(self) -> None:
        labjack = read("templates/device_labjack.html")
        p1am = read("templates/device_p1am.html")
        devices = read("static/devices.css")
        for template in (labjack, p1am):
            self.assertIn('<h2>Status</h2>', template)
            self.assertNotIn('<strong>Status</strong>', template)
            self.assertIn('class="device-section"', template)
        self.assertIn('<h2>Controls</h2>', p1am)
        self.assertNotIn("connection-settings", devices)
        self.assertNotIn("source-settings", devices)
        self.assertNotIn("border-top:", devices)
        self.assertNotIn("var(--muted)", devices)

    def test_dashboard_widget_registry_has_explicit_widget_types(self) -> None:
        registry = read("static/dashboard-widget-registry.js")
        for widget_type in ("number", "gauge", "time-plot"):
            self.assertIn(widget_type, registry)
        gauge = read("static/dashboard-gauge.js")
        self.assertIn("dashboard-gauge-dial-readout", gauge)
        self.assertIn("data-gauge-min", gauge)
        self.assertIn("data-gauge-max", gauge)
        self.assertIn("svg.append(base, low, high, fill, needle, hub, readout, minimum, state, maximum)", gauge)
        plot = read("static/dashboard-time-plot.js")
        self.assertIn("aria-keyshortcuts", plot)
        self.assertNotIn("dashboard-chart-accessible", plot)
        self.assertNotIn("aria-describedby", plot)

    def test_run_detail_is_generated_from_recorded_signal_metadata(self) -> None:
        detail = read("templates/run_detail.html")
        self.assertIn("for signal in run.signals", detail)
        self.assertIn("data-run-signal-canvas", detail)

    def test_theme_supports_system_light_and_dark_with_black_dark_canvas(self) -> None:
        settings = read("templates/settings.html")
        tokens = read("static/design-tokens.css")
        for option in ("system", "dark", "light"):
            self.assertIn(f'data-theme-option="{option}"', settings)
        self.assertIn(':root[data-theme="dark"]', tokens)
        self.assertIn('--color-canvas: #000000;', tokens)


if __name__ == "__main__":
    import unittest

    unittest.main()

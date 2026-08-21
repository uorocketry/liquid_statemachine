"""Small, durable contracts for operator-facing UI surfaces.

Behavior belongs in Python/unit tests and browser QA. These checks only pin
intentional product structure that would be expensive to notice accidentally
missing in a code review.
"""

from pathlib import Path
from unittest import TestCase

from base_station.web.devices import DEVICE_DEFINITIONS


ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "src" / "base_station" / "web"


def read(relative: str) -> str:
    return (WEB / relative).read_text(encoding="utf-8")


class FrontendContractTests(TestCase):
    def test_global_sidebar_exposes_current_application_routes(self) -> None:
        base = read("templates/base.html")
        for href, label in (
            ('href="/"', "Dashboard"),
            ('href="/state"', "State Machine"),
            ('href="/configuration"', "DAQ Graph"),
            ('href="/runs"', "Runs"),
            ('href="/logs"', "Logs"),
            ('href="/settings"', "Settings"),
        ):
            self.assertIn(href, base)
            self.assertIn(label, base)
        self.assertEqual(
            {(device.route, device.label) for device in DEVICE_DEFINITIONS},
            {("/devices/p1am", "P1AM"), ("/devices/labjack", "LabJack")},
        )
        self.assertIn("for device in devices", base)
        self.assertIn('<nav class="site-sidebar-nav"', base)
        self.assertNotIn("DAQ Setup", base)

    def test_daq_graph_toolbar_is_category_driven(self) -> None:
        template = read("templates/configuration.html")
        palette = read("static/daq-config/palette.js")
        for element_id in ("daq-node-tools", "daq-undo", "daq-redo", "daq-frame", "daq-save"):
            self.assertIn(f'id="{element_id}"', template)
        for category in ("labjack", "sensors", "math", "outputs"):
            self.assertIn(f"id: '{category}'", palette)
        self.assertIn("icon: 'icon-math'", palette)
        self.assertNotIn('id="daq-reload"', template)
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

    def test_dashboard_exposes_layout_and_time_navigation_controls(self) -> None:
        dashboard = read("templates/index.html")
        for element_id in (
            "dashboard-widget-grid",
            "dashboard-widget-options",
            "dashboard-layout-edit",
            "dashboard-layout-save",
            "dashboard-layout-cancel",
            "telemetry-tier-navigator",
            "telemetry-return-tail",
        ):
            self.assertIn(f'id="{element_id}"', dashboard)
        self.assertIn('src="/static/dashboard-telemetry.js"', dashboard)

    def test_dashboard_widget_registry_has_explicit_widget_types(self) -> None:
        registry = read("static/dashboard-widget-registry.js")
        for widget_type in ("number", "gauge", "time-plot"):
            self.assertIn(widget_type, registry)
        plot = read("static/dashboard-time-plot.js")
        self.assertIn("aria-keyshortcuts", plot)
        self.assertIn("dataset.chartAccessible", plot)

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

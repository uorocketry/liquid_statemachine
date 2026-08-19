"""Static contract checks for operator-facing controls and production routes."""

from pathlib import Path
from unittest import TestCase


ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "src" / "base_station" / "web"


def read(relative: str) -> str:
    return (WEB / relative).read_text(encoding="utf-8")


class FrontendContractTests(TestCase):
    def test_configuration_commands_have_handlers(self) -> None:
        template = read("templates/configuration.html")
        app = read("static/daq-config/app.js")
        for element_id in ("daq-save", "daq-reload", "daq-scan-rate"):
            self.assertIn(f'id="{element_id}"', template)
            self.assertIn(f"#{element_id}", app)
        self.assertIn("saveButton.addEventListener('click', save)", app)
        self.assertIn("reloadButton.addEventListener('click', reload)", app)
        self.assertIn("if (capabilities?.device?.connected) preview.start()", app)
        for removed in (
            "daq-live-toggle", "daq-preview-state", "daq-device-state",
            "daq-mux80", "daq-acquisition-menu", 'graph-title="Liquid DAQ"',
        ):
            self.assertNotIn(removed, template)

    def test_configuration_is_edited_inside_nodes(self) -> None:
        template = read("templates/configuration.html")
        app = read("static/daq-config/app.js")
        node = read("static/blueprint/liquid-blueprint-node.js")
        controls = read("static/blueprint/node-controls-template.js")
        presentation = read("static/daq-config/presentation.js")
        self.assertNotIn("daq-inspector", template)
        self.assertNotIn("renderInspector", app)
        self.assertIn("focusIssue(issue)", app)
        self.assertIn("editor.frameNode(issue.subject)", app)
        self.assertIn("Error · ${errors[0].message}", app)
        self.assertIn("extends LitElement", node)
        self.assertIn("data-blueprint-config-key", controls)
        self.assertIn("setLiteral(next, connected, 'shunt'", presentation)
        self.assertIn("setLiteral(node, connected, 'psiMin'", presentation)
        self.assertIn("node.nodeType === 'rate-of-change'", presentation)
        self.assertIn("`${input}/s`", presentation)
        self.assertIn("node.nodeType === 'labjack-channel-pair'", presentation)

    def test_blueprint_nodes_use_flat_engineering_chrome(self) -> None:
        css = read("static/blueprint/blueprint.css")
        self.assertIn("box-shadow: none;", css)
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

    def test_blueprint_inline_controls_keep_units_and_select_state_clean(self) -> None:
        node_template = read("static/blueprint/node-template.js")
        controls = read("static/blueprint/node-controls-template.js")
        channels = read("static/daq-config/channels.js")
        presentation = read("static/daq-config/presentation.js")
        self.assertIn("literalShowsSameUnit", node_template)
        self.assertIn(".selected=${String(value) === String(control.value ?? '')}", controls)
        self.assertNotIn("T7 ${serial}", channels)
        self.assertIn("setPinLabel(next, 'channel', 'Reference')", presentation)
        self.assertIn("setPinLabel(next, 'pair', 'Reference')", presentation)

    def test_htmx_control_routes_exist(self) -> None:
        server = read("server.py")
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
            self.assertIn(f'("{route}"', server)

    def test_dashboard_telemetry_is_blueprint_driven(self) -> None:
        dashboard = read("templates/index.html")
        telemetry = read("static/dashboard-telemetry.js")
        self.assertIn('id="telemetry-signal-grid"', dashboard)
        self.assertIn('id="telemetry-signal-options"', dashboard)
        self.assertIn('src="/static/dashboard-telemetry.js"', dashboard)
        self.assertIn("node.nodeType === 'dashboard-signal'", telemetry)
        self.assertIn("previewConfiguration(graph)", telemetry)
        self.assertNotIn("AIN0", dashboard)
        self.assertNotIn("AIN2", dashboard)
        self.assertNotIn('fragments/cart.html', dashboard)
        self.assertNotIn('fragments/labjack.html', dashboard)

    def test_state_machine_and_recording_have_dedicated_pages(self) -> None:
        base = read("templates/base.html")
        state = read("templates/state.html")
        runs = read("templates/runs.html")
        cart = read("templates/fragments/cart.html")
        server = read("server.py")
        self.assertIn('href="/state">State Machine</a>', base)
        self.assertIn('fragments/cart.html', state)
        self.assertIn('@app.get("/state"', server)
        self.assertIn('fragments/labjack.html', runs)
        self.assertNotIn('Run summary', cart)

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
        for route in ('/capabilities', '/configuration', '/preview'):
            self.assertIn(f'("{route}")', routes)

    def test_development_demo_is_not_part_of_production_ui(self) -> None:
        self.assertNotIn("blueprint-demo", read("server.py"))
        self.assertFalse((WEB / "templates" / "blueprint_demo.html").exists())
        self.assertFalse((WEB / "static" / "blueprint-demo.js").exists())


if __name__ == "__main__":
    import unittest

    unittest.main()

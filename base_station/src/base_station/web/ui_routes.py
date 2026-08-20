"""Operator pages, fragments, and HTMX actions."""

from __future__ import annotations

from datetime import datetime
from urllib.parse import parse_qs, urlparse

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse, Response, StreamingResponse
from fastapi.templating import Jinja2Templates

from base_station.web.cart_service import CartService, STATE_NAMES
from base_station.web.daq_config.repository import DaqConfigRepository
from base_station.web.daq_config.schema import normalize_graph
from base_station.web.labjack_service import LabJackService
from base_station.web.models import DashboardState
from base_station.web.run_repository import RunRepository


def format_duration(seconds: float) -> str:
    minutes, remaining = divmod(max(0, seconds), 60)
    hours, minutes = divmod(int(minutes), 60)
    if hours:
        return f"{hours:02d}:{minutes:02d}:{remaining:04.1f}"
    return f"{minutes:02d}:{remaining:04.1f}"


async def form_values(request: Request) -> dict[str, str]:
    values = parse_qs((await request.body()).decode("utf-8"), keep_blank_values=True)
    return {key: entries[-1] for key, entries in values.items()}


def build_ui_router(
    templates: Jinja2Templates,
    dashboard: DashboardState,
    cart: CartService,
    labjack: LabJackService,
    runs: RunRepository,
    daq_config: DaqConfigRepository,
) -> APIRouter:
    router = APIRouter()

    def context(request: Request) -> dict:
        path = request.url.path
        if path == "/fragments/system-status":
            current_url = request.headers.get("HX-Current-URL")
            if current_url:
                path = urlparse(current_url).path
        active_device = path.removeprefix("/devices/") if path.startswith("/devices/") else None
        return {
            "request": request,
            **dashboard.snapshot(),
            "state_names": STATE_NAMES,
            "format_duration": format_duration,
            "active_device": active_device,
        }

    def configured_scan_rate() -> int:
        graph = normalize_graph(daq_config.load())
        return int(graph.get("metadata", {}).get("scanRate", 1000))

    def labjack_context(request: Request) -> dict:
        values = context(request)
        values["configured_scan_rate"] = configured_scan_rate()
        return values

    def cart_fragment(request: Request):
        return templates.TemplateResponse(request, "fragments/cart.html", context(request))

    def p1am_health_fragment(request: Request):
        return templates.TemplateResponse(request, "fragments/p1am_health.html", context(request))

    def labjack_fragment(request: Request):
        return templates.TemplateResponse(request, "fragments/labjack.html", labjack_context(request))

    def labjack_connection_fragment(request: Request):
        return templates.TemplateResponse(request, "fragments/labjack_connection.html", context(request))

    @router.get("/", include_in_schema=False)
    def index(request: Request):
        return templates.TemplateResponse(request, "index.html", context(request))

    @router.get("/state", include_in_schema=False)
    def state_machine(request: Request):
        return templates.TemplateResponse(request, "state.html", context(request))

    @router.get("/devices/p1am", include_in_schema=False)
    def p1am_device(request: Request):
        return templates.TemplateResponse(request, "device_p1am.html", context(request))

    @router.get("/devices/labjack", include_in_schema=False)
    def labjack_device(request: Request):
        return templates.TemplateResponse(request, "device_labjack.html", context(request))

    @router.get("/logs", include_in_schema=False)
    def log_list(request: Request):
        values = context(request)
        values["logs"] = dashboard.log_snapshot(limit=500)
        return templates.TemplateResponse(request, "logs.html", values)

    @router.get("/settings", include_in_schema=False)
    def settings(request: Request):
        return templates.TemplateResponse(request, "settings.html", context(request))

    @router.get("/diagnostics", include_in_schema=False)
    def legacy_diagnostics():
        return RedirectResponse("/logs", status_code=307)

    @router.get("/configuration", include_in_schema=False)
    def configuration(request: Request):
        return templates.TemplateResponse(request, "configuration.html", context(request))

    @router.get("/runs", include_in_schema=False)
    def run_list(request: Request):
        values = labjack_context(request)
        values["runs"] = runs.list_runs()
        return templates.TemplateResponse(request, "runs.html", values)

    @router.get("/runs/backup/database", include_in_schema=False)
    def backup_database():
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        headers = {"Content-Disposition": f'attachment; filename="acquisition-backup-{stamp}.sqlite3"'}
        return Response(runs.backup_bytes(), media_type="application/vnd.sqlite3", headers=headers)

    @router.get("/runs/{run_id}", include_in_schema=False)
    def run_detail(request: Request, run_id: int):
        run_record = runs.get_run(run_id)
        if not run_record:
            raise HTTPException(status_code=404, detail="Run not found")
        values = context(request)
        values["run"] = run_record
        return templates.TemplateResponse(request, "run_detail.html", values)

    @router.get("/runs/{run_id}/export.csv", include_in_schema=False)
    def export_run(run_id: int):
        if not runs.get_run(run_id):
            raise HTTPException(status_code=404, detail="Run not found")
        headers = {"Content-Disposition": f'attachment; filename="acquisition-run-{run_id}.csv"'}
        return StreamingResponse(runs.csv_rows(run_id), media_type="text/csv", headers=headers)

    @router.get("/fragments/cart", include_in_schema=False)
    def get_cart_fragment(request: Request):
        return cart_fragment(request)

    @router.get("/fragments/system-status", include_in_schema=False)
    def system_status_fragment(request: Request):
        return templates.TemplateResponse(request, "fragments/system_status.html", context(request))

    @router.get("/fragments/labjack", include_in_schema=False)
    def get_labjack_fragment(request: Request):
        return labjack_fragment(request)

    @router.get("/fragments/p1am-health", include_in_schema=False)
    def get_p1am_health_fragment(request: Request):
        return p1am_health_fragment(request)

    @router.get("/fragments/labjack-health", include_in_schema=False)
    def labjack_health_fragment(request: Request):
        return templates.TemplateResponse(request, "fragments/labjack_health.html", context(request))

    @router.get("/fragments/labjack-connection", include_in_schema=False)
    def get_labjack_connection_fragment(request: Request):
        return labjack_connection_fragment(request)

    @router.get("/fragments/logs", include_in_schema=False)
    def logs_fragment(request: Request, level: str | None = None, component: str | None = None):
        values = context(request)
        values.update(
            filtered_logs=dashboard.log_snapshot(level, component, 500),
            selected_level=level or "",
            selected_component=component or "",
        )
        return templates.TemplateResponse(request, "fragments/logs.html", values)

    @router.put("/ui/cart/state/{state}", include_in_schema=False)
    def request_cart_state(request: Request, state: int):
        try:
            cart.set_state(state)
        except (OSError, ConnectionError, ValueError) as error:
            with dashboard.lock:
                dashboard.cart.transition_message = f"Request rejected: {error}"
            dashboard.log(f"Transition request failed: {error}", "error", "p1am")
        return cart_fragment(request)

    @router.post("/ui/cart/initialize", include_in_schema=False)
    def initialize_cart_ui(request: Request):
        try:
            cart.initialize()
        except (OSError, ConnectionError, ValueError):
            pass
        return p1am_health_fragment(request)

    @router.post("/ui/cart/reset", include_in_schema=False)
    def reset_cart_ui(request: Request):
        try:
            cart.reset()
        except (OSError, ConnectionError, ValueError) as error:
            with dashboard.lock:
                dashboard.cart.reset_message = f"Restart request failed: {error}"
            dashboard.log(f"P1AM restart failed: {error}", "error", "p1am")
        return p1am_health_fragment(request)

    @router.post("/ui/labjack/connect", include_in_schema=False)
    async def connect_labjack_ui(request: Request):
        form = await form_values(request)
        try:
            labjack.connect(form.get("ip", ""))
        except RuntimeError as error:
            dashboard.log(f"LabJack connection failed: {error}", "error", "labjack")
        return labjack_connection_fragment(request)

    @router.post("/ui/labjack/disconnect", include_in_schema=False)
    def disconnect_labjack_ui(request: Request):
        labjack.disconnect()
        return labjack_connection_fragment(request)

    @router.post("/ui/labjack/stream/start", include_in_schema=False)
    def start_stream_ui(request: Request):
        try:
            labjack.start_stream(configured_scan_rate())
        except (RuntimeError, ValueError) as error:
            dashboard.log(f"LabJack stream failed: {error}", "error", "labjack")
        return labjack_fragment(request)

    @router.post("/ui/labjack/stream/stop", include_in_schema=False)
    def stop_stream_ui(request: Request):
        try:
            labjack.stop_stream()
        except RuntimeError as error:
            dashboard.log(f"LabJack stop pending: {error}", "warning", "labjack")
        return labjack_fragment(request)

    @router.delete("/ui/runs/{run_id}", include_in_schema=False)
    def delete_run(request: Request, run_id: int):
        with dashboard.lock:
            active = dashboard.labjack.acquisition_state in {"starting", "running", "stopping"}
            current_run_id = dashboard.labjack.current_run_id
        if active and current_run_id == run_id:
            raise HTTPException(status_code=409, detail="Stop the active run before deleting it")
        runs.delete_run(run_id)
        values = context(request)
        values["runs"] = runs.list_runs()
        return templates.TemplateResponse(request, "fragments/run_table.html", values)

    return router

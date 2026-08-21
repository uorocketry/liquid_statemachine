"""Operator pages and file downloads."""

from __future__ import annotations

from datetime import datetime
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse, Response, StreamingResponse
from fastapi.templating import Jinja2Templates

from base_station.web.daq_config.repository import DaqConfigRepository
from base_station.web.devices import DEVICE_DEFINITIONS, LOG_COMPONENTS
from base_station.web.models import DashboardState
from base_station.web.navigation import (
    NAVIGATION_PAGES,
    PRODUCT_NAME,
    page_for_path,
    page_path,
)
from base_station.web.p1am import STATE_DEFINITIONS, STATE_NAMES
from base_station.web.run_repository import RunRepository


def format_duration(seconds: float) -> str:
    minutes, remaining = divmod(max(0, seconds), 60)
    hours, minutes = divmod(int(minutes), 60)
    if hours:
        return f"{hours:02d}:{minutes:02d}:{remaining:04.1f}"
    return f"{minutes:02d}:{remaining:04.1f}"


def build_ui_router(
    templates: Jinja2Templates,
    dashboard: DashboardState,
    runs: RunRepository,
    daq_config: DaqConfigRepository,
) -> APIRouter:
    router = APIRouter()

    def context(request: Request) -> dict:
        path = request.url.path
        page = page_for_path(path)
        active_device = path.removeprefix("/devices/") if path.startswith("/devices/") else None
        return {
            "request": request,
            **dashboard.snapshot(),
            "state_names": STATE_NAMES,
            "state_definitions": STATE_DEFINITIONS,
            "format_duration": format_duration,
            "active_page": page.id if page else None,
            "active_device": active_device,
            "devices": DEVICE_DEFINITIONS,
            "device_navigation": dashboard.navigation_status(),
            "log_components": LOG_COMPONENTS,
            "navigation_pages": tuple(item for item in NAVIGATION_PAGES if item.section == "main"),
            "settings_page": next(item for item in NAVIGATION_PAGES if item.section == "footer"),
            "page_title": page.title if page else PRODUCT_NAME,
            "product_name": PRODUCT_NAME,
            "config_version": daq_config.version,
        }

    def configured_labjack_settings() -> dict:
        return daq_config.load()["sources"]["labjack"]

    def labjack_context(request: Request) -> dict:
        values = context(request)
        values["labjack_settings"] = configured_labjack_settings()
        return values

    @router.get("/", include_in_schema=False)
    def legacy_index():
        return RedirectResponse(page_path("dashboard"), status_code=307)

    @router.get(page_path("dashboard"), include_in_schema=False)
    def dashboard_page(request: Request):
        return templates.TemplateResponse(request, "index.html", context(request))

    @router.get(page_path("dashboard-layout"), include_in_schema=False)
    def dashboard_layout(request: Request):
        return templates.TemplateResponse(request, "dashboard_layout.html", context(request))

    @router.get(page_path("dashboard-views"), include_in_schema=False)
    def dashboard_views(request: Request):
        return templates.TemplateResponse(request, "dashboard_views.html", context(request))

    @router.get(page_path("state"), include_in_schema=False)
    def state_machine(request: Request):
        values = context(request)
        values["status_device"] = "p1am"
        return templates.TemplateResponse(request, "state.html", values)

    @router.get("/devices/p1am", include_in_schema=False)
    def p1am_device(request: Request):
        return templates.TemplateResponse(request, "device_p1am.html", context(request))

    @router.get("/devices/labjack", include_in_schema=False)
    def labjack_device(request: Request):
        return templates.TemplateResponse(request, "device_labjack.html", labjack_context(request))

    @router.get(page_path("logs"), include_in_schema=False)
    def log_list(request: Request):
        values = context(request)
        values["logs"] = dashboard.log_snapshot(limit=500)
        return templates.TemplateResponse(request, "logs.html", values)

    @router.get(page_path("settings"), include_in_schema=False)
    def settings(request: Request):
        return templates.TemplateResponse(request, "settings.html", context(request))

    @router.get("/diagnostics", include_in_schema=False)
    def legacy_diagnostics():
        return RedirectResponse("/logs", status_code=307)

    @router.get("/configuration", include_in_schema=False)
    def legacy_configuration():
        return RedirectResponse(page_path("signals"), status_code=307)

    @router.get(page_path("signals"), include_in_schema=False)
    def signal_graph(request: Request):
        return templates.TemplateResponse(request, "configuration.html", context(request))

    @router.get(page_path("runs"), include_in_schema=False)
    def run_list(request: Request):
        values = context(request)
        values["runs"] = runs.list_runs()
        values["status_device"] = "labjack"
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
        if run_record["status"] == "recording":
            values["status_device"] = "labjack"
        return templates.TemplateResponse(request, "run_detail.html", values)

    @router.get("/runs/{run_id}/export.csv", include_in_schema=False)
    def export_run(run_id: int):
        if not runs.get_run(run_id):
            raise HTTPException(status_code=404, detail="Run not found")
        headers = {"Content-Disposition": f'attachment; filename="acquisition-run-{run_id}.csv"'}
        return StreamingResponse(runs.csv_rows(run_id), media_type="text/csv", headers=headers)

    return router

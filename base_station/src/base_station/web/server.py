"""FastAPI application and local dashboard launcher."""

from __future__ import annotations

import webbrowser
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from threading import Timer
from urllib.parse import parse_qs

import uvicorn
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field

from base_station.web.cart_service import CartService, STATE_NAMES
from base_station.web.daq_config import build_daq_router
from base_station.web.labjack_service import LabJackService
from base_station.web.models import DashboardState
from base_station.web.run_repository import RunRepository

STATIC_DIR = Path(__file__).with_name("static")
TEMPLATE_DIR = Path(__file__).with_name("templates")
DATA_DIR = Path(__file__).resolve().parents[3] / "data"
templates = Jinja2Templates(directory=TEMPLATE_DIR)
dashboard = DashboardState()
cart = CartService(dashboard)
runs = RunRepository(DATA_DIR / "acquisition.sqlite3")
labjack = LabJackService(dashboard, runs)


class ConnectionRequest(BaseModel):
    ip: str = Field(min_length=7, max_length=45)


class StreamRequest(BaseModel):
    scan_rate: int = Field(ge=1, le=100_000)


class StateRequest(BaseModel):
    state: int = Field(ge=0, le=7)


@asynccontextmanager
async def lifespan(_: FastAPI):
    cart.start()
    try:
        labjack.connect(dashboard.labjack.ip)
    except RuntimeError as error:
        dashboard.log(
            f"LabJack auto-connect failed: {error}", "warning", "labjack"
        )
    yield
    cart.stop()
    labjack.disconnect()


app = FastAPI(title="Liquid State Machine", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.include_router(build_daq_router(dashboard, labjack, DATA_DIR / "daq-blueprint.json"))


def template_context(request: Request) -> dict:
    return {
        "request": request,
        **dashboard.snapshot(),
        "state_names": STATE_NAMES,
        "format_duration": format_duration,
    }


def format_duration(seconds: float) -> str:
    minutes, remaining = divmod(max(0, seconds), 60)
    hours, minutes = divmod(int(minutes), 60)
    if hours:
        return f"{hours:02d}:{minutes:02d}:{remaining:04.1f}"
    return f"{minutes:02d}:{remaining:04.1f}"


async def form_values(request: Request) -> dict[str, str]:
    values = parse_qs((await request.body()).decode("utf-8"), keep_blank_values=True)
    return {key: entries[-1] for key, entries in values.items()}


@app.get("/", include_in_schema=False)
def index(request: Request):
    return templates.TemplateResponse(request, "index.html", template_context(request))


@app.get("/state", include_in_schema=False)
def state_machine(request: Request):
    return templates.TemplateResponse(request, "state.html", template_context(request))


@app.get("/diagnostics", include_in_schema=False)
def diagnostics(request: Request):
    return templates.TemplateResponse(request, "diagnostics.html", template_context(request))


@app.get("/configuration", include_in_schema=False)
def configuration(request: Request):
    """Operator-facing LabJack and signal graph configuration surface."""
    return templates.TemplateResponse(
        request, "configuration.html", template_context(request)
    )


@app.get("/runs", include_in_schema=False)
def run_list(request: Request):
    context = template_context(request)
    context["runs"] = runs.list_runs()
    return templates.TemplateResponse(request, "runs.html", context)


@app.get("/runs/backup/database", include_in_schema=False)
def backup_database():
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    headers = {"Content-Disposition": f'attachment; filename="acquisition-backup-{stamp}.sqlite3"'}
    return Response(runs.backup_bytes(), media_type="application/vnd.sqlite3", headers=headers)


@app.get("/runs/{run_id}", include_in_schema=False)
def run_detail(request: Request, run_id: int):
    run_record = runs.get_run(run_id)
    if not run_record:
        raise HTTPException(status_code=404, detail="Run not found")
    context = template_context(request)
    context["run"] = run_record
    return templates.TemplateResponse(request, "run_detail.html", context)


@app.get("/fragments/cart", include_in_schema=False)
def cart_fragment(request: Request):
    return templates.TemplateResponse(request, "fragments/cart.html", template_context(request))


@app.get("/fragments/system-status", include_in_schema=False)
def system_status_fragment(request: Request):
    return templates.TemplateResponse(
        request, "fragments/system_status.html", template_context(request)
    )


@app.get("/fragments/labjack", include_in_schema=False)
def labjack_fragment(request: Request):
    return templates.TemplateResponse(request, "fragments/labjack.html", template_context(request))


@app.get("/fragments/events", include_in_schema=False)
def events_fragment(request: Request):
    return templates.TemplateResponse(request, "fragments/events.html", template_context(request))


@app.get("/fragments/diagnostic-health", include_in_schema=False)
def diagnostic_health_fragment(request: Request):
    return templates.TemplateResponse(
        request, "fragments/diagnostic_health.html", template_context(request)
    )


@app.get("/fragments/labjack-connection", include_in_schema=False)
def labjack_connection_fragment(request: Request):
    return templates.TemplateResponse(
        request, "fragments/labjack_connection.html", template_context(request)
    )


@app.get("/fragments/logs", include_in_schema=False)
def logs_fragment(
    request: Request,
    level: str | None = None,
    component: str | None = None,
):
    context = template_context(request)
    context.update(
        filtered_logs=dashboard.log_snapshot(level, component, 500),
        selected_level=level or "",
        selected_component=component or "",
    )
    return templates.TemplateResponse(request, "fragments/logs.html", context)


@app.put("/ui/cart/state/{state}", include_in_schema=False)
def request_cart_state(request: Request, state: int):
    try:
        cart.set_state(state)
    except (OSError, ConnectionError, ValueError) as error:
        with dashboard.lock:
            dashboard.cart.transition_message = f"Request rejected: {error}"
        dashboard.log(f"Transition request failed: {error}", "error", "p1am")
    return cart_fragment(request)


@app.post("/ui/cart/initialize", include_in_schema=False)
def initialize_cart_ui(request: Request):
    try:
        cart.initialize()
    except (OSError, ConnectionError, ValueError):
        pass
    return diagnostic_health_fragment(request)


@app.post("/ui/cart/reset", include_in_schema=False)
def reset_cart_ui(request: Request):
    try:
        cart.reset()
    except (OSError, ConnectionError, ValueError) as error:
        with dashboard.lock:
            dashboard.cart.reset_message = f"Restart request failed: {error}"
        dashboard.log(f"P1AM restart failed: {error}", "error", "p1am")
    return diagnostic_health_fragment(request)


@app.post("/ui/labjack/connect", include_in_schema=False)
async def connect_labjack_ui(request: Request):
    form = await form_values(request)
    try:
        labjack.connect(form.get("ip", ""))
    except RuntimeError as error:
        dashboard.log(f"LabJack connection failed: {error}", "error", "labjack")
    return labjack_connection_fragment(request)


@app.post("/ui/labjack/disconnect", include_in_schema=False)
def disconnect_labjack_ui(request: Request):
    labjack.disconnect()
    return labjack_connection_fragment(request)


@app.post("/ui/labjack/stream/start", include_in_schema=False)
async def start_stream_ui(request: Request):
    form = await form_values(request)
    try:
        labjack.start_stream(
            int(form.get("scan_rate", "1000")),
        )
    except (RuntimeError, ValueError) as error:
        dashboard.log(f"LabJack stream failed: {error}", "error", "labjack")
    return labjack_fragment(request)


@app.post("/ui/labjack/stream/stop", include_in_schema=False)
def stop_stream_ui(request: Request):
    try:
        labjack.stop_stream()
    except RuntimeError as error:
        dashboard.log(f"LabJack stop pending: {error}", "warning", "labjack")
    return labjack_fragment(request)


@app.get("/api/status")
def status(
) -> dict:
    snapshot = dashboard.snapshot()
    return {**snapshot, "state_names": STATE_NAMES}


@app.get("/api/logs")
def logs(
    level: str | None = Query(default=None),
    component: str | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=500),
) -> dict:
    return {"logs": dashboard.log_snapshot(level, component, limit)}


@app.get("/api/runs/{run_id}/samples")
def run_samples(
    run_id: int,
    start: int = Query(default=0, ge=0),
    end: int | None = Query(default=None, ge=0),
    points: int = Query(default=800, ge=20, le=2_000),
) -> dict:
    run_record = runs.get_run(run_id)
    if not run_record:
        raise HTTPException(status_code=404, detail="Run not found")
    resolved_end = min(end or run_record["sample_count"], run_record["sample_count"])
    if resolved_end <= start:
        return {"run": run_record, "start": start, "end": resolved_end, "samples": []}
    return {
        "run": run_record,
        "start": start,
        "end": resolved_end,
        "samples": runs.sample_window(run_id, start, resolved_end, points),
    }


@app.get("/runs/{run_id}/export.csv", include_in_schema=False)
def export_run(run_id: int):
    if not runs.get_run(run_id):
        raise HTTPException(status_code=404, detail="Run not found")
    headers = {"Content-Disposition": f'attachment; filename="acquisition-run-{run_id}.csv"'}
    return StreamingResponse(runs.csv_rows(run_id), media_type="text/csv", headers=headers)


@app.delete("/ui/runs/{run_id}", include_in_schema=False)
def delete_run(request: Request, run_id: int):
    with dashboard.lock:
        active = dashboard.labjack.acquisition_state in {"starting", "running", "stopping"}
        current_run_id = dashboard.labjack.current_run_id
    if active and current_run_id == run_id:
        raise HTTPException(status_code=409, detail="Stop the active run before deleting it")
    runs.delete_run(run_id)
    context = template_context(request)
    context["runs"] = runs.list_runs()
    return templates.TemplateResponse(request, "fragments/run_table.html", context)


@app.post("/api/cart/state")
def set_cart_state(request: StateRequest) -> dict[str, bool]:
    try:
        cart.set_state(request.state)
    except (OSError, ConnectionError, ValueError) as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    return {"ok": True}


@app.post("/api/cart/initialize")
def initialize_cart() -> dict:
    try:
        return cart.initialize()
    except (OSError, ConnectionError, ValueError) as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


@app.post("/api/cart/reset")
def reset_cart() -> dict[str, bool]:
    try:
        cart.reset()
    except (OSError, ConnectionError, ValueError) as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    return {"ok": True}


@app.post("/api/labjack/connect")
def connect_labjack(request: ConnectionRequest) -> dict[str, bool]:
    try:
        labjack.connect(request.ip)
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    return {"ok": True}


@app.post("/api/labjack/disconnect")
def disconnect_labjack() -> dict[str, bool]:
    labjack.disconnect()
    return {"ok": True}


@app.post("/api/labjack/stream/start")
def start_stream(request: StreamRequest) -> dict[str, bool]:
    try:
        labjack.start_stream(**request.model_dump())
    except (RuntimeError, ValueError) as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    return {"ok": True}


@app.post("/api/labjack/stream/stop")
def stop_stream() -> dict[str, bool]:
    try:
        labjack.stop_stream()
    except RuntimeError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    return {"ok": True}


def run() -> None:
    """Open the dashboard and serve it on localhost."""
    url = "http://127.0.0.1:8000"
    Timer(0.8, webbrowser.open, args=(url,)).start()
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="warning")

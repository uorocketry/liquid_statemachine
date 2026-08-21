"""FastAPI application assembly and JSON API."""

from __future__ import annotations

import asyncio
import json
import webbrowser
from contextlib import asynccontextmanager
from pathlib import Path
from threading import Timer

import uvicorn
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field

from base_station.web.cart_service import CartService, STATE_NAMES
from base_station.web.daq_config import build_daq_router
from base_station.web.daq_config.repository import DaqConfigRepository
from base_station.web.labjack_service import LabJackService
from base_station.web.models import DashboardState
from base_station.web.run_repository import RunRepository
from base_station.web.ui_routes import build_ui_router

STATIC_DIR = Path(__file__).with_name("static")
TEMPLATE_DIR = Path(__file__).with_name("templates")
DATA_DIR = Path(__file__).resolve().parents[3] / "data"
DAQ_CONFIG_PATH = DATA_DIR / "daq-config.json"

templates = Jinja2Templates(directory=TEMPLATE_DIR)
dashboard = DashboardState()
cart = CartService(dashboard)
runs = RunRepository(DATA_DIR / "acquisition.sqlite3")
labjack = LabJackService(dashboard, runs)
daq_config = DaqConfigRepository(DAQ_CONFIG_PATH)


class ConnectionRequest(BaseModel):
    ip: str = Field(min_length=7, max_length=45)


class StateRequest(BaseModel):
    state: int = Field(ge=0, le=7)


def configured_graph() -> dict:
    return daq_config.load()["graph"]


def configured_labjack_settings() -> dict:
    return daq_config.load()["sources"]["labjack"]


@asynccontextmanager
async def lifespan(_: FastAPI):
    cart.start()
    try:
        labjack.connect(dashboard.labjack.ip)
    except RuntimeError as error:
        dashboard.log(f"LabJack auto-connect failed: {error}", "warning", "labjack")
    yield
    cart.stop()
    labjack.disconnect()


app = FastAPI(title="Liquid State Machine", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.include_router(build_ui_router(templates, dashboard, cart, labjack, runs, daq_config))
app.include_router(build_daq_router(dashboard, labjack, daq_config))


@app.get("/api/status")
def status() -> dict:
    return {**dashboard.snapshot(), "state_names": STATE_NAMES}


@app.get("/api/status/events", include_in_schema=False)
async def status_events(device: str | None = Query(default=None, pattern="^(p1am|labjack)$")) -> StreamingResponse:
    """Push global navigation status changes over one long-lived SSE request."""

    async def stream():
        previous = None
        heartbeat_ticks = 0
        yield "retry: 2000\n\n"
        while True:
            snapshot: dict[str, object] = {"navigation": dashboard.navigation_status()}
            if device:
                snapshot["device"] = {"id": device, "status": dashboard.device_status(device)}
            payload = json.dumps(snapshot, separators=(",", ":"))
            if payload != previous:
                yield f"event: status\ndata: {payload}\n\n"
                previous = payload
                heartbeat_ticks = 0
            elif heartbeat_ticks >= 30:
                yield ": keep-alive\n\n"
                heartbeat_ticks = 0
            await asyncio.sleep(0.5)
            heartbeat_ticks += 1

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


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
def start_stream() -> dict[str, bool]:
    try:
        labjack.start_stream(configured_graph(), configured_labjack_settings())
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
    """Open the operator UI and serve it on localhost."""
    url = "http://127.0.0.1:8000"
    Timer(0.8, webbrowser.open, args=(url,)).start()
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="warning")

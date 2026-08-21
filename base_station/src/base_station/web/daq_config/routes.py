"""Section-owned DAQ configuration APIs."""

from __future__ import annotations

import asyncio
import json
from time import sleep

from fastapi import APIRouter, Body, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse

from base_station.web.daq_config.capabilities import labjack_capabilities
from base_station.web.daq_config.dashboard_layout import copy_layout, normalize_dashboard_layout
from base_station.web.daq_config.labjack_settings import (
    normalize_labjack_settings,
    validate_labjack_settings,
)
from base_station.web.daq_config.node_specs import spec_defaults
from base_station.web.daq_config.preview import preview_graph
from base_station.web.daq_config.repository import DaqConfigRepository
from base_station.web.daq_config.schema import normalize_graph
from base_station.web.daq_config.validation import (
    blocking_issues,
    validate_graph,
    validate_labjack_graph_compatibility,
)
from base_station.web.labjack_service import LabJackService
from base_station.web.models import DashboardState

EDITOR_CONTRACT_VERSION = 2


def build_daq_router(
    dashboard: DashboardState,
    labjack: LabJackService,
    repository: DaqConfigRepository,
) -> APIRouter:
    """Expose independent graph, source-settings, and dashboard-layout transactions."""
    router = APIRouter(prefix="/api", tags=["daq-config"])

    @router.get("/daq/capabilities")
    def capabilities() -> dict:
        return labjack_capabilities(dashboard)

    @router.get("/daq/graph")
    def load_graph() -> dict:
        document = repository.load()
        graph = document["graph"]
        settings = document["sources"]["labjack"]
        return {
            "editorContract": EDITOR_CONTRACT_VERSION,
            "graph": graph,
            "issues": validate_graph(graph, settings),
            "sourceContext": {"labjack": settings},
            "specDefaults": spec_defaults(),
        }

    @router.put("/daq/graph")
    def save_graph(graph: dict = Body(...)) -> dict:
        return persist_graph(repository, graph)

    @router.websocket("/daq/preview/ws")
    async def preview_socket(websocket: WebSocket) -> None:
        """Keep one live preview session for the browser-owned draft graph."""
        await websocket.accept()
        settings = repository.load()["sources"]["labjack"]
        state: dict[str, object] = {"graph": None, "issues": []}

        async def receive_graphs() -> None:
            while True:
                message = await websocket.receive_json()
                if message.get("type") != "graph":
                    continue
                graph = normalize_graph(message.get("graph", {}))
                state["graph"] = graph
                state["issues"] = validate_graph(graph, settings)

        async def send_previews() -> None:
            previous_issues = None
            while True:
                await asyncio.sleep(0.65)
                graph = state["graph"]
                issues = state["issues"]
                if not isinstance(graph, dict) or not isinstance(issues, list):
                    continue
                if blocking_issues(issues):
                    encoded = json.dumps(issues, separators=(",", ":"))
                    if encoded != previous_issues:
                        await websocket.send_json({"values": {}, "errors": [], "issues": issues})
                        previous_issues = encoded
                    continue
                previous_issues = None
                try:
                    payload = await asyncio.to_thread(preview_graph, labjack, graph, settings)
                    await websocket.send_json(payload)
                except (RuntimeError, ValueError, OSError) as error:
                    await websocket.send_json({"values": {}, "errors": [str(error)], "unresolved": []})

        tasks = [asyncio.create_task(receive_graphs()), asyncio.create_task(send_previews())]
        try:
            await asyncio.gather(*tasks)
        except (WebSocketDisconnect, RuntimeError):
            pass
        finally:
            for task in tasks:
                task.cancel()

    @router.get("/dashboard/telemetry/events", include_in_schema=False)
    def dashboard_telemetry_events() -> StreamingResponse:
        """Stream saved-graph Dashboard telemetry over one long-lived request."""
        document = repository.load()
        graph = document["graph"]
        settings = document["sources"]["labjack"]
        issues = validate_graph(graph, settings)

        def stream():
            previous = None
            heartbeat_ticks = 0
            yield "retry: 2000\n\n"
            if blocking_issues(issues):
                payload = {"values": {}, "errors": [], "issues": issues}
                yield f"event: telemetry\ndata: {json.dumps(payload, separators=(',', ':'))}\n\n"
                return
            while True:
                try:
                    payload = preview_graph(labjack, graph, settings)
                except (RuntimeError, ValueError, OSError) as error:
                    payload = {"values": {}, "errors": [str(error)], "unresolved": []}
                encoded = json.dumps(payload, separators=(",", ":"))
                if encoded != previous:
                    yield f"event: telemetry\ndata: {encoded}\n\n"
                    previous = encoded
                    heartbeat_ticks = 0
                elif heartbeat_ticks >= 60:
                    yield ": keep-alive\n\n"
                    heartbeat_ticks = 0
                sleep(0.25)
                heartbeat_ticks += 1

        return StreamingResponse(
            stream(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    @router.get("/sources/labjack/settings")
    def load_labjack_settings() -> dict:
        return {"settings": repository.load()["sources"]["labjack"]}

    @router.put("/sources/labjack/settings")
    def save_labjack_settings(settings: dict = Body(...)) -> dict:
        canonical = normalize_labjack_settings(settings)
        messages = validate_labjack_settings(canonical)
        if messages:
            raise HTTPException(status_code=422, detail={"issues": messages})
        document = repository.load()
        compatibility = validate_labjack_graph_compatibility(document["graph"], canonical)
        if blocking_issues(compatibility):
            raise HTTPException(status_code=422, detail={"issues": compatibility})
        saved = repository.save_labjack_settings(canonical)
        return {"saved": True, "settings": saved}

    @router.get("/dashboard/layout")
    def load_dashboard_layout() -> dict:
        return {"layout": copy_layout(repository.load()["dashboard"]["layout"])}

    @router.put("/dashboard/layout")
    def save_dashboard_layout(layout: dict = Body(...)) -> dict:
        document = repository.load()
        canonical = normalize_dashboard_layout(document["graph"], layout)
        saved = repository.save_dashboard_layout(canonical)
        return {"saved": True, "layout": copy_layout(saved)}

    return router


def persist_graph(repository: DaqConfigRepository, graph: dict) -> dict:
    """Validate and replace topology without touching source or dashboard settings."""
    canonical = normalize_graph(graph)
    settings = repository.load()["sources"]["labjack"]
    issues = validate_graph(canonical, settings)
    if blocking_issues(issues):
        raise HTTPException(status_code=422, detail={"issues": issues})
    saved = repository.save_graph(canonical)
    return {"saved": True, "graph": saved, "issues": issues}

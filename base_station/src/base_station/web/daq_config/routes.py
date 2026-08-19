"""FastAPI routes supporting the DAQ configuration editor."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Body, HTTPException

from base_station.web.daq_config.capabilities import labjack_capabilities
from base_station.web.daq_config.migration import migrate_graph
from base_station.web.daq_config.preview import preview_graph
from base_station.web.daq_config.repository import DaqConfigRepository
from base_station.web.daq_config.validation import blocking_issues, validate_graph
from base_station.web.labjack_service import LabJackService
from base_station.web.models import DashboardState


def build_daq_router(
    dashboard: DashboardState,
    labjack: LabJackService,
    config_path: Path,
) -> APIRouter:
    repository = DaqConfigRepository(config_path)
    router = APIRouter(prefix="/api/daq", tags=["daq-config"])

    @router.get("/capabilities")
    def capabilities() -> dict:
        return labjack_capabilities(dashboard)

    @router.get("/configuration")
    def load_configuration() -> dict:
        stored = repository.load()
        graph = migrate_graph(stored)
        if graph != stored:
            repository.save(graph)
        return {"graph": graph, "issues": validate_graph(graph)}

    @router.put("/configuration")
    def save_configuration(graph: dict = Body(...)) -> dict:
        graph = migrate_graph(graph)
        issues = validate_graph(graph)
        errors = blocking_issues(issues)
        if errors:
            raise HTTPException(status_code=422, detail={"issues": issues})
        repository.save(graph)
        return {"saved": True, "issues": issues}

    @router.post("/preview")
    def preview(graph: dict = Body(...)) -> dict:
        graph = migrate_graph(graph)
        issues = validate_graph(graph)
        if blocking_issues(issues):
            raise HTTPException(status_code=422, detail={"issues": issues})
        return preview_graph(labjack, graph)

    return router

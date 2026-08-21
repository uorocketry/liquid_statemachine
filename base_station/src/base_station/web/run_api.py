"""Run listing, deletion, and timeline JSON APIs."""

from fastapi import APIRouter, Body, HTTPException, Query

from base_station.web.models import DashboardState
from base_station.web.run_repository import RunRepository


def build_run_router(dashboard: DashboardState, runs: RunRepository) -> APIRouter:
    router = APIRouter(prefix="/api/runs", tags=["runs"])

    @router.get("")
    def list_runs() -> dict:
        return {"runs": runs.list_runs()}

    @router.delete("/{run_id}")
    def delete_run(run_id: int) -> dict[str, bool]:
        with dashboard.lock:
            active = dashboard.labjack.acquisition_state in {"starting", "running", "stopping"}
            current_run_id = dashboard.labjack.current_run_id
        if active and current_run_id == run_id:
            raise HTTPException(status_code=409, detail="Stop the active run before deleting it")
        if not runs.delete_run(run_id):
            raise HTTPException(status_code=404, detail="Run not found")
        return {"deleted": True}

    @router.get("/{run_id}/samples")
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

    @router.post("/{run_id}/view")
    def run_view(run_id: int, request: dict = Body(...)) -> dict:
        run_record = runs.get_run(run_id)
        if not run_record:
            raise HTTPException(status_code=404, detail="Run not found")
        ranges = request.get("ranges")
        if not isinstance(ranges, list) or not 1 <= len(ranges) <= 3:
            raise HTTPException(status_code=422, detail="Timeline ranges are required")
        tiers = []
        for index, item in enumerate(ranges):
            if not isinstance(item, list) or len(item) != 2:
                raise HTTPException(status_code=422, detail="Invalid timeline range")
            try:
                start = _timeline_bound(item[0])
                end = _timeline_bound(item[1])
            except (TypeError, ValueError) as error:
                raise HTTPException(status_code=422, detail="Invalid timeline range") from error
            start = min(max(0, start), run_record["sample_count"])
            end = min(max(start, end), run_record["sample_count"])
            points = 900 if index == len(ranges) - 1 else 500
            tiers.append(runs.sample_window(run_id, start, end, points))
        return {"run": run_record, "tiers": tiers}

    return router


def _timeline_bound(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TypeError("Timeline bounds must be numbers")
    if value != value or value in {float("inf"), float("-inf")}:
        raise ValueError("Timeline bounds must be finite")
    return int(value)

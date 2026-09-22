from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ..deps import require_token
from ..framework import DeviceNotFound, RunSpec
from ..runs import DeviceBusy, RunExists, RunManager, RunNotFound

router = APIRouter(dependencies=[Depends(require_token)])

HEARTBEAT_SECONDS = 15.0


def get_run_manager(request: Request) -> RunManager:
    return request.app.state.runs


class RunOptions(BaseModel):
    vision: bool = False
    reasoning: bool = False
    maxSteps: int = Field(default=15, ge=1, le=500)


class StartRunRequest(BaseModel):
    runId: str = Field(min_length=1, max_length=64)
    deviceSerial: str = Field(min_length=1)
    instruction: str = Field(min_length=1)
    startUrl: str | None = None
    options: RunOptions = Field(default_factory=RunOptions)
    variables: dict[str, str] = Field(default_factory=dict)
    prompts: dict[str, str] = Field(default_factory=dict)
    appCards: list[dict[str, Any]] = Field(default_factory=list)
    memory: dict[str, str] = Field(default_factory=dict)


class ActiveRunResponse(BaseModel):
    runId: str
    deviceSerial: str
    startedAt: float


@router.post("/runs", status_code=202)
async def start_run(body: StartRunRequest, runs: RunManager = Depends(get_run_manager)) -> dict:
    spec = RunSpec(
        run_id=body.runId,
        device_serial=body.deviceSerial,
        instruction=body.instruction,
        start_url=body.startUrl,
        vision=body.options.vision,
        reasoning=body.options.reasoning,
        max_steps=body.options.maxSteps,
        variables=body.variables,
        prompts=body.prompts,
        app_cards=body.appCards,
        memory=body.memory,
    )
    try:
        await runs.start(spec)
    except DeviceBusy as exc:
        raise HTTPException(
            status_code=409, detail={"code": "device_busy", "message": str(exc)}
        ) from None
    except RunExists as exc:
        raise HTTPException(
            status_code=409, detail={"code": "run_exists", "message": str(exc)}
        ) from None
    except DeviceNotFound:
        raise HTTPException(
            status_code=404,
            detail={"code": "device_not_found", "message": f"Device {body.deviceSerial} is not connected"},
        ) from None
    return {"runId": body.runId}


@router.get("/runs", response_model=list[ActiveRunResponse])
async def list_runs(runs: RunManager = Depends(get_run_manager)) -> list[ActiveRunResponse]:
    return [
        ActiveRunResponse(runId=r.spec.run_id, deviceSerial=r.spec.device_serial, startedAt=r.started_at)
        for r in runs.active()
    ]


@router.post("/runs/{run_id}/stop", status_code=202)
async def stop_run(run_id: str, runs: RunManager = Depends(get_run_manager)) -> dict:
    try:
        await runs.stop(run_id)
    except RunNotFound:
        raise HTTPException(
            status_code=404, detail={"code": "run_not_found", "message": f"Run {run_id} is not active"}
        ) from None
    return {"runId": run_id}


@router.get("/runs/{run_id}/events")
async def run_events(
    run_id: str, request: Request, runs: RunManager = Depends(get_run_manager)
) -> StreamingResponse:
    try:
        runs.get(run_id)
    except RunNotFound:
        raise HTTPException(
            status_code=404, detail={"code": "run_not_found", "message": f"Run {run_id} is not active"}
        ) from None

    last_id = request.headers.get("Last-Event-ID")
    after_seq = int(last_id) if last_id and last_id.isdigit() else -1

    async def stream():
        async for item in runs.subscribe(run_id, after_seq=after_seq, heartbeat=HEARTBEAT_SECONDS):
            if item is None:
                yield ": keep-alive\n\n"
                continue
            data = json.dumps(item.event.payload, separators=(",", ":"))
            yield f"id: {item.seq}\nevent: {item.event.type}\ndata: {data}\n\n"

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )

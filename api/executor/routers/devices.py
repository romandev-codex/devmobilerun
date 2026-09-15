from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response

from ..deps import get_framework, require_token
from ..framework import DeviceNotFound, Framework
from ..models import DeviceResponse

router = APIRouter(dependencies=[Depends(require_token)])


@router.get("/devices", response_model=list[DeviceResponse])
async def list_devices(framework: Framework = Depends(get_framework)) -> list[DeviceResponse]:
    devices = await framework.list_devices()
    return [DeviceResponse(serial=d.serial, state=d.state, model=d.model) for d in devices]


@router.get("/devices/{serial}/screenshot")
async def screenshot(serial: str, framework: Framework = Depends(get_framework)) -> Response:
    try:
        png = await framework.screenshot(serial)
    except DeviceNotFound:
        raise HTTPException(
            status_code=404,
            detail={"code": "device_not_found", "message": f"Device {serial} is not connected"},
        ) from None
    return Response(content=png, media_type="image/png", headers={"Cache-Control": "no-store"})

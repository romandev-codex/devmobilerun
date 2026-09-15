from __future__ import annotations

from fastapi import APIRouter, Depends

from ..deps import get_framework, require_token
from ..framework import Framework
from ..models import DeviceResponse

router = APIRouter(dependencies=[Depends(require_token)])


@router.get("/devices", response_model=list[DeviceResponse])
async def list_devices(framework: Framework = Depends(get_framework)) -> list[DeviceResponse]:
    devices = await framework.list_devices()
    return [DeviceResponse(serial=d.serial, state=d.state, model=d.model) for d in devices]

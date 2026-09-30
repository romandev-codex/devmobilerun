from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response

from ..deps import get_framework, require_token
from ..framework import DeviceNotFound, DeviceUserError, Framework, PortalInstallError
from ..models import (
    CreateDeviceUserRequest,
    DeviceResponse,
    DeviceThermalResponse,
    DeviceUserResponse,
    PortalInstallResponse,
)

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


@router.get("/devices/{serial}/thermal", response_model=DeviceThermalResponse)
async def thermal(serial: str, framework: Framework = Depends(get_framework)) -> DeviceThermalResponse:
    try:
        temperature = await framework.battery_temperature(serial)
    except DeviceNotFound:
        raise HTTPException(
            status_code=404,
            detail={"code": "device_not_found", "message": f"Device {serial} is not connected"},
        ) from None
    return DeviceThermalResponse(temperatureC=temperature)


def _device_not_found(serial: str) -> HTTPException:
    return HTTPException(
        status_code=404,
        detail={"code": "device_not_found", "message": f"Device {serial} is not connected"},
    )


def _user_error(exc: DeviceUserError) -> HTTPException:
    return HTTPException(status_code=400, detail={"code": "device_user_error", "message": str(exc)})


async def _users(framework: Framework, serial: str) -> list[DeviceUserResponse]:
    users = await framework.list_users(serial)
    return [DeviceUserResponse(id=u.id, name=u.name, running=u.running, current=u.current) for u in users]


@router.get("/devices/{serial}/users", response_model=list[DeviceUserResponse])
async def list_users(serial: str, framework: Framework = Depends(get_framework)) -> list[DeviceUserResponse]:
    """The Android users (profiles) on the device, from ``pm list users``."""
    try:
        return await _users(framework, serial)
    except DeviceNotFound:
        raise _device_not_found(serial) from None


@router.post("/devices/{serial}/users", status_code=201, response_model=list[DeviceUserResponse])
async def create_user(
    serial: str, body: CreateDeviceUserRequest, framework: Framework = Depends(get_framework)
) -> list[DeviceUserResponse]:
    """Creates a user with ``pm create-user`` and returns the updated list."""
    try:
        await framework.create_user(serial, body.name.strip())
        return await _users(framework, serial)
    except DeviceNotFound:
        raise _device_not_found(serial) from None
    except DeviceUserError as exc:
        raise _user_error(exc) from None


@router.delete("/devices/{serial}/users/{user_id}", response_model=list[DeviceUserResponse])
async def remove_user(
    serial: str, user_id: int, framework: Framework = Depends(get_framework)
) -> list[DeviceUserResponse]:
    """Deletes an additional user with ``pm remove-user -f``; the owner (user 0) stays."""
    if user_id == 0:
        raise HTTPException(
            status_code=400,
            detail={"code": "device_user_error", "message": "The owner profile cannot be removed"},
        )
    try:
        users = await framework.list_users(serial)
        if not any(u.id == user_id for u in users):
            raise HTTPException(
                status_code=404,
                detail={"code": "user_not_found", "message": f"Device {serial} has no user {user_id}"},
            )
        await framework.remove_user(serial, user_id)
        return await _users(framework, serial)
    except DeviceNotFound:
        raise _device_not_found(serial) from None
    except DeviceUserError as exc:
        raise _user_error(exc) from None


@router.post("/devices/{serial}/users/{user_id}/activate", response_model=list[DeviceUserResponse])
async def activate_user(
    serial: str, user_id: int, framework: Framework = Depends(get_framework)
) -> list[DeviceUserResponse]:
    """Brings the user to the foreground with ``am switch-user`` and returns the updated list."""
    try:
        users = await framework.list_users(serial)
        if not any(u.id == user_id for u in users):
            raise HTTPException(
                status_code=404,
                detail={"code": "user_not_found", "message": f"Device {serial} has no user {user_id}"},
            )
        if not any(u.id == user_id and u.current for u in users):
            await framework.switch_user(serial, user_id)
        return await _users(framework, serial)
    except DeviceNotFound:
        raise _device_not_found(serial) from None
    except DeviceUserError as exc:
        raise _user_error(exc) from None


@router.post("/devices/{serial}/users/{user_id}/portal", response_model=PortalInstallResponse)
async def install_portal(
    serial: str, user_id: int, framework: Framework = Depends(get_framework)
) -> PortalInstallResponse:
    """Installs or reinstalls the Mobilerun Portal for the user with ``pm install --user``
    and enables its accessibility service for that user."""
    try:
        users = await framework.list_users(serial)
        if not any(u.id == user_id for u in users):
            raise HTTPException(
                status_code=404,
                detail={"code": "user_not_found", "message": f"Device {serial} has no user {user_id}"},
            )
        result = await framework.install_portal(serial, user_id)
    except DeviceNotFound:
        raise _device_not_found(serial) from None
    except PortalInstallError as exc:
        raise HTTPException(
            status_code=502, detail={"code": "portal_install_error", "message": str(exc)}
        ) from None
    return PortalInstallResponse(
        userId=result.user_id,
        version=result.version,
        accessibilityEnabled=result.accessibility_enabled,
    )

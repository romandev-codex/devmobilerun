from __future__ import annotations

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: str
    version: str
    mobilerunVersion: str


class LlmProfileInfo(BaseModel):
    role: str
    provider: str
    model: str


class JevInfo(BaseModel):
    configured: bool
    model: str
    provider: str = "TypeSafe"


class ConfigResponse(BaseModel):
    profiles: list[LlmProfileInfo]
    configPath: str | None = None
    jev: JevInfo | None = None


class ErrorBody(BaseModel):
    code: str
    message: str


class ErrorResponse(BaseModel):
    error: ErrorBody


class DeviceResponse(BaseModel):
    serial: str
    state: str
    model: str | None = None


class DeviceThermalResponse(BaseModel):
    """Battery temperature in °C, or null when the device reports no usable sensor."""

    temperatureC: float | None = None


class DeviceUserResponse(BaseModel):
    """One Android user (profile) on the device."""

    id: int
    name: str
    running: bool
    current: bool


class CreateDeviceUserRequest(BaseModel):
    name: str = Field(min_length=1, max_length=60)

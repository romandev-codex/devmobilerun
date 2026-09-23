from __future__ import annotations

from pydantic import BaseModel


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

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


class ConfigResponse(BaseModel):
    profiles: list[LlmProfileInfo]
    configPath: str | None = None


class ErrorBody(BaseModel):
    code: str
    message: str


class ErrorResponse(BaseModel):
    error: ErrorBody

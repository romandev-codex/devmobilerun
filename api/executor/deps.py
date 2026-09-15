from __future__ import annotations

import secrets

from fastapi import Depends, Header, HTTPException, Request

from .framework import Framework
from .settings import Settings

TOKEN_HEADER = "X-Mobilerun-Token"


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_framework(request: Request) -> Framework:
    return request.app.state.framework


def require_token(
    settings: Settings = Depends(get_settings),
    x_mobilerun_token: str | None = Header(default=None, alias=TOKEN_HEADER),
) -> None:
    if not x_mobilerun_token or not secrets.compare_digest(x_mobilerun_token, settings.token):
        raise HTTPException(
            status_code=401,
            detail={"code": "unauthorized", "message": f"Missing or invalid {TOKEN_HEADER} header"},
        )

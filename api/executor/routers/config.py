from __future__ import annotations

from fastapi import APIRouter, Depends

from ..deps import get_framework, require_token
from ..framework import Framework
from ..models import ConfigResponse, JevInfo, LlmProfileInfo

router = APIRouter(dependencies=[Depends(require_token)])


@router.get("/config", response_model=ConfigResponse)
def config(framework: Framework = Depends(get_framework)) -> ConfigResponse:
    summary = framework.describe_config()
    return ConfigResponse(
        profiles=[
            LlmProfileInfo(role=p.role, provider=p.provider, model=p.model)
            for p in summary.profiles
        ],
        configPath=summary.config_path,
        jev=JevInfo(
            configured=summary.jev.configured,
            model=summary.jev.model,
            provider=summary.jev.provider,
        ) if summary.jev else None,
    )

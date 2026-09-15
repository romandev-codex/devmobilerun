from __future__ import annotations

from fastapi import APIRouter, Depends

from .. import __version__
from ..deps import get_framework, require_token
from ..framework import Framework
from ..models import HealthResponse

router = APIRouter(dependencies=[Depends(require_token)])


@router.get("/health", response_model=HealthResponse)
def health(framework: Framework = Depends(get_framework)) -> HealthResponse:
    return HealthResponse(status="ok", version=__version__, mobilerunVersion=framework.version())

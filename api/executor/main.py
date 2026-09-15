from __future__ import annotations

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from . import __version__
from .framework import Framework, MobilerunFramework
from .routers import config, devices, health
from .settings import Settings


def create_app(settings: Settings, framework: Framework | None = None) -> FastAPI:
    app = FastAPI(title="mobilerun executor", version=__version__)
    app.state.settings = settings
    app.state.framework = framework or MobilerunFramework()

    @app.exception_handler(HTTPException)
    async def http_error(_: Request, exc: HTTPException) -> JSONResponse:
        detail = exc.detail
        body = (
            detail
            if isinstance(detail, dict) and "code" in detail
            else {"code": "http_error", "message": str(detail)}
        )
        return JSONResponse(status_code=exc.status_code, content={"error": body})

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content={"error": {"code": "validation_error", "message": str(exc.errors())}},
        )

    app.include_router(health.router)
    app.include_router(config.router)
    app.include_router(devices.router)
    return app


def run() -> None:
    import uvicorn

    settings = Settings.from_env()
    uvicorn.run(create_app(settings), host=settings.host, port=settings.port)

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from executor.framework import ConfigSummary, LlmProfile
from executor.main import create_app
from executor.settings import Settings

TOKEN = "test-token"


class FakeFramework:
    """Scripted stand-in for the mobilerun framework used at the HTTP seam."""

    def __init__(self) -> None:
        self.profiles = [
            LlmProfile(role="fast_agent", provider="OpenAI", model="gpt-test"),
            LlmProfile(role="manager", provider="Anthropic", model="claude-test"),
        ]

    def version(self) -> str:
        return "9.9.9-fake"

    def describe_config(self) -> ConfigSummary:
        return ConfigSummary(profiles=list(self.profiles), config_path="/fake/config.yaml")


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture
def framework() -> FakeFramework:
    return FakeFramework()


@pytest.fixture
def app(framework: FakeFramework):
    return create_app(Settings(token=TOKEN), framework=framework)


@pytest.fixture
async def client(app):
    transport = ASGITransport(app=app)
    async with AsyncClient(
        transport=transport,
        base_url="http://executor",
        headers={"X-Mobilerun-Token": TOKEN},
    ) as c:
        yield c


@pytest.fixture
async def anon_client(app):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://executor") as c:
        yield c

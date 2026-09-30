from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

import asyncio
from typing import AsyncIterator

from executor.events import RunEvent
from executor.framework import (
    ConfigSummary,
    DeviceInfo,
    DeviceNotFound,
    DeviceUser,
    DeviceUserError,
    LlmProfile,
    RunSpec,
)
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
        self.devices = [
            DeviceInfo(serial="emulator-5554", state="device", model="sdk_gphone64"),
            DeviceInfo(serial="ZY22ABCD", state="unauthorized", model=None),
        ]
        self.opened_urls: list[tuple[str, str]] = []
        self.woken: list[str] = []
        # Android users per serial; the owner is in the foreground to begin with.
        self.users: dict[str, list[DeviceUser]] = {
            "emulator-5554": [
                DeviceUser(id=0, name="Owner", running=True, current=True),
                DeviceUser(id=10, name="Work", running=False, current=False),
            ]
        }
        self.created_users: list[tuple[str, str]] = []
        self.switched_users: list[tuple[str, int]] = []
        self.removed_users: list[tuple[str, int]] = []
        self.next_user_id = 11
        # When set, creating or switching a user fails with this message.
        self.user_error: str | None = None
        # Battery temperature per serial (°C); None means the device has no usable sensor.
        self.temperatures: dict[str, float | None] = {"emulator-5554": 31.2}
        self.specs: list[RunSpec] = []
        # Script: list of RunEvents or floats (sleep seconds) consumed by the next run.
        self.script: list[RunEvent | float] = [
            RunEvent("thought", {"text": "Looking at the screen", "source": "fast_agent"}),
            RunEvent("action", {"tool": "tap", "args": {"index": 3}, "success": True, "summary": "Tapped"}),
            RunEvent("result", {"success": True, "reason": "Done", "steps": 2}),
        ]
        self.cancelled: list[str] = []
        # When true the fake agent ignores task cancellation and still emits its
        # scripted terminal event, like a workflow that finishes during a cooperative cancel.
        self.swallow_cancel = False

    def version(self) -> str:
        return "9.9.9-fake"

    def describe_config(self) -> ConfigSummary:
        return ConfigSummary(profiles=list(self.profiles), config_path="/fake/config.yaml")

    async def list_devices(self) -> list[DeviceInfo]:
        return list(self.devices)

    async def screenshot(self, serial: str) -> bytes:
        if not any(d.serial == serial and d.state == "device" for d in self.devices):
            raise DeviceNotFound(serial)
        return PNG_BYTES

    async def battery_temperature(self, serial: str) -> float | None:
        if not any(d.serial == serial and d.state == "device" for d in self.devices):
            raise DeviceNotFound(serial)
        return self.temperatures.get(serial)

    def _require_online(self, serial: str) -> None:
        if not any(d.serial == serial and d.state == "device" for d in self.devices):
            raise DeviceNotFound(serial)

    async def list_users(self, serial: str) -> list[DeviceUser]:
        self._require_online(serial)
        return list(self.users.get(serial, []))

    async def create_user(self, serial: str, name: str) -> DeviceUser:
        self._require_online(serial)
        if self.user_error:
            raise DeviceUserError(self.user_error)
        user = DeviceUser(id=self.next_user_id, name=name, running=False, current=False)
        self.next_user_id += 1
        self.users.setdefault(serial, []).append(user)
        self.created_users.append((serial, name))
        return user

    async def switch_user(self, serial: str, user_id: int) -> None:
        self._require_online(serial)
        if self.user_error:
            raise DeviceUserError(self.user_error)
        self.users[serial] = [
            DeviceUser(id=u.id, name=u.name, running=u.running or u.id == user_id, current=u.id == user_id)
            for u in self.users.get(serial, [])
        ]
        self.switched_users.append((serial, user_id))

    async def remove_user(self, serial: str, user_id: int) -> None:
        self._require_online(serial)
        if self.user_error:
            raise DeviceUserError(self.user_error)
        self.users[serial] = [u for u in self.users.get(serial, []) if u.id != user_id]
        self.removed_users.append((serial, user_id))

    async def open_url(self, serial: str, url: str) -> None:
        self.opened_urls.append((serial, url))

    async def wake(self, serial: str) -> None:
        self.woken.append(serial)

    def create_run(self, spec: RunSpec) -> "FakeAgentRun":
        self.specs.append(spec)
        return FakeAgentRun(self, spec, list(self.script))


class FakeAgentRun:
    def __init__(self, framework: FakeFramework, spec: RunSpec, script: list[RunEvent | float]):
        self.framework = framework
        self.spec = spec
        self.script = script

    async def events(self) -> AsyncIterator[RunEvent]:
        for item in self.script:
            if isinstance(item, float):
                try:
                    await asyncio.sleep(item)
                except asyncio.CancelledError:
                    if not self.framework.swallow_cancel:
                        raise
            else:
                yield item

    async def cancel(self) -> None:
        self.framework.cancelled.append(self.spec.run_id)


PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"fake-image-" + b"0" * 32


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

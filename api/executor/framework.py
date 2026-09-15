"""Adapter boundary between the executor and the mobilerun framework.

Everything the executor needs from the framework goes through the ``Framework``
protocol so tests can substitute a scripted fake at the HTTP seam.
"""

from __future__ import annotations

import base64
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Protocol

from .events import RunEvent


@dataclass(frozen=True)
class LlmProfile:
    role: str
    provider: str
    model: str


@dataclass(frozen=True)
class ConfigSummary:
    profiles: list[LlmProfile]
    config_path: str | None


@dataclass(frozen=True)
class DeviceInfo:
    serial: str
    state: str  # raw adb state: device | offline | unauthorized | ...
    model: str | None = None


@dataclass(frozen=True)
class RunSpec:
    run_id: str
    device_serial: str
    instruction: str
    start_url: str | None = None
    vision: bool = False
    reasoning: bool = False
    max_steps: int = 15
    variables: dict[str, str] = field(default_factory=dict)
    prompts: dict[str, str] = field(default_factory=dict)
    app_cards: list[dict[str, Any]] = field(default_factory=list)


class DeviceNotFound(Exception):
    """Raised when a serial is not in the adb device list."""


class AgentRun(Protocol):
    """One execution of the agent. ``events`` yields until a terminal event."""

    def events(self) -> AsyncIterator[RunEvent]: ...

    async def cancel(self) -> None: ...


class Framework(Protocol):
    def version(self) -> str: ...

    def describe_config(self) -> ConfigSummary: ...

    async def list_devices(self) -> list[DeviceInfo]: ...

    async def screenshot(self, serial: str) -> bytes: ...

    async def open_url(self, serial: str, url: str) -> None: ...

    def create_run(self, spec: RunSpec) -> AgentRun: ...


class MobilerunFramework:
    """Real adapter. Imports the framework lazily so importing the executor stays cheap."""

    def version(self) -> str:
        from importlib.metadata import PackageNotFoundError, version

        try:
            return version("mobilerun")
        except PackageNotFoundError:
            return "unknown"

    def describe_config(self) -> ConfigSummary:
        import os

        from mobilerun.config_manager import ConfigLoader

        config = ConfigLoader.load()
        profiles = [
            LlmProfile(role=role, provider=profile.provider, model=profile.model)
            for role, profile in sorted(config.llm_profiles.items())
        ]
        env_path = os.environ.get("MOBILERUN_CONFIG")
        config_path = env_path if env_path else str(ConfigLoader.get_user_config_path())
        return ConfigSummary(profiles=profiles, config_path=config_path)

    async def list_devices(self) -> list[DeviceInfo]:
        from async_adbutils import adb

        infos = await adb.list()
        devices: list[DeviceInfo] = []
        for info in infos:
            model: str | None = None
            if info.state == "device":
                try:
                    device = await adb.device(serial=info.serial)
                    model = (await device.getprop("ro.product.model")).strip() or None
                except Exception:  # noqa: BLE001 - a flaky device must not break the listing
                    model = None
            devices.append(DeviceInfo(serial=info.serial, state=info.state, model=model))
        return devices

    async def screenshot(self, serial: str) -> bytes:
        from async_adbutils import adb

        try:
            device = await adb.device(serial=serial)
            return await device.screenshot_bytes()
        except Exception as exc:  # noqa: BLE001 - adb reports missing/offline devices as errors
            raise DeviceNotFound(serial) from exc

    async def open_url(self, serial: str, url: str) -> None:
        from async_adbutils import adb

        device = await adb.device(serial=serial)
        await device.shell(["am", "start", "-a", "android.intent.action.VIEW", "-d", url])

    def create_run(self, spec: RunSpec) -> AgentRun:
        return MobilerunAgentRun(spec)


def map_framework_event(event: Any, step_counter: list[int]) -> RunEvent | None:
    """Translates a llama-index workflow event from the framework into a RunEvent.

    ``step_counter`` is a one-element list holding the running screenshot index;
    the caller owns it so the mapper needs no state of its own.
    """
    from mobilerun.agent.common.events import ScreenshotEvent, ToolExecutionEvent
    from mobilerun.agent.droid.events import FastAgentResultEvent, FinalizeEvent
    from mobilerun.agent.executor.events import ExecutorActionEvent
    from mobilerun.agent.fast_agent.events import FastAgentEndEvent, FastAgentResponseEvent
    from mobilerun.agent.manager.events import ManagerPlanDetailsEvent

    if isinstance(event, ScreenshotEvent):
        step = step_counter[0]
        step_counter[0] += 1
        return RunEvent(
            "screenshot",
            {"step": step, "png": base64.b64encode(event.screenshot).decode("ascii")},
        )
    if isinstance(event, FastAgentResponseEvent):
        return RunEvent("thought", {"text": event.thought, "code": event.code, "source": "fast_agent"})
    if isinstance(event, ExecutorActionEvent):
        return RunEvent(
            "thought",
            {"text": event.thought, "description": event.description, "source": "executor"},
        )
    if isinstance(event, ManagerPlanDetailsEvent):
        return RunEvent("plan", {"plan": event.plan, "subgoal": event.subgoal, "thought": event.thought})
    if isinstance(event, ToolExecutionEvent):
        return RunEvent(
            "action",
            {
                "tool": event.tool_name,
                "args": _jsonable(event.tool_args),
                "success": event.success,
                "summary": event.summary,
            },
        )
    if isinstance(event, (FastAgentEndEvent, FastAgentResultEvent, FinalizeEvent)):
        return RunEvent(
            "log",
            {"message": f"{type(event).__name__}: {event.reason}", "success": event.success},
        )
    return None


def _jsonable(value: Any) -> Any:
    import json

    try:
        json.dumps(value)
        return value
    except (TypeError, ValueError):
        return repr(value)


class MobilerunAgentRun:
    """Drives a real MobileAgent and yields normalized events."""

    def __init__(self, spec: RunSpec) -> None:
        self.spec = spec
        self._handler: Any = None

    async def events(self) -> AsyncIterator[RunEvent]:
        import os

        from mobilerun.agent.droid import MobileAgent
        from mobilerun.config_manager import ConfigLoader

        os.environ.setdefault("MOBILERUN_STREAM_SCREENSHOTS", "1")
        spec = self.spec
        config = ConfigLoader.load()
        config.agent.max_steps = spec.max_steps
        config.agent.reasoning = spec.reasoning
        config.agent.fast_agent.vision = spec.vision
        config.agent.manager.vision = spec.vision
        config.agent.executor.vision = spec.vision
        config.device.serial = spec.device_serial
        config.logging.save_trajectory = "none"

        from .app_cards import write_app_cards_dir

        cards_dir = write_app_cards_dir(spec.app_cards)
        if cards_dir is not None:
            config.agent.app_cards.enabled = True
            config.agent.app_cards.mode = "local"
            config.agent.app_cards.app_cards_dir = str(cards_dir)

        agent = MobileAgent(
            goal=spec.instruction,
            config=config,
            variables=spec.variables or None,
            prompts=spec.prompts or None,
            timeout=max(600, spec.max_steps * 90),
        )
        handler = agent.run()
        self._handler = handler
        step_counter = [0]
        async for raw in handler.stream_events():
            mapped = map_framework_event(raw, step_counter)
            if mapped is not None:
                yield mapped
        result = await handler
        yield RunEvent(
            "result",
            {"success": bool(result.success), "reason": result.reason, "steps": int(result.steps)},
        )

    async def cancel(self) -> None:
        if self._handler is not None:
            try:
                await self._handler.cancel_run()
            except Exception:  # noqa: BLE001 - best effort; the task is cancelled regardless
                pass

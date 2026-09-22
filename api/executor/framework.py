"""Adapter boundary between the executor and the mobilerun framework.

Everything the executor needs from the framework goes through the ``Framework``
protocol so tests can substitute a scripted fake at the HTTP seam.
"""

from __future__ import annotations

import base64
import re
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
    memory: dict[str, str] = field(default_factory=dict)


class DeviceNotFound(Exception):
    """Raised when a serial is not in the adb device list."""


def parse_battery_temperature(dumpsys_output: str) -> float | None:
    """Reads the battery temperature (°C) from ``dumpsys battery`` output.

    Android reports it in tenths of a degree (``temperature: 312`` is 31.2 °C).
    Returns None when the line is missing or the value is not a usable reading;
    emulators and some boards report 0 for a sensor they do not have.
    """
    match = re.search(r"^\s*temperature:\s*(-?\d+)\s*$", dumpsys_output, re.MULTILINE)
    if not match:
        return None
    tenths = int(match.group(1))
    if tenths <= 0:
        return None
    return tenths / 10


class AgentRun(Protocol):
    """One execution of the agent. ``events`` yields until a terminal event."""

    def events(self) -> AsyncIterator[RunEvent]: ...

    async def cancel(self) -> None: ...


class Framework(Protocol):
    def version(self) -> str: ...

    def describe_config(self) -> ConfigSummary: ...

    async def list_devices(self) -> list[DeviceInfo]: ...

    async def screenshot(self, serial: str) -> bytes: ...

    async def battery_temperature(self, serial: str) -> float | None: ...

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
        # Mirror the loader: the env path counts only when the file exists.
        if env_path and os.path.exists(env_path):
            config_path = env_path
        else:
            config_path = str(ConfigLoader.get_user_config_path())
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

        from async_adbutils.errors import AdbError

        try:
            device = await adb.device(serial=serial)
            return await device.screenshot_bytes()
        except AdbError as exc:
            message = str(exc).lower()
            if "not found" in message or "offline" in message or "unauthorized" in message:
                raise DeviceNotFound(serial) from exc
            raise

    async def battery_temperature(self, serial: str) -> float | None:
        from async_adbutils import adb

        from async_adbutils.errors import AdbError

        try:
            device = await adb.device(serial=serial)
            output = await device.shell(["dumpsys", "battery"])
        except AdbError as exc:
            message = str(exc).lower()
            if "not found" in message or "offline" in message or "unauthorized" in message:
                raise DeviceNotFound(serial) from exc
            raise
        return parse_battery_temperature(output if isinstance(output, str) else str(output))

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


def compose_goal(spec: RunSpec) -> str:
    """The instruction the agent receives.

    Task memory is always appended so the agent sees what earlier runs stored.
    The framework reads app cards only in reasoning mode (the manager agent);
    in direct-execution mode the cards are folded into the instruction instead
    so they still reach the model.
    """
    from .memory import memory_section

    goal = spec.instruction
    memory = memory_section(spec.memory)
    if memory:
        goal = goal + "\n\n" + memory
    if spec.reasoning or not spec.app_cards:
        return goal
    sections = []
    for card in spec.app_cards:
        package = str(card.get("packageName") or "").strip()
        content = str(card.get("content") or "").strip()
        if not package or not content:
            continue
        name = str(card.get("name") or "").strip()
        title = f"{name} ({package})" if name else package
        sections.append(f"### {title}\n{content}")
    if not sections:
        return goal
    return goal + "\n\nApp guidance:\n" + "\n\n".join(sections)


class MobilerunAgentRun:
    """Drives a real MobileAgent and yields normalized events."""

    def __init__(self, spec: RunSpec) -> None:
        from .memory import MemoryStore

        self.spec = spec
        self._handler: Any = None
        self.memory = MemoryStore(spec.memory)

    async def events(self) -> AsyncIterator[RunEvent]:
        import os

        from mobilerun.agent.droid import MobileAgent
        from mobilerun.config_manager import ConfigLoader

        import asyncio
        import shutil

        from .app_cards import write_app_cards_dir
        from .memory import memory_tools

        os.environ.setdefault("MOBILERUN_STREAM_SCREENSHOTS", "1")
        spec = self.spec
        cards_dir = write_app_cards_dir(spec.app_cards) if spec.reasoning else None

        def build() -> "MobileAgent":
            # Config loading and agent construction do file IO and LLM client setup;
            # keep them off the event loop so other streams stay responsive.
            config = ConfigLoader.load()
            config.agent.max_steps = spec.max_steps
            config.agent.reasoning = spec.reasoning
            config.agent.fast_agent.vision = spec.vision
            config.agent.manager.vision = spec.vision
            config.agent.executor.vision = spec.vision
            config.device.serial = spec.device_serial
            config.logging.save_trajectory = "none"
            if cards_dir is not None:
                config.agent.app_cards.enabled = True
                config.agent.app_cards.mode = "local"
                config.agent.app_cards.app_cards_dir = str(cards_dir)
            return MobileAgent(
                goal=compose_goal(spec),
                config=config,
                variables=spec.variables or None,
                prompts=spec.prompts or None,
                custom_tools=memory_tools(self.memory),
                timeout=max(600, spec.max_steps * 90),
            )

        try:
            agent = await asyncio.to_thread(build)
            handler = agent.run()
            self._handler = handler
            step_counter = [0]
            async for raw in handler.stream_events():
                mapped = map_framework_event(raw, step_counter)
                if mapped is not None:
                    yield mapped
                # A memory tool ran inside the step that produced this event;
                # stream its edits right away so the app persists them even if
                # the run later fails.
                for change in self.memory.drain():
                    yield change
            result = await handler
            for change in self.memory.drain():
                yield change
            yield RunEvent(
                "result",
                {"success": bool(result.success), "reason": result.reason, "steps": int(result.steps)},
            )
        finally:
            if cards_dir is not None:
                shutil.rmtree(cards_dir, ignore_errors=True)

    async def cancel(self) -> None:
        if self._handler is not None:
            try:
                await self._handler.cancel_run()
            except Exception:  # noqa: BLE001 - best effort; the task is cancelled regardless
                pass

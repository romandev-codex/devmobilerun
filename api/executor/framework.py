"""Adapter boundary between the executor and the mobilerun framework.

Everything the executor needs from the framework goes through the ``Framework``
protocol so tests can substitute a scripted fake at the HTTP seam.
"""

from __future__ import annotations

import base64
import json
import re
from dataclasses import dataclass, field, replace
from typing import Any, AsyncIterator, Protocol

from .events import RunEvent


@dataclass(frozen=True)
class LlmProfile:
    role: str
    provider: str
    model: str


@dataclass(frozen=True)
class JevSummary:
    """Whether the executor can run TypeSafe's Jev, and with which model."""

    configured: bool
    model: str
    provider: str = "TypeSafe"


@dataclass(frozen=True)
class ConfigSummary:
    profiles: list[LlmProfile]
    config_path: str | None
    jev: JevSummary | None = None


@dataclass(frozen=True)
class DeviceInfo:
    serial: str
    state: str  # raw adb state: device | offline | unauthorized | ...
    model: str | None = None


@dataclass(frozen=True)
class DeviceUser:
    """One Android user (a "profile") on a device, as ``pm list users`` reports it."""

    id: int
    name: str
    running: bool
    current: bool


@dataclass(frozen=True)
class PortalInstall:
    """The outcome of installing the Mobilerun Portal into one Android user."""

    user_id: int
    """The version the Portal reports once installed; None when it could not be read."""
    version: str | None
    accessibility_enabled: bool


@dataclass(frozen=True)
class RunSpec:
    run_id: str
    device_serial: str
    instruction: str
    """Name of the Android user to run under; created on the device when missing."""
    device_user: str | None = None
    """Which engine drives the phone: the mobilerun agent or TypeSafe's Jev."""
    agent: str = "mobilerun"
    start_url: str | None = None
    """The task's closing step, run after the goal whatever the goal did."""
    end_instruction: str | None = None
    vision: bool = False
    reasoning: bool = False
    max_steps: int = 15
    variables: dict[str, str] = field(default_factory=dict)
    prompts: dict[str, str] = field(default_factory=dict)
    app_cards: list[dict[str, Any]] = field(default_factory=list)
    memory: dict[str, str] = field(default_factory=dict)
    """Where this phase starts numbering screenshots; set for the end phase so
    its steps continue the goal's rather than restarting at zero."""
    step_offset: int = 0
    """The part of ``instruction`` this phase acts on when the rest is context;
    the end phase sets it to the end instruction."""
    focus: str | None = None


#: How long a user switch may take before it is reported as failed. A first
#: switch to a new user boots that user, which takes a while on real phones.
SWITCH_USER_TIMEOUT_SECONDS = 120.0
SWITCH_USER_POLL_SECONDS = 1.0
#: How long to wait for a freshly installed Portal to answer with its version.
PORTAL_VERSION_TIMEOUT_SECONDS = 10.0
PORTAL_VERSION_POLL_SECONDS = 1.0
#: Pause after the user is unlocked, for the launcher to come up before HOME is pressed.
SWITCH_USER_SETTLE_SECONDS = 2.0

#: The end step is cleanup, not a second goal, so it gets a small budget of its
#: own — a task that spent every step on the goal can still be tidied up.
END_PHASE_MAX_STEPS = 10


class DeviceNotFound(Exception):
    """Raised when a serial is not in the adb device list."""


class DeviceUserError(Exception):
    """Raised when the device refuses to create or switch to a user; carries adb's message."""


class PortalInstallError(Exception):
    """Raised when the Portal APK cannot be fetched or installed; carries the cause."""


def parse_portal_version(output: str) -> str | None:
    """Reads the Portal's version from its ``content query --uri .../version`` output.

    The provider answers ``Row: 0 result={"status":"success","result":"1.0.0"}``;
    older builds answer ``Row: 0 version=1.0.0``. Anything else (a stopped
    user, a provider that is not up yet) reads as no version.
    """
    match = re.search(r"result=(\{.*\})", output)
    if match:
        try:
            data = json.loads(match.group(1))
        except ValueError:
            data = None
        if isinstance(data, dict) and data.get("status") == "success":
            value = data.get("result") or data.get("data")
            return str(value) if value else None
    match = re.search(r"\bversion=([\w.\-+]+)", output)
    return match.group(1) if match else None


class DeviceUserNotFound(Exception):
    """Raised when a user id is not on the device."""


_USER_LINE_RE = re.compile(r"UserInfo\{(\d+):(.*):[0-9a-fA-F]+\}(\s+running)?")


def parse_user_list(output: str, current_id: int | None) -> list[DeviceUser]:
    """Reads the users from ``pm list users`` output.

    Each user is one ``UserInfo{id:name:flags}`` line, followed by ``running``
    when that user is started. ``current_id`` (from ``am get-current-user``)
    marks the user in the foreground.
    """
    users: list[DeviceUser] = []
    for match in _USER_LINE_RE.finditer(output):
        user_id = int(match.group(1))
        users.append(
            DeviceUser(
                id=user_id,
                name=match.group(2).strip(),
                running=match.group(3) is not None,
                current=user_id == current_id,
            )
        )
    return users


def parse_created_user_id(output: str) -> int:
    """Reads the new id from ``pm create-user`` output (``Success: created user id 11``)."""
    match = re.search(r"Success: created user id (\d+)", output)
    if not match:
        raise DeviceUserError(output.strip() or "pm create-user produced no output")
    return int(match.group(1))


def _unknown_option(output: str) -> bool:
    """Whether ``am`` rejected a flag it does not know (older Android)."""
    lowered = output.lower()
    return "unknown option" in lowered or "unknown argument" in lowered or "bad option" in lowered


def _unknown_command(output: str) -> bool:
    """Whether ``am`` rejected the command itself (older Android)."""
    lowered = output.lower()
    return "unknown command" in lowered or "unknown option" in lowered or "usage:" in lowered


def _device_is_gone(exc: Exception) -> bool:
    message = str(exc).lower()
    return "not found" in message or "offline" in message or "unauthorized" in message


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

    async def list_users(self, serial: str) -> list[DeviceUser]: ...

    async def create_user(self, serial: str, name: str) -> DeviceUser: ...

    async def switch_user(self, serial: str, user_id: int) -> None: ...

    async def remove_user(self, serial: str, user_id: int) -> None: ...

    async def install_portal(self, serial: str, user_id: int) -> PortalInstall: ...

    async def open_url(self, serial: str, url: str) -> None: ...

    async def wake(self, serial: str) -> None: ...

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
        from .jev import jev_config

        jev = jev_config()
        return ConfigSummary(
            profiles=profiles,
            config_path=config_path,
            jev=JevSummary(configured=jev.configured, model=jev.model, provider=jev.provider),
        )

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
            if _device_is_gone(exc):
                raise DeviceNotFound(serial) from exc
            raise

    async def _shell(self, serial: str, args: list[str]) -> str:
        """Runs one shell command on the device; a missing device raises DeviceNotFound."""
        from async_adbutils import adb
        from async_adbutils.errors import AdbError

        try:
            device = await adb.device(serial=serial)
            output = await device.shell(args)
        except AdbError as exc:
            if _device_is_gone(exc):
                raise DeviceNotFound(serial) from exc
            raise
        return output if isinstance(output, str) else str(output)

    async def battery_temperature(self, serial: str) -> float | None:
        return parse_battery_temperature(await self._shell(serial, ["dumpsys", "battery"]))

    async def _current_user(self, serial: str) -> int | None:
        raw = (await self._shell(serial, ["am", "get-current-user"])).strip()
        return int(raw) if raw.isdigit() else None

    async def list_users(self, serial: str) -> list[DeviceUser]:
        output = await self._shell(serial, ["pm", "list", "users"])
        return parse_user_list(output, await self._current_user(serial))

    async def create_user(self, serial: str, name: str) -> DeviceUser:
        """Creates a full user; when the device refuses (user limit, restricted
        profiles), a guest user of the same name is created instead."""
        output = await self._shell(serial, ["pm", "create-user", name])
        try:
            user_id = parse_created_user_id(output)
        except DeviceUserError as first:
            output = await self._shell(serial, ["pm", "create-user", "--guest", name])
            try:
                user_id = parse_created_user_id(output)
            except DeviceUserError as second:
                raise DeviceUserError(f"{first}; as guest: {second}") from None
        return DeviceUser(id=user_id, name=name, running=False, current=False)

    async def remove_user(self, serial: str, user_id: int) -> None:
        output = await self._shell(serial, ["pm", "remove-user", "-f", str(user_id)])
        if "success" not in output.lower():
            raise DeviceUserError(output.strip() or f"pm remove-user gave no answer for user {user_id}")

    async def switch_user(self, serial: str, user_id: int) -> None:
        """Brings the user to the foreground and waits for the switch to complete.

        ``am switch-user -w`` blocks until the switch is done on devices that
        support the flag; older ones are asked without it. Either way the device
        is then polled until it reports the user as current and unlocked, since
        the foreground changes before the user has finished starting.
        """
        import asyncio

        output = await self._shell(serial, ["am", "switch-user", "-w", str(user_id)])
        if _unknown_option(output):
            output = await self._shell(serial, ["am", "switch-user", str(user_id)])
        if "error" in output.lower():
            raise DeviceUserError(output.strip())
        deadline = asyncio.get_running_loop().time() + SWITCH_USER_TIMEOUT_SECONDS
        while True:
            if await self._current_user(serial) == user_id and await self._user_unlocked(serial, user_id):
                await asyncio.sleep(SWITCH_USER_SETTLE_SECONDS)
                return
            if asyncio.get_running_loop().time() >= deadline:
                raise DeviceUserError(
                    f"Device did not finish switching to user {user_id} within {SWITCH_USER_TIMEOUT_SECONDS:.0f}s"
                )
            await asyncio.sleep(SWITCH_USER_POLL_SECONDS)

    async def _user_unlocked(self, serial: str, user_id: int) -> bool:
        """Whether the user has finished starting (``RUNNING_UNLOCKED``).

        ``am get-started-user-state`` reports it on Android 10 and later; on
        devices without the command the ``running`` mark from ``pm list users``
        is the best available signal.
        """
        output = await self._shell(serial, ["am", "get-started-user-state", str(user_id)])
        if _unknown_command(output):
            users = parse_user_list(await self._shell(serial, ["pm", "list", "users"]), user_id)
            return any(u.id == user_id and u.running for u in users)
        return "RUNNING_UNLOCKED" in output

    async def install_portal(self, serial: str, user_id: int) -> PortalInstall:
        """Installs (or reinstalls) the Mobilerun Portal for one Android user.

        The APK is the one ``mobilerun setup`` would pick for the installed
        framework version. It is installed with ``pm install --user`` so the
        other users on the phone keep whatever they have, and the accessibility
        service is enabled for that user only, since the setting is per user.
        """
        import asyncio
        import contextlib

        from async_adbutils import adb
        from async_adbutils.errors import AdbError
        from mobilerun_core_local import __version__ as core_version
        from mobilerun_core_local.driver.android.portal import (
            A11Y_SERVICE_NAME,
            PORTAL_PACKAGE_NAME,
            download_portal_apk,
            download_versioned_portal_apk,
            get_compatible_portal_version,
            portal_content_uri,
        )

        uid = str(user_id)

        def fetch_apk(stack: contextlib.ExitStack) -> str:
            version, download_base, _ = get_compatible_portal_version(core_version)
            apk = (
                download_versioned_portal_apk(version, download_base)
                if version
                else download_portal_apk()
            )
            return stack.enter_context(apk)

        with contextlib.ExitStack() as stack:
            try:
                # The download is blocking (requests); keep the event loop free.
                apk_path = await asyncio.to_thread(fetch_apk, stack)
            except Exception as exc:  # whatever failed, the caller needs the reason
                raise PortalInstallError(f"Could not download the Portal APK: {exc}") from exc
            try:
                device = await adb.device(serial=serial)
                await device.install(
                    apk_path,
                    nolaunch=True,
                    silent=True,
                    flags=["-r", "-g", "-d", "--user", uid],
                )
            except AdbError as exc:
                if _device_is_gone(exc):
                    raise DeviceNotFound(serial) from exc
                raise PortalInstallError(f"Portal installation failed: {exc}") from exc

        for setting, value in (
            ("enabled_accessibility_services", A11Y_SERVICE_NAME),
            ("accessibility_enabled", "1"),
        ):
            await self._shell(serial, ["settings", "--user", uid, "put", "secure", setting, value])
        enabled = await self._shell(
            serial, ["settings", "--user", uid, "get", "secure", "enabled_accessibility_services"]
        )
        accessibility_enabled = A11Y_SERVICE_NAME in enabled

        # The version is read from the Portal's content provider, which comes up
        # once the accessibility service starts; give it a moment.
        version: str | None = None
        query = [
            "content", "query", "--user", uid,
            "--uri", portal_content_uri(PORTAL_PACKAGE_NAME, "version"),
        ]
        deadline = asyncio.get_running_loop().time() + PORTAL_VERSION_TIMEOUT_SECONDS
        while version is None:
            try:
                version = parse_portal_version(await self._shell(serial, query))
            except AdbError:  # the provider is not up yet
                version = None
            if version is not None or asyncio.get_running_loop().time() >= deadline:
                break
            await asyncio.sleep(PORTAL_VERSION_POLL_SECONDS)
        return PortalInstall(
            user_id=user_id, version=version, accessibility_enabled=accessibility_enabled
        )

    async def open_url(self, serial: str, url: str) -> None:
        from async_adbutils import adb

        device = await adb.device(serial=serial)
        await device.shell(["am", "start", "-a", "android.intent.action.VIEW", "-d", url])

    async def wake(self, serial: str) -> None:
        """Presses HOME: turns a sleeping screen on and leaves the device on the home screen."""
        from async_adbutils import adb

        device = await adb.device(serial=serial)
        await device.shell(["input", "keyevent", "KEYCODE_HOME"])

    def create_run(self, spec: RunSpec) -> AgentRun:
        if spec.agent == "jev":
            from .jev import JevAgentRun

            return JevAgentRun(spec)
        return MobilerunAgentRun(spec)


def map_framework_event(event: Any, step_counter: list[int]) -> RunEvent | None:
    """Translates a llama-index workflow event from the framework into a RunEvent.

    ``step_counter`` is a one-element list holding the running screenshot index;
    the caller owns it so the mapper needs no state of its own.
    """
    from mobilerun.agent.common.events import (
        RecordUIStateEvent,
        ScreenshotEvent,
        ToolExecutionEvent,
    )
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
    if isinstance(event, RecordUIStateEvent):
        # The indexed element tree the agent picks `click(index)` targets from.
        # It follows the step's screenshot, so it belongs to the last step
        # counted; kept so a run export shows what index N resolved to.
        return RunEvent(
            "ui_state",
            {"step": max(step_counter[0] - 1, 0), "elements": _jsonable(event.ui_state)},
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
    if spec.reasoning:
        return goal
    sections = []
    for card in relevant_app_cards(spec):
        package, name = card["packageName"], card["name"]
        title = f"{name} ({package})" if name else package
        sections.append(f"### {title}\n{card['content']}")
    if not sections:
        return goal
    return goal + "\n\nApp guidance:\n" + "\n\n".join(sections)


#: Package name parts too common to say which app a task is about.
_GENERIC_PACKAGE_PARTS = frozenset(
    {"com", "org", "net", "io", "co", "android", "google", "app", "apps", "mobile", "client", "lite", "free", "beta"}
)


def usable_app_cards(cards: list[dict[str, Any]]) -> list[dict[str, str]]:
    """The cards with both a package and content, normalized to plain strings."""
    usable = []
    for card in cards:
        package = str(card.get("packageName") or "").strip()
        content = str(card.get("content") or "").strip()
        if package and content:
            usable.append({"packageName": package, "name": str(card.get("name") or "").strip(), "content": content})
    return usable


def _mentions(text: str, term: str) -> bool:
    return re.search(rf"(?<![a-z0-9]){re.escape(term)}(?![a-z0-9])", text) is not None


def relevant_app_cards(spec: RunSpec) -> list[dict[str, str]]:
    """The cards for apps the task names, for modes that put cards in the goal.

    Direct mode cannot load a card when an app comes to the foreground, so the
    cards go into the goal up front; only those whose package, name or a
    distinctive package part ("instagram" in com.instagram.android) appears in
    the goal, start URL or end step are included, keeping unrelated apps' notes
    out of every prompt.
    """
    text = " ".join(filter(None, [spec.instruction, spec.start_url, spec.end_instruction])).lower()
    relevant = []
    for card in usable_app_cards(spec.app_cards):
        package = card["packageName"].lower()
        terms = {package, card["name"].lower()} | {
            part for part in package.split(".") if len(part) >= 4 and part not in _GENERIC_PACKAGE_PARTS
        }
        if any(term and _mentions(text, term) for term in terms):
            relevant.append(card)
    return relevant


def app_card_event(card: dict[str, str], via: str) -> RunEvent:
    """Reports that a card reached the model: ``via`` is "goal" or "foreground"."""
    return RunEvent("app_card", {"packageName": card["packageName"], "name": card["name"], "via": via})


def compose_end_instruction(spec: RunSpec) -> str:
    """The goal for the end phase.

    The end step runs as its own agent session, so it is given the finished task
    as context — an instruction like "report the total" means nothing on its own
    — together with the standing that the task itself is over. How the goal ended
    is deliberately left open: the step is owed either way.
    """
    return (
        "An earlier agent session on this device worked on the task below.\n\n"
        f"{spec.instruction.strip()}\n\n"
        "That work is finished and is no longer yours to continue — it may have "
        "succeeded, failed, or run out of steps. Carry out only this final "
        f"step, then stop:\n\n{(spec.end_instruction or '').strip()}"
    )


def end_phase_spec(spec: RunSpec, step_offset: int = 0) -> RunSpec:
    """The spec for the end phase, derived from the run it closes.

    It keeps the device, agent options, variables, prompts, cards and memory of
    the run, and drops what belongs to the goal alone: the start URL (already
    opened), the end instruction itself (it is now the goal) and most of the
    step budget.
    """
    return replace(
        spec,
        instruction=compose_end_instruction(spec),
        start_url=None,
        end_instruction=None,
        focus=spec.end_instruction,
        max_steps=max(1, min(spec.max_steps, END_PHASE_MAX_STEPS)),
        step_offset=step_offset,
    )


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

        try:
            from mobilerun.agent.manager.events import ManagerAppCardEvent

            card_events: tuple[type, ...] = (ManagerAppCardEvent,)
        except ImportError:  # a framework build without the event reports no cards
            card_events = ()

        import asyncio
        import shutil

        from .app_cards import write_app_cards_dir
        from .memory import memory_tools

        os.environ.setdefault("MOBILERUN_STREAM_SCREENSHOTS", "1")
        spec = self.spec
        cards_dir = write_app_cards_dir(spec.app_cards) if spec.reasoning else None
        # Reasoning mode loads a card whenever its app is in the foreground; each
        # card is reported the first time the manager actually loads it.
        cards_by_package = {c["packageName"]: c for c in usable_app_cards(spec.app_cards)}

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
            step_counter = [spec.step_offset]
            if not spec.reasoning:
                for card in relevant_app_cards(spec):
                    yield app_card_event(card, "goal")
            async for raw in handler.stream_events():
                mapped = map_framework_event(raw, step_counter)
                if mapped is not None:
                    yield mapped
                if isinstance(raw, card_events):
                    card = cards_by_package.pop(raw.package_name, None)
                    if card is not None:
                        yield app_card_event(card, "foreground")
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

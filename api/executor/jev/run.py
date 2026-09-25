"""One Jev agent session: observe, decide, validate, act, repeat.

Emits the same RunEvents as the mobilerun agent (screenshot, ui_state, thought,
action, log, result), so the app stores and shows a Jev run like any other.
Jev's DONE is reported as the model's claim, not as independent verification.
"""

from __future__ import annotations

import asyncio
import base64
import logging
import os
import re
import time
from collections import Counter, defaultdict
from dataclasses import dataclass
from typing import Any, AsyncIterator, Callable

from ..events import RunEvent
from ..framework import app_card_event, usable_app_cards
from .actions import describe_action
from .advisor import Advisor, load_advisor
from .device import JevDevice, android_driver
from .policy import (
    _names_app,
    DEFAULT_BASE_URL,
    DEFAULT_MODEL,
    OPENROUTER_BASE_URL,
    PolicyError,
    Transport,
    TypeSafePolicy,
)
from .state import StaleObservationError, input_matches

logger = logging.getLogger(__name__)

SETTLE_TIMEOUT_S = 0.4
WAIT_TIMEOUT_S = 15.0
INPUT_TIMEOUT_S = 2.5
POLL_S = 0.06
REQUEST_TIMEOUT_S = 30.0
#: Taps of one element on an identical screen before it is no longer offered there. Returning
#: to a screen and tapping the same control once more is normal; a third time is a cycle.
MAX_TAPS_PER_SCREEN = 2
#: Executions of one non-tap action (BACK, HOME, OPEN_APP, a scroll) on an identical screen before the
#: session stops. Taps are covered by MAX_TAPS_PER_SCREEN; this catches loops such as HOME → open the
#: app → HOME → open the app, which never leave a screen unchanged and so never look stuck.
MAX_REPEATS_PER_SCREEN = 3
#: Advisor notes older than this many actions are no longer shown to Jev: a stale "currently
#: viewing X" misleads more than no notes at all.
NOTES_MAX_AGE = 5

#: Why a session ended, as the run's result reason. ``done`` is the only success.
OUTCOMES = {
    "done": "Jev reported the goal complete (model-declared, not independently verified).",
    "blocked": "Jev found no supported operation that can progress.",
    "needs_input": "Jev needs a text value that is not in the goal.",
    "uncertain": "Jev's confidence was below the threshold.",
    "step_limit": "Reached the step limit.",
    "stuck": "Jev repeated an action on an unchanged screen.",
    "cycle": "Jev kept repeating the same action on the same screen, going round in a loop.",
    "loading_timeout": "The screen kept loading past the wait limit.",
    "unstable_screen": "The screen kept changing before an action could be executed.",
    "input_unverified": "Text was sent, but the field did not show the complete value. Inspect the screen before retrying.",
    "decision_limit": "Reached the model-call limit.",
}


@dataclass(frozen=True)
class JevConfig:
    api_key: str
    model: str
    base_url: str = DEFAULT_BASE_URL

    @property
    def provider(self) -> str:
        return "OpenRouter" if self.base_url.startswith("https://openrouter.ai/") else "TypeSafe"

    @property
    def configured(self) -> bool:
        return bool(self.api_key)


def jev_config() -> JevConfig:
    """Jev settings from the environment, named as the TypeSafe SDKs name them.

    ``TYPESAFE_BASE_URL=https://openrouter.ai/api`` sends requests through
    OpenRouter, billed to the OpenRouter key; ``OPENROUTER_API_KEY`` then
    stands in when ``TYPESAFE_API_KEY`` is not set.
    """
    base_url = (os.environ.get("TYPESAFE_BASE_URL", "").strip() or OPENROUTER_BASE_URL).rstrip("/")
    api_key = os.environ.get("TYPESAFE_API_KEY", "").strip()
    if not api_key and base_url == OPENROUTER_BASE_URL:
        api_key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    return JevConfig(
        api_key=api_key,
        model=os.environ.get("TYPESAFE_MODEL", "").strip() or DEFAULT_MODEL,
        base_url=base_url,
    )


def httpx_transport(client: Any, config: JevConfig) -> Transport:
    """Posts to System One on one pooled connection, kept warm across decisions."""
    url = f"{config.base_url}/v1/systemone"
    api_key = config.api_key

    async def send(body: dict[str, Any]) -> Any:
        response = await client.post(
            url,
            json=body,
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=REQUEST_TIMEOUT_S,
        )
        if response.status_code < 200 or response.status_code >= 300:
            detail = ""
            try:
                error = response.json().get("error")
                detail = error.get("message", "") if isinstance(error, dict) else str(error or "")
            except Exception:  # noqa: BLE001 - the status alone is still worth reporting
                pass
            raise PolicyError(f"{config.provider} returned HTTP {response.status_code}{': ' + detail if detail else ''}")
        return response.json()

    return send


def _ui_elements(observation: dict[str, Any]) -> list[dict[str, Any]]:
    """The observed elements in the app's ``ui_state`` shape."""
    out = []
    for e in observation["elements"]:
        b = e["bounds"]
        item: dict[str, Any] = {
            "index": e["id"],
            "text": e["text"] or e["label"],
            "resourceId": e["resourceId"],
            "bounds": f"{b['left']},{b['top']},{b['right']},{b['bottom']}",
        }
        if e["scrollable"]:
            item["scrollable"] = True
        if e["checkable"]:
            item["checkedState"] = "checked" if e["checked"] else "unchecked"
        out.append(item)
    return out


def _decision_text(decision: dict[str, Any]) -> tuple[str, str]:
    operation = decision["operation"]
    text = f"{operation}: {decision['label']}" if decision.get("label") else operation
    if decision.get("reason"):
        text += f" — {decision['reason']}"
    parts = [f"confidence {decision['confidence']:.2f}"]
    if decision.get("targetConfidence") is not None:
        parts.append(f"target {decision['targetConfidence']:.2f}")
    parts.append(f"{decision['latencyMs']:.0f} ms")
    parts.append(decision.get("responseModel") or decision["requestedModel"])
    if decision.get("advisor"):
        advisor = decision["advisor"]
        parts.append(f"advised by {advisor['model']}{': ' + advisor['reason'] if advisor['reason'] else ''}")
    return text, " · ".join(parts)


def _app_card(cards: list[dict[str, Any]], package: str) -> dict[str, str] | None:
    for card in usable_app_cards(cards):
        if card["packageName"] == package:
            return card
    return None


#: A goal that only asks to close an app: "close app", "Close the Instagram app", "quit instagram".
_CLOSE_APP = re.compile(
    r"^\s*(?:please\s+)?(?:close|exit|quit|kill|force[- ]?stop)\s+(?:the\s+)?(?P<name>.*?)\s*[.!]?\s*$",
    re.IGNORECASE,
)
_GENERIC_APP = {"", "app", "application", "it", "this app", "the app", "current app"}


def _is_launcher(package: str) -> bool:
    return not package or "launcher" in package.lower() or package == "com.android.systemui"


def close_app_target(
    instruction: str, context: str, foreground: str, apps: list[dict[str, str]]
) -> dict[str, str] | None:
    """The app a "close the app" instruction means, or ``None`` when the model should handle it.

    A named app wins; "the app" means the foreground app, or, from the home screen, the one app the
    surrounding task (``context``) names. Closing is done in code: a model asked to "close app" from
    a context that names the app tends to open it again to find a close button.
    """
    match = _CLOSE_APP.match(instruction or "")
    if not match:
        return None
    name = re.sub(r"\s+(?:app|application)$", "", match.group("name").strip(), flags=re.IGNORECASE)
    if name.lower() not in _GENERIC_APP:
        named = [a for a in apps if a["label"].strip().lower() == name.lower()]
        return named[0] if len(named) == 1 else None
    if not _is_launcher(foreground):
        return next((a for a in apps if a["packageName"] == foreground), None)
    named = [a for a in apps if _names_app(context, a["label"])]
    return named[0] if len(named) == 1 else None


class JevAgentRun:
    """Drives Jev on a local phone and yields normalized events."""

    def __init__(
        self,
        spec: Any,
        *,
        config: JevConfig | None = None,
        device: JevDevice | None = None,
        transport: Transport | None = None,
        advisor: Advisor | None = None,
        sleep: Callable[[float], Any] = asyncio.sleep,
    ) -> None:
        self.spec = spec
        self.config = config or jev_config()
        self._device = device
        self._transport = transport
        self._advisor = advisor
        self._sleep = sleep

    async def events(self) -> AsyncIterator[RunEvent]:
        if self._transport is not None:
            async for event in self._session(self._transport):
                yield event
            return
        if not self.config.configured:
            raise RuntimeError(
                "No Jev API key on the executor: set TYPESAFE_API_KEY, or TYPESAFE_BASE_URL="
                f"{OPENROUTER_BASE_URL} with OPENROUTER_API_KEY."
            )
        import httpx

        if self._advisor is None:
            try:
                # Client setup reads config files; keep it off the event loop.
                self._advisor = await asyncio.to_thread(load_advisor)
            except Exception as exc:  # noqa: BLE001 - Jev still runs alone
                logger.warning("jev advisor unavailable: %s", exc)
                yield RunEvent("log", {"message": f"Jev advisor unavailable, running alone: {exc}"})
        async with httpx.AsyncClient() as client:
            async for event in self._session(httpx_transport(client, self.config)):
                yield event

    async def cancel(self) -> None:
        # Nothing runs outside the run's task: cancelling it stops the session
        # between awaits, and no action is ever retried afterwards.
        return None

    async def _session(self, transport: Transport) -> AsyncIterator[RunEvent]:
        spec = self.spec
        device = self._device or JevDevice(android_driver(spec.device_serial), spec.device_serial)
        advisor = self._advisor
        policy = TypeSafePolicy(transport, model=self.config.model, advisor=advisor)
        max_steps = spec.max_steps
        goal = spec.instruction
        texts = [v for v in [*spec.variables.values(), *spec.memory.values()] if isinstance(v, str) and v.strip()]
        base_context: dict[str, Any] = {}
        if spec.variables:
            base_context["taskVariables"] = dict(spec.variables)
        if spec.memory:
            base_context["taskMemory"] = dict(spec.memory)

        step_index = spec.step_offset
        cards_reported: set[str] = set()
        history: list[dict[str, Any]] = []
        # Actions already tried on the current screen; cleared whenever the screen changes.
        repeated: set[str] = set()
        # Taps over the whole run: by screen fingerprint (cycle guard) and by package and label (hint).
        screen_taps: defaultdict[str, Counter[str]] = defaultdict(Counter)
        # Every non-tap action executed, by screen and action, over the whole run (cycle guard).
        executed: Counter[str] = Counter()
        label_taps: defaultdict[str, Counter[str]] = defaultdict(Counter)
        consecutive_waits = consecutive_stale = 0
        waiting_since: float | None = None

        def result(status: str, decision: dict[str, Any] | None = None) -> RunEvent:
            reason = OUTCOMES.get(status, status)
            if decision and decision.get("reason") and status != "done":
                reason = f"{reason} {decision['reason']}"
            return RunEvent("result", {"success": status == "done", "reason": reason, "steps": len(history)})

        async def screenshot() -> bytes | None:
            try:
                return await device.screenshot()
            except Exception:  # noqa: BLE001 - a missing image must not stop the agent
                logger.debug("jev screenshot failed", exc_info=True)
                return None

        await device.connect()
        observation, installed_apps = await asyncio.gather(device.observe(), device.list_apps())
        yield RunEvent("log", {"message": f"Jev ({self.config.model} via {self.config.provider}) on {len(installed_apps)} installed apps"})
        if advisor is not None:
            yield RunEvent("log", {"message": f"Jev advisor: {advisor.model} (asked when Jev is unsure)"})

        close = close_app_target(
            spec.focus or goal, goal, observation["phone"]["packageName"], installed_apps
        )
        if close is not None:
            async for event in self._close_app(device, close, observation, step_index, screenshot):
                yield event
            return

        # Wake the device before the first decision; a failed press is not fatal.
        try:
            await device.wake()
        except Exception as exc:  # noqa: BLE001 - the task may still run on an awake screen
            yield RunEvent("log", {"message": f"HOME press to wake the device failed: {exc}"})
        else:
            yield RunEvent("log", {"message": "Pressed HOME to wake the device"})
            deadline = time.monotonic() + SETTLE_TIMEOUT_S
            woken = await device.observe()
            # Let the launcher replace the previous screen before Jev looks at it.
            while (
                (woken["fingerprint"] == observation["fingerprint"] or not woken["phone"]["packageName"])
                and time.monotonic() + POLL_S < deadline
            ):
                await self._sleep(POLL_S)
                woken = await device.observe()
            observation = woken

        # Stale decisions never dispatch input, but still consume a separate model-call budget.
        for _attempt in range(max_steps * 2 + 4):
            context = dict(base_context)
            card = _app_card(spec.app_cards, observation["phone"]["packageName"])
            if card is not None:
                context["appGuidance"] = card["content"][:4000]
                if card["packageName"] not in cards_reported:
                    cards_reported.add(card["packageName"])
                    yield app_card_event(card, "foreground")
            if (
                advisor is not None
                and advisor.notes
                and advisor.notes_step is not None
                and len(history) - advisor.notes_step <= NOTES_MAX_AGE
            ):
                context["progressNotes"] = advisor.notes
            decision, png = await asyncio.gather(
                policy.decide(
                    goal=goal,
                    observation=observation,
                    history=history,
                    texts=texts,
                    apps=installed_apps,
                    context=context,
                    app_goal=spec.focus,
                    tapped=label_taps[observation["phone"]["packageName"]],
                    exclude={
                        element_id
                        for element_id, count in screen_taps[observation["fingerprint"]].items()
                        if count >= MAX_TAPS_PER_SCREEN
                    },
                ),
                screenshot(),
            )
            if png is not None:
                yield RunEvent("screenshot", {"step": step_index, "png": base64.b64encode(png).decode("ascii")})
            yield RunEvent("ui_state", {"step": step_index, "elements": _ui_elements(observation)})
            step_index += 1
            if decision.get("jevError"):
                yield RunEvent("log", {"message": f"Jev answer unusable, the advisor decided: {decision['jevError']}"})
            if decision.get("advisorError"):
                yield RunEvent("log", {"message": f"Jev advisor failed, using Jev's answer: {decision['advisorError']}"})
            text, description = _decision_text(decision)
            yield RunEvent("thought", {"text": text, "description": description, "source": "jev"})

            if decision["status"] != "action":
                yield result(decision["status"], decision)
                return
            if len(history) >= max_steps:
                yield result("step_limit")
                return
            action = decision["action"]
            is_wait = action["type"] == "wait"
            label = decision.get("label") or describe_action(action, observation)
            signature = f"{observation['fingerprint']}:{action}"
            if not is_wait and signature in repeated:
                yield result("stuck", decision)
                return
            loops = not is_wait and action["type"] != "tap-element"
            if loops and executed[signature] >= MAX_REPEATS_PER_SCREEN:
                yield result("cycle", decision)
                return
            if is_wait:
                waiting_since = waiting_since or time.monotonic()
                if time.monotonic() - waiting_since >= WAIT_TIMEOUT_S:
                    yield result("loading_timeout", decision)
                    return
            else:
                waiting_since = None

            receipt = None
            try:
                if is_wait:
                    remaining = WAIT_TIMEOUT_S - (time.monotonic() - (waiting_since or time.monotonic()))
                    await self._sleep(max(0.0, min(0.1 * 2 ** min(consecutive_waits, 4), 1.0, remaining)))
                else:
                    receipt = await device.act(action, expected=observation)
            except StaleObservationError:
                if (consecutive_stale := consecutive_stale + 1) >= 3:
                    yield result("unstable_screen", decision)
                    return
                yield RunEvent("log", {"message": "Screen changed before acting; deciding again"})
                observation = await device.observe()
                continue
            except Exception as exc:  # noqa: BLE001 - an uncertain mutation is never retried
                yield RunEvent(
                    "action",
                    {
                        "tool": decision["operation"].lower(),
                        "args": action,
                        "success": False,
                        "summary": f"{label} — {type(exc).__name__}: {exc}",
                    },
                )
                yield RunEvent(
                    "result",
                    {"success": False, "reason": f"Action failed: {exc}", "steps": len(history)},
                )
                return
            consecutive_stale = 0
            repeated.add(signature)
            if loops:
                executed[signature] += 1
            consecutive_waits = consecutive_waits + 1 if is_wait else 0
            entry: dict[str, Any] = {
                "operation": decision["operation"],
                "label": label,
                "before": observation["fingerprint"],
                "screenChanged": None,
            }
            if action["type"] == "type":
                entry["text"] = action["text"]
            if action["type"] == "tap-element":
                screen_taps[observation["fingerprint"]][action["elementId"]] += 1
                label_taps[observation["phone"]["packageName"]][label] += 1
            history.append(entry)
            # Report the mutation before observing: a failed read must not erase an executed action.
            yield RunEvent(
                "action",
                {"tool": decision["operation"].lower(), "args": action, "success": True, "summary": label},
            )

            after = await device.observe()
            verification = (receipt or {}).get("inputVerification")
            if verification:
                deadline = time.monotonic() + INPUT_TIMEOUT_S
                while not input_matches(after, verification) and time.monotonic() < deadline:
                    await self._sleep(POLL_S)
                    after = await device.observe()
                if not input_matches(after, verification):
                    yield result("input_unverified", decision)
                    return
            deadline = time.monotonic() + SETTLE_TIMEOUT_S
            # Skip a transient system-bar-only snapshot (no foreground app) before asking Jev again.
            while (
                not is_wait
                and not verification
                and (after["fingerprint"] == observation["fingerprint"] or not after["phone"]["packageName"])
                and time.monotonic() + POLL_S < deadline
            ):
                await self._sleep(POLL_S)
                after = await device.observe()
            entry["screenChanged"] = after["fingerprint"] != observation["fingerprint"]
            if entry["screenChanged"]:
                # Returning to an earlier screen and repeating an action there is progress, not a loop.
                repeated.clear()
            observation = after
        yield result("decision_limit")

    async def _close_app(
        self,
        device: JevDevice,
        app: dict[str, str],
        observation: dict[str, Any],
        step: int,
        screenshot: Callable[[], Any],
    ) -> AsyncIterator[RunEvent]:
        """Closes ``app`` without asking a model: force-stop, then the home screen."""
        png = await screenshot()
        if png is not None:
            yield RunEvent("screenshot", {"step": step, "png": base64.b64encode(png).decode("ascii")})
        yield RunEvent("ui_state", {"step": step, "elements": _ui_elements(observation)})
        label = f"Close {app['label']}"
        yield RunEvent(
            "thought",
            {"text": f"CLOSE_APP: {label}", "description": "handled in code: force-stop, then home", "source": "jev"},
        )
        args = {"type": "close-app", "packageName": app["packageName"], "appLabel": app["label"]}
        try:
            await device.close_app(app["packageName"])
        except Exception as exc:  # noqa: BLE001 - reported, never retried
            yield RunEvent("action", {"tool": "close_app", "args": args, "success": False, "summary": f"{label} — {exc}"})
            yield RunEvent("result", {"success": False, "reason": f"Action failed: {exc}", "steps": 0})
            return
        yield RunEvent("action", {"tool": "close_app", "args": args, "success": True, "summary": label})
        yield RunEvent(
            "result",
            {"success": True, "reason": f"Closed {app['label']} (force-stopped, home screen shown).", "steps": 1},
        )

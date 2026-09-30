"""The Jev engine against a fake Portal driver and a scripted TypeSafe transport."""

from __future__ import annotations

import copy
import json
from typing import Any, Callable

import pytest

from executor.framework import RunSpec
from executor.jev.advisor import Advisor
from executor.jev.device import JevDevice
from executor.jev.policy import (
    PolicyError,
    TypeSafePolicy,
    build_questions,
    text_candidates,
    validate_choice,
)
from executor.jev.run import JevAgentRun, JevConfig, close_app_target, httpx_transport, jev_config
from executor.jev.state import StaleObservationError, assert_fresh, summarize_state

pytestmark = pytest.mark.anyio

SERIAL = "emulator-5554"
PNG = b"\x89PNG\r\n\x1a\nfake"


def node(bounds, children=(), **props) -> dict[str, Any]:
    left, top, right, bottom = bounds
    return {
        "boundsInScreen": {"left": left, "top": top, "right": right, "bottom": bottom},
        "isVisibleToUser": True,
        "isEnabled": True,
        "children": list(children),
        **props,
    }


def raw_state(*children, package="com.android.launcher", keyboard=False) -> dict[str, Any]:
    return {
        "a11y_tree": node((0, 0, 1080, 2400), children, className="android.widget.FrameLayout"),
        "phone_state": {"packageName": package, "currentApp": package, "keyboardVisible": keyboard},
        "device_context": {"screen_bounds": {"width": 1080, "height": 2400}},
    }


LAUNCHER = raw_state(
    node((0, 100, 540, 300), text="Settings", isClickable=True),
    node((540, 100, 1080, 300), text="Clock", isClickable=True),
)
SETTINGS = raw_state(
    node((0, 0, 1080, 200), text="Settings"),
    node((0, 200, 1080, 400), text="Display", isClickable=True),
    package="com.android.settings",
)


class FakeDriver:
    """A phone whose screen moves between raw Portal states as actions land."""

    def __init__(self, state: dict[str, Any], on_action: Callable[["FakeDriver", tuple], None] | None = None):
        self.state = state
        self.on_action = on_action or (lambda driver, action: None)
        self.actions: list[tuple] = []
        self.before_read: Callable[["FakeDriver"], None] | None = None

    async def connect(self) -> None:
        pass

    async def get_ui_tree(self) -> dict[str, Any]:
        if self.before_read:
            hook, self.before_read = self.before_read, None
            hook(self)
        return copy.deepcopy(self.state)

    async def get_apps(self, include_system: bool = True) -> list[dict[str, str]]:
        return [
            {"package": "com.android.settings", "label": "Settings"},
            {"package": "com.android.deskclock", "label": "Clock"},
        ]

    async def screenshot(self, hide_overlay: bool = True) -> bytes:
        return PNG

    async def _record(self, *action) -> None:
        self.actions.append(action)
        self.on_action(self, action)

    async def tap(self, x: int, y: int) -> None:
        await self._record("tap", x, y)

    async def swipe(self, x1, y1, x2, y2, duration_ms=1000) -> None:
        await self._record("swipe", x1, y1, x2, y2)

    async def input_text(self, text: str, clear: bool = False) -> bool:
        await self._record("type", text, clear)
        return True

    async def press_button(self, button: str) -> None:
        await self._record("button", button)

    async def press_key_code(self, key_code: int) -> None:
        await self._record("key", key_code)

    async def start_app(self, package: str, activity: str | None = None) -> str:
        await self._record("start_app", package)
        return "ok"

    async def stop_app(self, package: str) -> str:
        await self._record("stop_app", package)
        return "ok"


def answer(criteria: dict[str, Any], choice: str, confidence: float = 0.9) -> dict[str, Any]:
    top = confidence if len(criteria) > 1 else 1.0
    rest = (1 - top) / max(len(criteria) - 1, 1)
    return {
        "type": "choice",
        "choice": choice,
        "confidence": confidence,
        "probabilities": {k: (top if k == choice else rest) for k in criteria},
    }


def pick(criteria: dict[str, Any], text: str) -> str:
    """The criteria key whose description mentions ``text``."""
    return next(k for k, v in criteria.items() if text in str(v))


class ScriptedJev:
    """Answers each request with the next scripted (operation, target text) step."""

    def __init__(self, script: list[tuple[str, str | None]], confidence: float = 0.9):
        self.script = list(script)
        self.confidence = confidence
        self.bodies: list[dict[str, Any]] = []

    async def __call__(self, body: dict[str, Any]) -> dict[str, Any]:
        self.bodies.append(body)
        operation, target = self.script.pop(0)
        questions = body["questions"]
        answers = {"operation": answer(questions["operation"]["criteria"], operation, self.confidence)}
        head = {"TAP": "tap_target", "OPEN_APP": "app_target", "TYPE_TEXT": "text_value"}.get(operation)
        if operation.startswith("SCROLL_"):
            head = "scroll_target"
        if head:
            criteria = questions[head]["criteria"]
            answers[head] = answer(criteria, target if target in criteria else pick(criteria, target))
        return {"model": "jev-test", "answers": answers, "usage": {"input_tokens": 1}}


def spec(**overrides) -> RunSpec:
    base = dict(run_id="r1", device_serial=SERIAL, instruction="Open Settings", agent="jev", max_steps=5)
    base.update(overrides)
    return RunSpec(**base)


async def run_session(driver: FakeDriver, jev: ScriptedJev, advisor=None, **spec_overrides) -> list:
    agent = JevAgentRun(
        spec(**spec_overrides),
        config=JevConfig(api_key="k", model="jev-latest"),
        device=JevDevice(driver, SERIAL),
        transport=jev,
        advisor=advisor,
        sleep=_no_sleep,
    )
    return [e async for e in agent.events()]


async def _no_sleep(_: float) -> None:
    return None


# ── observation ──────────────────────────────────────────────────────────


def test_summarize_state_keeps_visible_meaningful_nodes_with_path_ids():
    raw = raw_state(
        node((0, 100, 540, 300), text="Settings", isClickable=True),
        node((0, 0, 0, 0), text="zero-size"),
        node((0, 300, 540, 500), text="hidden", isVisibleToUser=False),
        node((0, 500, 1080, 700), className="android.widget.EditText", hint="Search", isFocused=True),
        node((0, 700, 1080, 800), text="secret", isPassword=True, isEditable=True),
    )
    obs = summarize_state(raw, SERIAL)
    assert [e["id"] for e in obs["elements"]] == ["ui.0", "ui.3", "ui.4"]
    assert obs["elements"][1]["editable"] is True
    assert obs["elements"][2]["text"] == "[password]"
    assert obs["phone"]["inputElementId"] == "ui.3"
    assert obs["phone"]["focusEvidence"] == "focused-node"
    assert summarize_state(raw, SERIAL)["fingerprint"] == obs["fingerprint"]


def test_summarize_state_rejects_incomplete_state():
    with pytest.raises(ValueError):
        summarize_state({"a11y_tree": {}, "phone_state": {}, "device_context": {}}, SERIAL)


def test_assert_fresh_rejects_a_tap_whose_target_changed():
    before = summarize_state(LAUNCHER, SERIAL)
    changed = copy.deepcopy(LAUNCHER)
    changed["a11y_tree"]["children"][0]["text"] = "Something else"
    action = {"type": "tap-element", "elementId": "ui.0"}
    assert_fresh(summarize_state(LAUNCHER, SERIAL), before, action)
    with pytest.raises(StaleObservationError):
        assert_fresh(summarize_state(changed, SERIAL), before, action)


# ── policy ───────────────────────────────────────────────────────────────


def test_build_questions_offers_taps_apps_and_controls():
    obs = summarize_state(LAUNCHER, SERIAL)
    apps = [{"packageName": "com.android.settings", "label": "Settings"}]
    space = build_questions(obs, [], apps)
    ops = space["questions"]["operation"]["criteria"]
    assert {"OPEN_APP", "TAP", "BACK", "HOME", "WAIT", "DONE", "BLOCKED"} <= set(ops)
    assert "TYPE_TEXT" not in ops  # nothing is focused
    assert space["questions"]["tap_target"]["criteria"] == {"1": "[1] Settings", "2": "[2] Clock"}
    assert space["questions"]["app_target"]["criteria"] == {"1": "Settings (com.android.settings)"}


def test_build_questions_names_list_items_by_position_and_never_by_tree_path():
    grid = raw_state(
        node((0, 0, 1080, 120), text="Posts 11", isClickable=True, isSelected=True),
        node(
            (0, 120, 1080, 1200),
            [
                node((0, 120, 360, 600), [node((0, 540, 360, 590), text="1.6M")], resourceId="app:id/tile", isClickable=True),
                node((360, 120, 720, 600), resourceId="app:id/tile", isClickable=True),
                node((720, 120, 1080, 600), resourceId="app:id/tile", isClickable=True),
            ],
        ),
        node((0, 1200, 100, 1300), resourceId="app:id/k9w", isClickable=True),
        package="com.example.gallery",
    )
    criteria = build_questions(summarize_state(grid, SERIAL))["questions"]["tap_target"]["criteria"]
    assert criteria == {
        "1": "[1] Posts 11 (selected)",
        "2": "[2] item 1 of 3 in a list: 1.6M",
        "3": "[3] item 2 of 3 in a list",
        "4": "[4] item 3 of 3 in a list",
        "5": "[5] unlabeled control at (50, 1250)",
    }


def test_text_candidates_put_supplied_values_first_and_strip_punctuation():
    result = text_candidates('Search for "Berlin".', ["alice@example.com"])
    assert result["values"][0] == "alice@example.com"
    assert "Berlin" in result["values"]
    assert result["overflow"] is False


@pytest.mark.parametrize(
    "bad",
    [
        None,
        {"type": "choice", "choice": "X", "confidence": 0.9, "probabilities": {"A": 0.9, "B": 0.1}},
        {"type": "choice", "choice": "B", "confidence": 0.9, "probabilities": {"A": 0.9, "B": 0.1}},
        {"type": "choice", "choice": "A", "confidence": 0.9, "probabilities": {"A": 0.5, "B": 0.1}},
        {"type": "choice", "choice": "A", "confidence": 2, "probabilities": {"A": 0.9, "B": 0.1}},
    ],
)
def test_validate_choice_rejects_malformed_answers(bad):
    with pytest.raises(PolicyError):
        validate_choice(bad, {"A": "a", "B": "b"})


async def test_policy_sends_state_and_resolves_the_selected_branch():
    jev = ScriptedJev([("TAP", "Clock")])
    policy = TypeSafePolicy(jev)
    obs = summarize_state(LAUNCHER, SERIAL)
    decision = await policy.decide(goal="Open the clock", observation=obs, context={"taskMemory": {"a": "b"}})
    assert decision["status"] == "action"
    assert decision["action"] == {"type": "tap-element", "elementId": "ui.1"}
    assert decision["label"] == "Tap Clock."
    body = jev.bodies[0]
    assert body["model"] == "jev-latest"
    assert body["state"]["taskMemory"] == {"a": "b"}
    assert body["questions"]["operation"]["instructions"]["goal"] == "Open the clock"


async def test_policy_narrows_apps_to_those_named_in_the_goal():
    jev = ScriptedJev([("OPEN_APP", "Clock")])
    apps = [
        {"packageName": "com.android.settings", "label": "Settings"},
        {"packageName": "com.android.deskclock", "label": "Clock"},
    ]
    obs = summarize_state(LAUNCHER, SERIAL)
    decision = await TypeSafePolicy(jev).decide(goal="Set an alarm in Clock", observation=obs, apps=apps)
    assert jev.bodies[0]["questions"]["app_target"]["criteria"] == {"1": "Clock (com.android.deskclock)"}
    assert decision["action"] == {
        "type": "open-app",
        "packageName": "com.android.deskclock",
        "appLabel": "Clock",
    }


async def test_policy_narrows_apps_by_the_focus_when_the_goal_is_only_context():
    jev = ScriptedJev([("HOME", None)])
    apps = [
        {"packageName": "com.android.settings", "label": "Settings"},
        {"packageName": "com.android.deskclock", "label": "Clock"},
    ]
    obs = summarize_state(LAUNCHER, SERIAL)
    await TypeSafePolicy(jev).decide(
        goal="Earlier: set an alarm in Clock. Now: go to the home screen",
        observation=obs,
        apps=apps,
        app_goal="Go to the home screen",
    )
    assert len(jev.bodies[0]["questions"]["app_target"]["criteria"]) == 2  # Clock is not singled out


# ── session ──────────────────────────────────────────────────────────────


def _open_settings(driver: FakeDriver, action: tuple) -> None:
    if action == ("tap", 270, 200):
        driver.state = SETTINGS


async def test_session_taps_then_reports_done():
    driver = FakeDriver(LAUNCHER, _open_settings)
    events = await run_session(driver, ScriptedJev([("TAP", "Settings"), ("DONE", None)]))
    assert driver.actions == [("tap", 270, 200)]
    types = [e.type for e in events]
    assert types == [
        "log",
        "screenshot", "ui_state", "thought", "action",
        "screenshot", "ui_state", "thought", "result",
    ]  # fmt: skip
    assert [e.payload["step"] for e in events if e.type == "screenshot"] == [0, 1]
    action = next(e for e in events if e.type == "action")
    assert action.payload == {
        "tool": "tap",
        "args": {"type": "tap-element", "elementId": "ui.0"},
        "success": True,
        "summary": "Tap Settings.",
    }
    assert events[-1].payload["success"] is True
    assert events[-1].payload["steps"] == 1
    assert "not independently verified" in events[-1].payload["reason"]


async def test_session_reports_each_app_card_once_when_its_app_is_on_screen():
    driver = FakeDriver(LAUNCHER, _open_settings)
    jev = ScriptedJev([("TAP", "Settings"), ("DONE", None)])
    cards = [
        {"packageName": "com.android.settings", "name": "Settings", "content": "Wi-Fi is under Network"},
        {"packageName": "com.android.deskclock", "name": "", "content": "unused"},
    ]
    events = await run_session(driver, jev, app_cards=cards)
    used = [e.payload for e in events if e.type == "app_card"]
    assert used == [{"packageName": "com.android.settings", "name": "Settings", "via": "foreground"}]
    assert "appGuidance" not in jev.bodies[0]["state"]
    assert jev.bodies[1]["state"]["appGuidance"] == "Wi-Fi is under Network"


async def test_session_numbers_steps_from_the_offset():
    driver = FakeDriver(LAUNCHER)
    events = await run_session(driver, ScriptedJev([("DONE", None)]), step_offset=7)
    assert [e.payload["step"] for e in events if e.type == "screenshot"] == [7]


async def test_session_never_taps_a_target_that_changed_and_decides_again():
    driver = FakeDriver(LAUNCHER, _open_settings)

    def relabel(d: FakeDriver) -> None:
        d.state = copy.deepcopy(LAUNCHER)
        d.state["a11y_tree"]["children"][0]["text"] = "Moved"

    jev = ScriptedJev([("TAP", "Settings"), ("BLOCKED", None)])
    # The first read inside act() sees a different screen than the decision did.
    original_decide = jev.__call__

    async def decide_then_change(body):
        result = await original_decide(body)
        if len(jev.bodies) == 1:
            driver.before_read = relabel
        return result

    agent = JevAgentRun(
        spec(),
        config=JevConfig(api_key="k", model="jev-latest"),
        device=JevDevice(driver, SERIAL),
        transport=decide_then_change,
        sleep=_no_sleep,
    )
    events = [e async for e in agent.events()]
    assert driver.actions == []
    assert any(e.type == "log" and "Screen changed" in e.payload["message"] for e in events)
    assert events[-1].type == "result" and events[-1].payload["success"] is False


async def test_session_types_a_goal_span_and_verifies_the_field():
    search = raw_state(
        node((0, 100, 1080, 300), className="android.widget.EditText", isFocused=True, isEditable=True, text=""),
        package="com.example.maps",
        keyboard=True,
    )

    def type_into_field(driver: FakeDriver, action: tuple) -> None:
        if action[0] == "type":
            driver.state = copy.deepcopy(search)
            driver.state["a11y_tree"]["children"][0]["text"] = action[1]

    driver = FakeDriver(search, type_into_field)
    events = await run_session(
        driver, ScriptedJev([("TYPE_TEXT", "Golden Gate Bridge"), ("DONE", None)]),
        instruction="Search for Golden Gate Bridge",
    )  # fmt: skip
    assert driver.actions == [("type", "Golden Gate Bridge", True)]
    assert events[-1].payload["success"] is True


async def test_session_stops_when_typed_text_does_not_appear():
    search = raw_state(
        node((0, 100, 1080, 300), className="android.widget.EditText", isFocused=True, isEditable=True, text=""),
        package="com.example.maps",
        keyboard=True,
    )
    driver = FakeDriver(search)  # the field never shows the text
    events = await run_session(
        driver, ScriptedJev([("TYPE_TEXT", "Berlin")]), instruction="Search for Berlin"
    )
    assert events[-1].payload["success"] is False
    assert "did not show the complete value" in events[-1].payload["reason"]


async def test_session_stops_at_the_step_limit():
    driver = FakeDriver(LAUNCHER)
    jev = ScriptedJev([("HOME", None), ("BACK", None), ("HOME", None)])
    events = await run_session(driver, jev, max_steps=2)
    assert len(driver.actions) == 2
    assert events[-1].payload == {"success": False, "reason": "Reached the step limit.", "steps": 2}


async def test_session_stops_when_an_action_leaves_the_screen_unchanged_twice():
    driver = FakeDriver(LAUNCHER)  # tapping Clock does nothing
    events = await run_session(driver, ScriptedJev([("TAP", "Clock"), ("TAP", "Clock")]))
    assert len(driver.actions) == 1
    assert events[-1].payload["reason"].startswith("Jev repeated an action on an unchanged screen.")


async def test_session_repeats_an_action_on_a_screen_it_returns_to():
    def navigate(driver: FakeDriver, action: tuple) -> None:
        driver.state = SETTINGS if action == ("tap", 270, 200) else LAUNCHER

    driver = FakeDriver(LAUNCHER, navigate)
    jev = ScriptedJev([("TAP", "Settings"), ("BACK", None), ("TAP", "Settings"), ("DONE", None)])
    events = await run_session(driver, jev)
    assert driver.actions == [("tap", 270, 200), ("button", "back"), ("tap", 270, 200)]
    assert events[-1].payload["success"] is True


async def test_session_stops_offering_a_tap_repeated_on_the_same_screen_and_marks_it_tapped():
    comments = raw_state(
        node((0, 100, 1080, 300), text="micheleragaglia", isClickable=True),
        node((0, 300, 1080, 2000), text="comments", isScrollable=True),
        package="com.example.social",
    )
    profile = raw_state(node((0, 0, 1080, 200), text="Profile"), package="com.example.social")

    def navigate(driver: FakeDriver, action: tuple) -> None:
        driver.state = profile if action[0] == "tap" else comments

    driver = FakeDriver(comments, navigate)
    jev = ScriptedJev(
        [("TAP", "micheleragaglia"), ("BACK", None), ("TAP", "micheleragaglia"), ("BACK", None),
         ("SCROLL_DOWN", "comments"), ("DONE", None)]
    )  # fmt: skip
    await run_session(driver, jev, max_steps=10)
    first, second, third = (jev.bodies[i]["questions"] for i in (0, 2, 4))
    assert first["tap_target"]["criteria"] == {"1": "[1] micheleragaglia"}
    assert second["tap_target"]["criteria"] == {"1": "[1] micheleragaglia (tapped 1x earlier)"}
    # Tapped twice on this identical screen: no longer offered, so scrolling is what remains.
    assert "tap_target" not in third and "SCROLL_DOWN" in third["operation"]["criteria"]
    assert driver.actions[-1][0] == "swipe"


COMMENTS = raw_state(
    node((0, 100, 1080, 300), text="micheleragaglia", isClickable=True),
    node((0, 300, 1080, 2000), text="comments", isScrollable=True),
    package="com.example.social",
)


async def test_session_lets_the_advisor_override_an_unsure_jev():
    prompts: list[dict[str, Any]] = []

    async def complete(system: str, user: str) -> str:
        prompts.append(json.loads(user))
        scroll = next(iter(prompts[-1]["targets"]["scroll_target"]))
        if len(prompts) == 1:
            return json.dumps(
                {"operation": "SCROLL_DOWN", "target": scroll, "notes": "michele already followed", "reason": "all handled"}
            )
        return '{"operation": "DONE", "target": null}'

    driver = FakeDriver(COMMENTS)
    jev = ScriptedJev([("TAP", "micheleragaglia"), ("TAP", "micheleragaglia")], confidence=0.3)
    events = await run_session(driver, jev, advisor=Advisor(complete, "executor:big"), max_steps=5)

    assert driver.actions[0][0] == "swipe"  # the advisor's scroll, not Jev's tap
    assert prompts[0]["smallModelProposal"] == {"operation": "TAP", "target": "1"}
    assert prompts[1]["notes"] == "michele already followed"
    assert jev.bodies[1]["state"]["progressNotes"] == "michele already followed"
    thought = next(e for e in events if e.type == "thought")
    assert "advised by executor:big: all handled" in thought.payload["description"]
    assert events[-1].payload["success"] is True


async def test_session_keeps_jevs_answer_when_the_advisor_fails():
    async def complete(system: str, user: str) -> str:
        return '{"operation": "SCROLL_SIDEWAYS"}'

    jev = ScriptedJev([("DONE", None)], confidence=0.3)
    events = await run_session(FakeDriver(COMMENTS), jev, advisor=Advisor(complete, "executor:big"))
    assert any(e.type == "log" and "Jev advisor failed" in e.payload["message"] for e in events)
    assert events[-1].payload["success"] is True


async def test_session_does_not_ask_the_advisor_when_jev_is_sure():
    async def complete(system: str, user: str) -> str:
        raise AssertionError("not consulted")

    driver = FakeDriver(LAUNCHER, _open_settings)
    jev = ScriptedJev([("TAP", "Settings"), ("BACK", None), ("HOME", None)])
    events = await run_session(driver, jev, advisor=Advisor(complete, "executor:big"), max_steps=2)
    assert driver.actions == [("tap", 270, 200), ("button", "back")]
    assert not any(e.type == "log" and "advisor failed" in e.payload["message"] for e in events)


def test_build_questions_never_offers_destructive_controls_the_goal_does_not_name():
    sheet = raw_state(
        node((0, 0, 1080, 200), [node((0, 0, 1080, 200), text="Unfollow")], isClickable=True),
        node((0, 200, 1080, 400), text="Customise name", isClickable=True),
        package="com.example.social",
    )
    obs = summarize_state(sheet, SERIAL)
    offered = build_questions(obs, goal="follow users")["questions"]["tap_target"]["criteria"]
    assert list(offered.values()) == ["[1] Customise name"]
    offered = build_questions(obs, goal="unfollow everyone")["questions"]["tap_target"]["criteria"]
    assert "Unfollow" in " ".join(offered.values())


async def test_session_lets_the_advisor_decide_when_jev_answers_are_malformed():
    async def broken_jev(body: dict[str, Any]) -> dict[str, Any]:
        return {"answers": {"operation": {"type": "choice", "choice": "TAP", "confidence": 2}}}

    async def complete(system: str, user: str) -> str:
        return '{"operation": "DONE", "target": null}'

    agent = JevAgentRun(
        spec(),
        config=JevConfig(api_key="k", model="jev-latest"),
        device=JevDevice(FakeDriver(LAUNCHER), SERIAL),
        transport=broken_jev,
        advisor=Advisor(complete, "executor:big"),
        sleep=_no_sleep,
    )
    events = [e async for e in agent.events()]
    assert any(e.type == "log" and "Jev answer unusable" in e.payload["message"] for e in events)
    assert events[-1].payload["success"] is True


async def test_advisor_trusts_the_label_it_names_over_a_mismatched_key():
    async def complete(system: str, user: str) -> str:
        return '{"operation": "TAP", "target": "1", "targetLabel": "Clock"}'

    questions = {
        "operation": {"criteria": {"TAP": "", "BACK": ""}},
        "tap_target": {"criteria": {"1": "[1] Settings", "2": "[2] Clock"}},
    }
    advice = await Advisor(complete, "m").choose(goal="g", state={}, questions=questions, proposal=None)
    assert advice["target"] == "2"


async def test_session_logs_scrollable_regions_in_ui_state():
    listing = raw_state(node((0, 0, 1080, 2000), text="feed", isScrollable=True))
    events = await run_session(FakeDriver(listing), ScriptedJev([("DONE", None)]))
    ui = next(e for e in events if e.type == "ui_state").payload["elements"]
    assert ui[0]["scrollable"] is True


async def test_session_narrows_apps_by_the_spec_focus():
    jev = ScriptedJev([("DONE", None)])
    await run_session(
        FakeDriver(LAUNCHER), jev, instruction="Earlier: open Clock. Now: go home", focus="Go home"
    )
    assert len(jev.bodies[0]["questions"]["app_target"]["criteria"]) == 2


async def test_session_reports_a_failed_action_without_retrying():
    class BrokenDriver(FakeDriver):
        async def press_button(self, button: str) -> None:
            raise RuntimeError("adb gone")

    driver = BrokenDriver(LAUNCHER)
    events = await run_session(driver, ScriptedJev([("HOME", None)]))
    failed = next(e for e in events if e.type == "action")
    assert failed.payload["success"] is False
    assert "adb gone" in failed.payload["summary"]
    assert events[-1].payload["success"] is False


async def test_missing_api_key_fails_the_run():
    agent = JevAgentRun(spec(), config=JevConfig(api_key="", model="jev-latest"))
    with pytest.raises(RuntimeError, match="TYPESAFE_API_KEY"):
        [e async for e in agent.events()]


def test_jev_config_defaults_to_typesafe(monkeypatch):
    for name in ("TYPESAFE_API_KEY", "TYPESAFE_BASE_URL", "TYPESAFE_MODEL"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("OPENROUTER_API_KEY", "or-key")
    config = jev_config()
    assert (config.base_url, config.provider, config.model) == ("https://api.typesafe.ai", "TypeSafe", "jev-latest")
    assert config.configured is False  # an OpenRouter key alone does not reach TypeSafe


def test_jev_config_routes_through_openrouter_with_its_key(monkeypatch):
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)
    monkeypatch.setenv("TYPESAFE_BASE_URL", "https://openrouter.ai/api/")
    monkeypatch.setenv("OPENROUTER_API_KEY", "or-key")
    config = jev_config()
    assert (config.base_url, config.provider, config.api_key) == ("https://openrouter.ai/api", "OpenRouter", "or-key")


async def test_transport_posts_to_the_configured_system_one_endpoint():
    import httpx

    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"], seen["auth"] = str(request.url), request.headers["authorization"]
        return httpx.Response(200, json={"answers": {}})

    config = JevConfig(api_key="or-key", model="jev-1.13", base_url="https://openrouter.ai/api")
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        await httpx_transport(client, config)({"model": "jev-1.13"})
    assert seen == {"url": "https://openrouter.ai/api/v1/systemone", "auth": "Bearer or-key"}


# ── HTTP seam ────────────────────────────────────────────────────────────


async def test_start_run_forwards_the_agent_choice(client, framework):
    res = await client.post(
        "/runs",
        json={
            "runId": "jev-1",
            "deviceSerial": SERIAL,
            "instruction": "Open Settings",
            "options": {"agent": "jev", "maxSteps": 4},
        },
    )
    assert res.status_code == 202
    async with client.stream("GET", "/runs/jev-1/events") as stream:
        async for _ in stream.aiter_text():
            pass
    assert framework.specs[0].agent == "jev"


async def test_start_run_defaults_to_the_mobilerun_agent(client, framework):
    res = await client.post(
        "/runs", json={"runId": "m-1", "deviceSerial": SERIAL, "instruction": "Open Settings"}
    )
    assert res.status_code == 202
    async with client.stream("GET", "/runs/m-1/events") as stream:
        async for _ in stream.aiter_text():
            pass
    assert framework.specs[0].agent == "mobilerun"


async def test_start_run_rejects_an_unknown_agent(client):
    res = await client.post(
        "/runs",
        json={"runId": "x", "deviceSerial": SERIAL, "instruction": "x", "options": {"agent": "gpt"}},
    )
    assert res.status_code == 422


# ── loops, streaks and closing apps ──────────────────────────────────────


async def test_session_stops_a_home_and_reopen_loop_between_two_screens():
    def navigate(driver: FakeDriver, action: tuple) -> None:
        driver.state = SETTINGS if action[0] == "start_app" else LAUNCHER

    driver = FakeDriver(LAUNCHER, navigate)
    jev = ScriptedJev([("OPEN_APP", "Settings"), ("HOME", None)] * 5)
    events = await run_session(driver, jev, max_steps=20)
    # Each screen changes after every action, so only the run-wide count catches the loop.
    assert driver.actions == [("start_app", "com.android.settings"), ("button", "home")] * 3
    assert events[-1].payload["success"] is False
    assert events[-1].payload["reason"].startswith("Jev kept repeating the same action")


def _feed(driver: FakeDriver, action: tuple) -> None:
    if action[0] == "swipe":
        n = int(driver.state["a11y_tree"]["children"][0]["text"].split()[-1]) + 1
        driver.state = _reel(n)


def _reel(n: int) -> dict[str, Any]:
    return raw_state(node((0, 100, 1080, 2000), text=f"reel {n}", isScrollable=True), package="com.example.reels")


async def test_session_asks_the_advisor_during_a_long_confident_streak_and_drops_stale_notes():
    prompts: list[dict[str, Any]] = []

    async def complete(system: str, user: str) -> str:
        prompts.append(json.loads(user))
        scroll = next(iter(prompts[-1]["targets"]["scroll_target"]))
        if len(prompts) == 1:
            return json.dumps({"operation": "SCROLL_DOWN", "target": scroll, "notes": "watched 1"})
        if len(prompts) == 2:
            return json.dumps({"operation": "SCROLL_DOWN", "target": scroll})  # keeps the old notes
        return '{"operation": "DONE", "target": null, "notes": "watched 10"}'

    driver = FakeDriver(_reel(0), _feed)
    jev = ScriptedJev([("SCROLL_DOWN", "reel")] * 12, confidence=0.95)

    # The first answer is unsure so the advisor writes notes at step 0; the rest are confident.
    original = jev.__call__

    async def first_unsure(body):
        jev.confidence = 0.3 if not jev.bodies else 0.95
        return await original(body)

    agent = JevAgentRun(
        spec(max_steps=20, instruction="Watch 10 reels"),
        config=JevConfig(api_key="k", model="jev-latest"),
        device=JevDevice(driver, SERIAL),
        transport=first_unsure,
        advisor=Advisor(complete, "executor:big"),
        sleep=_no_sleep,
    )
    events = [e async for e in agent.events()]

    # Asked at step 0 (unsure), then at the 5th and 10th scroll in a row despite high confidence.
    assert [p["stepsTaken"] for p in prompts] == [0, 4, 9]
    assert prompts[1]["notesWrittenAtStep"] == 0
    assert jev.bodies[5]["state"]["progressNotes"] == "watched 1"  # 5 actions old: still shown
    assert "progressNotes" not in jev.bodies[6]["state"]  # 6 actions old: dropped
    assert len([a for a in driver.actions if a[0] == "swipe"]) == 9
    assert events[-1].payload["success"] is True


async def test_close_app_end_step_force_stops_the_foreground_app_without_asking_jev():
    driver = FakeDriver(SETTINGS)
    jev = ScriptedJev([])
    events = await run_session(
        driver, jev, instruction="An earlier session opened Settings.\n\nclose app", focus="close app"
    )
    assert jev.bodies == []
    assert driver.actions == [("stop_app", "com.android.settings"), ("button", "home")]
    action = next(e for e in events if e.type == "action")
    assert action.payload["tool"] == "close_app" and action.payload["success"] is True
    assert events[-1].payload["success"] is True


async def test_close_app_from_the_home_screen_closes_the_app_the_task_named():
    driver = FakeDriver(LAUNCHER)
    events = await run_session(
        driver, ScriptedJev([]), instruction="Set an alarm in Clock.\n\nclose app", focus="close app"
    )
    assert driver.actions == [("stop_app", "com.android.deskclock"), ("button", "home")]
    assert events[-1].payload["success"] is True


APPS = [
    {"packageName": "com.instagram.android", "label": "Instagram"},
    {"packageName": "com.instagram.barcelona", "label": "Threads"},
]


@pytest.mark.parametrize(
    "instruction, context, foreground, expected",
    [
        ("close app", "Open instagram app, scroll reels", "com.sec.android.app.launcher", "com.instagram.android"),
        ("Close the Instagram app.", "", "com.sec.android.app.launcher", "com.instagram.android"),
        ("quit threads", "", "com.instagram.android", "com.instagram.barcelona"),
        ("close app", "", "com.instagram.android", "com.instagram.android"),
        ("close app", "compare Instagram and Threads", "com.sec.android.app.launcher", None),  # ambiguous
        ("close app and report the total", "", "com.instagram.android", None),  # more than closing
        ("report the total", "Instagram", "com.instagram.android", None),  # not a close step
        ("close the unknown app", "", "com.instagram.android", None),
    ],
)
def test_close_app_target(instruction, context, foreground, expected):
    target = close_app_target(instruction, context, foreground, APPS)
    assert (target or {}).get("packageName") == expected

import asyncio
from types import SimpleNamespace

from mobilerun.agent.fast_agent.repeat_guard import (
    CONSECUTIVE_FAILURE_LIMIT,
    REPEAT_WARN_AT,
    RepeatGuard,
    screen_fingerprint,
)
from mobilerun.agent.utils import actions
from mobilerun.agent.utils.actions import _as_point


def test_as_point_accepts_quoted_numbers():
    assert _as_point(["540", "1500"]) == [540, 1500]
    assert _as_point([540, 1500.0]) == [540, 1500]
    assert _as_point([1.5, "2.5"]) == [1.5, 2.5]


def test_as_point_rejects_bad_input():
    assert _as_point(["a", 1]) is None
    assert _as_point([1, 2, 3]) is None
    assert _as_point("540,1500") is None
    assert _as_point([True, 1]) is None


def test_swipe_with_quoted_coordinates_reaches_driver(monkeypatch):
    calls = []

    async def fake_swipe(*args, **kwargs):
        calls.append((args, kwargs))

    async def no_pre_ui(ctx):
        return None

    monkeypatch.setattr(actions, "_macro_pre_ui", no_pre_ui)
    monkeypatch.setattr(actions, "_record_macro_action", lambda *a, **k: None)
    monkeypatch.setattr(
        actions, "_convert_action_point", lambda x, y, *, ctx: (int(x), int(y))
    )
    ctx = SimpleNamespace(driver=SimpleNamespace(swipe=fake_swipe))

    result = asyncio.run(
        actions.swipe(["540", "1500"], ["540", "500"], 2.0, ctx=ctx)
    )

    assert result.success, result.summary
    assert calls == [((540, 1500, 540, 500), {"duration_ms": 2000})]


def test_warns_on_same_call_same_screen():
    guard = RepeatGuard()
    screen = screen_fingerprint("comments list")
    params = {"index": 62, "text": "Eleonora Linn"}
    verdicts = [guard.record("click", params, screen, True) for _ in range(REPEAT_WARN_AT)]
    assert all(v.note is None for v in verdicts[:-1])
    assert verdicts[-1].note and "not making progress" in verdicts[-1].note


def test_same_call_on_different_screens_is_fine():
    guard = RepeatGuard()
    for i in range(10):
        v = guard.record("click", {"index": 15}, screen_fingerprint(f"profile {i}"), True)
        assert v.note is None and v.stop_reason is None


def test_screenshot_only_mode_never_warns_on_success():
    guard = RepeatGuard()
    for _ in range(10):
        assert guard.record("click_at", {"x": 1, "y": 2}, screen_fingerprint(""), True).note is None


def test_repeated_identical_failure_warns_then_stops():
    guard = RepeatGuard()
    params = {"coordinate": ["540", "1500"], "coordinate2": ["540", "500"]}
    screen = screen_fingerprint("comments list")
    first = guard.record("swipe", params, screen, False)
    assert first.note is None and first.stop_reason is None
    second = guard.record("swipe", params, screen, False)
    assert second.note and "failed 2 times" in second.note
    for _ in range(CONSECUTIVE_FAILURE_LIMIT - 3):
        assert guard.record("swipe", params, screen, False).stop_reason is None
    assert guard.record("swipe", params, screen, False).stop_reason


def test_success_resets_failure_streak():
    guard = RepeatGuard()
    for _ in range(CONSECUTIVE_FAILURE_LIMIT - 1):
        guard.record("swipe", {"a": 1}, None, False)
    guard.record("swipe", {"a": 1}, None, True)
    assert guard.record("swipe", {"a": 1}, None, False).stop_reason is None

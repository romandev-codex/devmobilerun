"""The mapper is exercised with the framework's real event classes."""

import base64

from executor.framework import map_framework_event


def test_maps_screenshot_thought_action_and_ignores_unknown():
    from llama_index.core.workflow import Event
    from mobilerun.agent.common.events import ScreenshotEvent, ToolExecutionEvent
    from mobilerun.agent.fast_agent.events import FastAgentResponseEvent
    from mobilerun.agent.manager.events import ManagerPlanDetailsEvent

    counter = [0]
    shot = map_framework_event(ScreenshotEvent(screenshot=b"png-bytes"), counter)
    assert shot.type == "screenshot"
    assert shot.payload["step"] == 0
    assert base64.b64decode(shot.payload["png"]) == b"png-bytes"
    assert map_framework_event(ScreenshotEvent(screenshot=b"x"), counter).payload["step"] == 1

    thought = map_framework_event(
        FastAgentResponseEvent(thought="Tap the button", code="tap(3)"), counter
    )
    assert thought.type == "thought"
    assert thought.payload == {"text": "Tap the button", "code": "tap(3)", "source": "fast_agent"}

    action = map_framework_event(
        ToolExecutionEvent(tool_name="tap", tool_args={"index": 3}, success=True, summary="ok"),
        counter,
    )
    assert action.type == "action"
    assert action.payload == {"tool": "tap", "args": {"index": 3}, "success": True, "summary": "ok"}

    plan = map_framework_event(
        ManagerPlanDetailsEvent(plan="1. x", subgoal="x", thought="because"), counter
    )
    assert plan.type == "plan"

    class Unknown(Event):
        pass

    assert map_framework_event(Unknown(), counter) is None

"""The task's end step runs after the goal, whatever the goal did."""

import asyncio

import pytest

from executor.events import RunEvent
from executor.framework import END_PHASE_MAX_STEPS, RunSpec, end_phase_spec
from tests.test_runs import collect_events, start_body

pytestmark = pytest.mark.anyio


def test_end_phase_spec_keeps_the_run_and_drops_what_belonged_to_the_goal():
    spec = RunSpec(
        run_id="r",
        device_serial="emulator-5554",
        instruction="Buy the cheapest ticket",
        start_url="https://example.com",
        end_instruction="Close the app",
        vision=True,
        max_steps=40,
        variables={"account": "work"},
        memory={"last_id": "42"},
    )
    end = end_phase_spec(spec, step_offset=6)

    assert "Buy the cheapest ticket" in end.instruction  # the goal, as context
    assert end.instruction.rstrip().endswith("Close the app")
    assert end.start_url is None  # already opened for the goal
    assert end.end_instruction is None  # it is the goal now; no third phase
    assert end.focus == "Close the app"  # the goal text is context; this is what to act on
    assert end.max_steps == END_PHASE_MAX_STEPS
    assert end.step_offset == 6
    assert (end.device_serial, end.vision) == ("emulator-5554", True)
    assert (end.variables, end.memory) == ({"account": "work"}, {"last_id": "42"})


def test_end_phase_never_gets_a_bigger_budget_than_the_run():
    spec = RunSpec(run_id="r", device_serial="s", instruction="g", end_instruction="e", max_steps=3)
    assert end_phase_spec(spec).max_steps == 3


@pytest.mark.parametrize("success", [True, False])
async def test_end_step_runs_after_a_goal_that_succeeded_or_failed(client, framework, success):
    framework.script = [
        RunEvent("action", {"tool": "tap", "args": {}, "success": True, "summary": "Tapped"}),
        RunEvent("result", {"success": success, "reason": "Reached maximum steps (7)", "steps": 7}),
    ]
    await client.post("/runs", json=start_body(run_id="ends", endInstruction="Close the app"))
    events = await collect_events(client, "ends")

    assert [e.event for e in events] == ["started", "action", "log", "log", "action", "log", "result"]
    # Why the goal stopped is logged before the end step, which may itself be stopped.
    assert events[2].data["message"] == "Goal ended: Reached maximum steps (7)"
    assert events[3].data["message"] == "Running the task's end step"
    assert events[5].data["message"] == "End step: Reached maximum steps (7)"
    # The run's own outcome stays the goal's, not the end step's.
    assert events[-1].data == {"success": success, "reason": "Reached maximum steps (7)", "steps": 7}

    goal, end = framework.specs
    assert goal.instruction.startswith("Open settings")
    assert "Close the app" in end.instruction


async def test_a_run_without_an_end_step_still_runs_once(client, framework):
    await client.post("/runs", json=start_body(run_id="plain"))
    events = await collect_events(client, "plain")
    assert [e.event for e in events] == ["started", "thought", "action", "result"]
    assert len(framework.specs) == 1


async def test_end_step_continues_the_goals_screenshot_numbering(client, framework):
    framework.script = [
        RunEvent("screenshot", {"step": 0, "png": "x"}),
        RunEvent("screenshot", {"step": 1, "png": "y"}),
        RunEvent("result", {"success": True, "reason": "Done", "steps": 2}),
    ]
    await client.post("/runs", json=start_body(run_id="shots", endInstruction="Close the app"))
    await collect_events(client, "shots")
    assert framework.specs[1].step_offset == 2


async def test_a_stopped_run_skips_the_end_step(client, framework):
    framework.script = [30.0, RunEvent("result", {"success": True, "reason": "Done", "steps": 1})]
    await client.post("/runs", json=start_body(run_id="stopped", endInstruction="Close the app"))
    await asyncio.sleep(0.05)
    await client.post("/runs/stopped/stop")
    events = await collect_events(client, "stopped")

    assert [e.event for e in events][-1] == "cancelled"
    assert len(framework.specs) == 1  # the end step never started


async def test_the_end_step_runs_even_when_the_agent_crashes(client, framework):
    class Boom(Exception):
        pass

    calls = []
    real_create = framework.create_run

    def create_run(spec):
        calls.append(spec)
        if len(calls) == 1:
            raise Boom("device fell over")
        return real_create(spec)

    framework.create_run = create_run
    await client.post("/runs", json=start_body(run_id="boom", endInstruction="Close the app"))
    events = await collect_events(client, "boom")

    assert [e.event for e in events] == ["started", "log", "log", "thought", "action", "log", "error"]
    assert events[1].data["message"] == "Goal ended: Boom: device fell over"
    assert events[2].data["message"] == "Running the task's end step"
    assert events[-1].data["message"] == "Boom: device fell over"

import asyncio

import pytest

from executor.events import RunEvent
from tests.sse import parse_sse

pytestmark = pytest.mark.anyio


def start_body(run_id="run-1", serial="emulator-5554", **extra):
    body = {
        "runId": run_id,
        "deviceSerial": serial,
        "instruction": "Open settings and report the Android version",
        "options": {"vision": True, "reasoning": False, "maxSteps": 7},
        "variables": {"account": "work"},
    }
    body.update(extra)
    return body


async def collect_events(client, run_id, headers=None):
    async with client.stream("GET", f"/runs/{run_id}/events", headers=headers) as res:
        assert res.status_code == 200
        assert res.headers["content-type"].startswith("text/event-stream")
        text = ""
        async for chunk in res.aiter_text():
            text += chunk
    return parse_sse(text)


async def test_start_run_streams_events_and_ends_after_result(client, framework):
    res = await client.post("/runs", json=start_body(startUrl="https://example.com"))
    assert res.status_code == 202
    assert res.json() == {"runId": "run-1"}

    events = await collect_events(client, "run-1")
    types = [e.event for e in events]
    assert types == ["log", "started", "thought", "action", "result"]
    assert [e.id for e in events] == ["0", "1", "2", "3", "4"]
    assert events[0].data["message"] == "Opened https://example.com"
    assert events[-1].data == {"success": True, "reason": "Done", "steps": 2}

    assert framework.opened_urls == [("emulator-5554", "https://example.com")]
    spec = framework.specs[0]
    assert spec.instruction.startswith("Open settings")
    assert (spec.vision, spec.reasoning, spec.max_steps) == (True, False, 7)
    assert spec.variables == {"account": "work"}


async def test_run_without_start_url_does_not_open_anything(client, framework):
    await client.post("/runs", json=start_body(run_id="run-2"))
    events = await collect_events(client, "run-2")
    assert [e.event for e in events][0] == "started"
    assert framework.opened_urls == []


async def test_second_run_on_busy_device_is_refused(client, framework):
    framework.script = [5.0, RunEvent("result", {"success": True, "reason": "", "steps": 1})]
    assert (await client.post("/runs", json=start_body(run_id="a"))).status_code == 202
    res = await client.post("/runs", json=start_body(run_id="b"))
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "device_busy"
    active = (await client.get("/runs")).json()
    assert [r["runId"] for r in active] == ["a"]
    await client.post("/runs/a/stop")


async def test_unknown_or_unauthorized_device_is_404(client):
    res = await client.post("/runs", json=start_body(serial="nope"))
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "device_not_found"
    assert (await client.post("/runs", json=start_body(serial="ZY22ABCD"))).status_code == 404


async def test_stop_cancels_the_run_and_emits_cancelled(client, framework):
    framework.script = [
        RunEvent("thought", {"text": "thinking"}),
        30.0,
        RunEvent("result", {"success": True, "reason": "", "steps": 1}),
    ]
    await client.post("/runs", json=start_body(run_id="slow"))
    await asyncio.sleep(0.05)
    res = await client.post("/runs/slow/stop")
    assert res.status_code == 202
    events = await collect_events(client, "slow")
    assert [e.event for e in events] == ["started", "thought", "cancelled"]
    assert framework.cancelled == ["slow"]
    assert (await client.get("/runs")).json() == []


async def test_agent_exception_becomes_error_event(client, framework):
    class Boom(Exception):
        pass

    async def failing(self):
        yield RunEvent("thought", {"text": "before"})
        raise Boom("model exploded")

    from tests.conftest import FakeAgentRun

    original = FakeAgentRun.events
    FakeAgentRun.events = failing  # type: ignore[assignment]
    try:
        await client.post("/runs", json=start_body(run_id="err"))
        events = await collect_events(client, "err")
    finally:
        FakeAgentRun.events = original  # type: ignore[assignment]
    assert [e.event for e in events] == ["started", "thought", "error"]
    assert "model exploded" in events[-1].data["message"]


async def test_late_subscriber_gets_replay_and_last_event_id_resumes(client, framework):
    await client.post("/runs", json=start_body(run_id="late"))
    await asyncio.sleep(0.05)  # run finishes before anyone subscribes
    events = await collect_events(client, "late")
    assert [e.event for e in events] == ["started", "thought", "action", "result"]
    resumed = await collect_events(client, "late", headers={"Last-Event-ID": "2"})
    assert [e.event for e in resumed] == ["result"]


async def test_events_for_unknown_run_is_404(client):
    res = await client.get("/runs/ghost/events")
    assert res.status_code == 404
    assert (await client.post("/runs/ghost/stop")).status_code == 404


async def test_start_run_validates_body(client):
    res = await client.post("/runs", json={"runId": "x"})
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "validation_error"


async def test_prompts_and_app_cards_reach_the_agent(client, framework):
    body = start_body(
        run_id="cards",
        prompts={"manager_system": "Be terse."},
        appCards=[{"packageName": "com.example", "name": "Example", "content": "Tap login"}],
    )
    assert (await client.post("/runs", json=body)).status_code == 202
    await collect_events(client, "cards")
    spec = framework.specs[-1]
    assert spec.prompts == {"manager_system": "Be terse."}
    assert spec.app_cards == [{"packageName": "com.example", "name": "Example", "content": "Tap login"}]

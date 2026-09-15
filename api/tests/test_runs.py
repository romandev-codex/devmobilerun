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


async def test_stop_wins_over_a_result_the_agent_emits_while_stopping(client, framework):
    """A cooperative cancel may let the workflow finish with a result first; the
    subscriber must still see the run as cancelled."""
    framework.swallow_cancel = True
    framework.script = [
        RunEvent("thought", {"text": "working"}),
        0.2,
        RunEvent("result", {"success": False, "reason": "interrupted", "steps": 1}),
    ]
    await client.post("/runs", json=start_body(run_id="racy"))
    await asyncio.sleep(0.05)
    assert (await client.post("/runs/racy/stop")).status_code == 202
    events = await collect_events(client, "racy")
    assert [e.event for e in events] == ["started", "thought", "cancelled"]
    assert framework.cancelled == ["racy"]


async def test_replay_keeps_images_only_for_recent_screenshots(client, framework):
    framework.script = [RunEvent("screenshot", {"step": i, "png": "QUJD"}) for i in range(8)] + [
        RunEvent("result", {"success": True, "reason": "", "steps": 8})
    ]
    await client.post("/runs", json=start_body(run_id="shots"))
    await asyncio.sleep(0.05)
    events = [e for e in await collect_events(client, "shots") if e.event == "screenshot"]
    assert len(events) == 8
    assert [("png" in e.data) for e in events] == [False, False, False, True, True, True, True, True]
    assert events[0].data["pruned"] is True


async def test_heartbeats_do_not_end_the_stream(client, framework, monkeypatch):
    from executor.routers import runs as runs_router

    monkeypatch.setattr(runs_router, "HEARTBEAT_SECONDS", 0.05)
    framework.script = [
        RunEvent("thought", {"text": "slow model"}),
        0.3,
        RunEvent("result", {"success": True, "reason": "done", "steps": 1}),
    ]
    await client.post("/runs", json=start_body(run_id="quiet"))
    async with client.stream("GET", "/runs/quiet/events") as res:
        text = "".join([chunk async for chunk in res.aiter_text()])
    assert text.count(": keep-alive") >= 2
    assert [e.event for e in parse_sse(text)] == ["started", "thought", "result"]


async def test_events_published_during_replay_are_not_lost(framework):
    """A subscriber that is still replaying when the run finishes must see the tail."""
    from executor.runs import RunManager

    manager = RunManager(framework)
    framework.script = [RunEvent("thought", {"text": "t%d" % i}) for i in range(3)] + [30.0]
    await manager.start(__import__("executor.framework", fromlist=["RunSpec"]).RunSpec(
        run_id="replay", device_serial="emulator-5554", instruction="x"
    ))
    await asyncio.sleep(0.05)  # thoughts are buffered; the fake never emits a result
    run = manager.get("replay")
    assert not run.done
    events = manager.subscribe("replay")
    first = await events.__anext__()
    assert first.event.type == "started"
    # Published while the subscriber is mid-replay, including the terminal event.
    run.publish(RunEvent("action", {"tool": "tap"}))
    run.publish(RunEvent("result", {"success": True, "reason": "", "steps": 3}))
    rest = [item async for item in events]
    assert [i.event.type for i in rest] == ["thought", "thought", "thought", "action", "result"]
    assert [i.seq for i in rest] == [1, 2, 3, 4, 5]
    await manager.stop("replay")


async def test_concurrent_starts_for_one_device_admit_only_one(framework):
    from executor.framework import RunSpec
    from executor.runs import DeviceBusy, RunManager

    original = framework.list_devices

    async def slow_list():
        await asyncio.sleep(0.05)
        return await original()

    framework.list_devices = slow_list  # type: ignore[assignment]
    framework.script = [30.0, RunEvent("result", {"success": True, "reason": "", "steps": 1})]
    manager = RunManager(framework)
    results = await asyncio.gather(
        manager.start(RunSpec(run_id="one", device_serial="emulator-5554", instruction="x")),
        manager.start(RunSpec(run_id="two", device_serial="emulator-5554", instruction="x")),
        return_exceptions=True,
    )
    assert sum(isinstance(r, DeviceBusy) for r in results) == 1
    assert len(manager.active()) == 1
    for r in manager.active():
        await manager.stop(r.spec.run_id)


async def test_run_id_may_be_reused_after_the_run_finished(client, framework):
    assert (await client.post("/runs", json=start_body(run_id="again"))).status_code == 202
    await collect_events(client, "again")
    assert (await client.post("/runs", json=start_body(run_id="again"))).status_code == 202
    await collect_events(client, "again")
    framework.script = [5.0, RunEvent("result", {"success": True, "reason": "", "steps": 1})]
    assert (await client.post("/runs", json=start_body(run_id="live"))).status_code == 202
    res = await client.post("/runs", json=start_body(run_id="live"))
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "run_exists"
    await client.post("/runs/live/stop")

"""In-memory registry of active runs.

The executor is stateless across restarts, but while a run is alive it keeps the
asyncio task (for cancel), the device it occupies (for the one-run-per-device
rule) and a replay buffer of its events so a subscriber that connects slightly
after the run started still sees everything.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from dataclasses import dataclass, field
from typing import AsyncIterator

from .events import RunEvent
from .framework import DeviceNotFound, Framework, RunSpec

logger = logging.getLogger(__name__)

FINISHED_RETENTION_SECONDS = 120.0


class DeviceBusy(Exception):
    def __init__(self, serial: str, run_id: str) -> None:
        super().__init__(f"Device {serial} is busy with run {run_id}")
        self.serial = serial
        self.run_id = run_id


class RunNotFound(Exception):
    pass


@dataclass(frozen=True)
class SeqEvent:
    seq: int
    event: RunEvent


@dataclass
class ActiveRun:
    spec: RunSpec
    started_at: float
    task: asyncio.Task | None = None
    buffer: list[SeqEvent] = field(default_factory=list)
    subscribers: list[asyncio.Queue[SeqEvent | None]] = field(default_factory=list)
    finished_at: float | None = None
    agent_run: object | None = None

    @property
    def done(self) -> bool:
        return self.finished_at is not None

    def publish(self, event: RunEvent) -> None:
        item = SeqEvent(seq=len(self.buffer), event=event)
        self.buffer.append(item)
        for q in self.subscribers:
            q.put_nowait(item)
        if event.terminal:
            self.finished_at = time.monotonic()
            for q in self.subscribers:
                q.put_nowait(None)


class RunManager:
    def __init__(self, framework: Framework) -> None:
        self._framework = framework
        self._runs: dict[str, ActiveRun] = {}

    # ── queries ────────────────────────────────────────────────────────
    def active(self) -> list[ActiveRun]:
        return [r for r in self._runs.values() if not r.done]

    def get(self, run_id: str) -> ActiveRun:
        self._sweep()
        run = self._runs.get(run_id)
        if run is None:
            raise RunNotFound(run_id)
        return run

    def _busy_run_for(self, serial: str) -> ActiveRun | None:
        for r in self._runs.values():
            if r.spec.device_serial == serial and not r.done:
                return r
        return None

    def _sweep(self) -> None:
        now = time.monotonic()
        for run_id, run in list(self._runs.items()):
            if run.done and now - (run.finished_at or now) > FINISHED_RETENTION_SECONDS:
                del self._runs[run_id]

    # ── lifecycle ──────────────────────────────────────────────────────
    async def start(self, spec: RunSpec) -> ActiveRun:
        self._sweep()
        if spec.run_id in self._runs:
            raise DeviceBusy(spec.device_serial, spec.run_id)
        busy = self._busy_run_for(spec.device_serial)
        if busy is not None:
            raise DeviceBusy(spec.device_serial, busy.spec.run_id)
        devices = await self._framework.list_devices()
        if not any(d.serial == spec.device_serial and d.state == "device" for d in devices):
            raise DeviceNotFound(spec.device_serial)

        run = ActiveRun(spec=spec, started_at=time.time())
        self._runs[spec.run_id] = run
        run.task = asyncio.create_task(self._execute(run), name=f"run-{spec.run_id}")
        return run

    async def stop(self, run_id: str) -> None:
        run = self.get(run_id)
        if run.done or run.task is None:
            return
        agent_run = run.agent_run
        if agent_run is not None:
            with contextlib.suppress(Exception):
                await agent_run.cancel()  # type: ignore[attr-defined]
        run.task.cancel()

    async def _execute(self, run: ActiveRun) -> None:
        spec = run.spec
        try:
            if spec.start_url:
                await self._framework.open_url(spec.device_serial, spec.start_url)
                run.publish(RunEvent("log", {"message": f"Opened {spec.start_url}"}))
            agent_run = self._framework.create_run(spec)
            run.agent_run = agent_run
            run.publish(RunEvent("started", {"runId": spec.run_id, "device": spec.device_serial}))
            async for event in agent_run.events():
                run.publish(event)
                if event.terminal:
                    return
            run.publish(RunEvent("error", {"message": "Agent finished without a result"}))
        except asyncio.CancelledError:
            run.publish(RunEvent("cancelled", {}))
        except Exception as exc:  # noqa: BLE001 - surface any failure to the subscriber
            logger.exception("run %s failed", spec.run_id)
            run.publish(RunEvent("error", {"message": f"{type(exc).__name__}: {exc}"}))
        finally:
            if not run.done:
                run.publish(RunEvent("error", {"message": "Run ended unexpectedly"}))

    # ── streaming ──────────────────────────────────────────────────────
    async def subscribe(self, run_id: str, after_seq: int = -1) -> AsyncIterator[SeqEvent]:
        run = self.get(run_id)
        queue: asyncio.Queue[SeqEvent | None] = asyncio.Queue()
        run.subscribers.append(queue)
        try:
            for item in list(run.buffer):
                if item.seq > after_seq:
                    yield item
            if run.done:
                return
            while True:
                item = await queue.get()
                if item is None:
                    return
                if item.seq > after_seq:
                    yield item
        finally:
            with contextlib.suppress(ValueError):
                run.subscribers.remove(queue)

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
from .framework import AgentRun, DeviceNotFound, Framework, RunSpec, end_phase_spec

logger = logging.getLogger(__name__)

FINISHED_RETENTION_SECONDS = 120.0
REPLAY_IMAGE_LIMIT = 5


class DeviceBusy(Exception):
    def __init__(self, serial: str, run_id: str) -> None:
        super().__init__(f"Device {serial} is busy with run {run_id}")
        self.serial = serial
        self.run_id = run_id


class RunNotFound(Exception):
    pass


class RunExists(Exception):
    def __init__(self, run_id: str) -> None:
        super().__init__(f"Run {run_id} is already active")
        self.run_id = run_id


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
    agent_run: AgentRun | None = None
    cancel_requested: bool = False

    def _trim_replay_images(self) -> None:
        """Keeps image bytes only for the newest screenshots in the replay buffer.

        The app persists every screenshot as it streams; a reconnecting subscriber
        only needs the recent ones, so older replayed screenshots carry no image.
        """
        keep = REPLAY_IMAGE_LIMIT
        for item in reversed(self.buffer):
            if item.event.type != "screenshot" or "png" not in item.event.payload:
                continue
            if keep > 0:
                keep -= 1
                continue
            payload = {k: v for k, v in item.event.payload.items() if k != "png"}
            self.buffer[item.seq] = SeqEvent(item.seq, RunEvent("screenshot", {**payload, "pruned": True}))

    @property
    def done(self) -> bool:
        return self.finished_at is not None

    def publish(self, event: RunEvent) -> None:
        # A stop request wins over whatever the agent reports afterwards.
        if self.cancel_requested and event.terminal:
            event = RunEvent("cancelled", {})
        item = SeqEvent(seq=len(self.buffer), event=event)
        self.buffer.append(item)
        self._trim_replay_images()
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
        existing = self._runs.get(spec.run_id)
        if existing is not None:
            if not existing.done:
                raise RunExists(spec.run_id)
            del self._runs[spec.run_id]  # a finished run kept for replay; the id may be reused
        busy = self._busy_run_for(spec.device_serial)
        if busy is not None:
            raise DeviceBusy(spec.device_serial, busy.spec.run_id)

        # Register before the adb round trip so a concurrent start for the same
        # device sees this run as busy; withdraw it if the device is not connected.
        run = ActiveRun(spec=spec, started_at=time.time())
        self._runs[spec.run_id] = run
        try:
            devices = await self._framework.list_devices()
        except Exception:
            del self._runs[spec.run_id]
            raise
        if not any(d.serial == spec.device_serial and d.state == "device" for d in devices):
            del self._runs[spec.run_id]
            raise DeviceNotFound(spec.device_serial)
        run.task = asyncio.create_task(self._execute(run), name=f"run-{spec.run_id}")
        return run

    async def stop(self, run_id: str) -> None:
        run = self.get(run_id)
        if run.done or run.task is None:
            return
        run.cancel_requested = True
        agent_run = run.agent_run
        if agent_run is not None:
            with contextlib.suppress(Exception):
                await agent_run.cancel()
        run.task.cancel()

    async def _execute(self, run: ActiveRun) -> None:
        spec = run.spec
        # Screenshot numbering carried across phases so the end step continues
        # the goal's steps instead of restarting at zero.
        progress = [0]
        try:
            if spec.start_url:
                await self._framework.open_url(spec.device_serial, spec.start_url)
                run.publish(RunEvent("log", {"message": f"Opened {spec.start_url}"}))
            try:
                terminal = await self._stream_phase(run, spec, progress, publish_started=True)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # the end step still owes the device its cleanup
                logger.exception("run %s failed", spec.run_id)
                terminal = RunEvent("error", {"message": f"{type(exc).__name__}: {exc}"})
            if terminal is None:
                terminal = RunEvent("error", {"message": "Agent finished without a result"})
            # A stop request is the one outcome the end step does not follow:
            # whoever pressed it wants the device back now.
            if spec.end_instruction and not run.cancel_requested:
                # The goal's ending is published last; say now why the goal stopped, in
                # case the end step is itself stopped before that.
                reason = terminal.payload.get("reason") or terminal.payload.get("message") or terminal.type
                run.publish(RunEvent("log", {"message": f"Goal ended: {reason}"}))
                await self._run_end_phase(run, progress)
            run.publish(terminal)
        except asyncio.CancelledError:
            run.publish(RunEvent("cancelled", {}))
        except Exception as exc:  # noqa: BLE001 - surface any failure to the subscriber
            logger.exception("run %s failed", spec.run_id)
            run.publish(RunEvent("error", {"message": f"{type(exc).__name__}: {exc}"}))
        finally:
            if not run.done:
                run.publish(RunEvent("error", {"message": "Run ended unexpectedly"}))

    async def _stream_phase(
        self,
        run: ActiveRun,
        spec: RunSpec,
        progress: list[int],
        *,
        publish_started: bool = False,
    ) -> RunEvent | None:
        """Drives one agent phase, publishing everything it emits but its ending.

        The terminal event is returned rather than published: a run has exactly
        one ending, and with an end step the goal's phase is not it. ``progress``
        is advanced past the screenshots this phase produced.
        """
        if publish_started:
            run.publish(RunEvent("started", {"runId": spec.run_id, "device": spec.device_serial}))
        agent_run = self._framework.create_run(spec)
        run.agent_run = agent_run
        async for event in agent_run.events():
            if event.terminal:
                return event
            run.publish(event)
            if event.type == "screenshot":
                step = event.payload.get("step")
                if isinstance(step, int):
                    progress[0] = max(progress[0], step + 1)
        return None

    async def _run_end_phase(self, run: ActiveRun, progress: list[int]) -> None:
        """Runs the task's closing step after the goal, however the goal ended.

        The step is what the task owes the device — closing an app, returning
        home, reporting a total — so a failed or step-exhausted goal reaches it
        just as a successful one does. Its own outcome is published as a log
        line: the run's result belongs to the goal.
        """
        spec = end_phase_spec(run.spec, step_offset=progress[0])
        run.publish(RunEvent("log", {"message": "Running the task's end step"}))
        try:
            terminal = await self._stream_phase(run, spec, progress)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # the goal's result must still be reported
            logger.exception("end step of run %s failed", spec.run_id)
            terminal = RunEvent("error", {"message": f"{type(exc).__name__}: {exc}"})
        if terminal is None:
            run.publish(RunEvent("log", {"message": "End step ended without a result", "success": False}))
        elif terminal.type == "result":
            run.publish(
                RunEvent(
                    "log",
                    {
                        "message": f"End step: {terminal.payload.get('reason', '')}",
                        "success": bool(terminal.payload.get("success")),
                    },
                )
            )
        else:
            message = terminal.payload.get("message") or terminal.type
            run.publish(RunEvent("log", {"message": f"End step did not finish: {message}", "success": False}))

    # ── streaming ──────────────────────────────────────────────────────
    async def subscribe(
        self, run_id: str, after_seq: int = -1, heartbeat: float | None = None
    ) -> AsyncIterator[SeqEvent | None]:
        """Yields the run's events after ``after_seq``; ``None`` is a heartbeat.

        The queue is registered before the replay buffer is copied, so nothing
        published in between is lost; duplicates are filtered by seq.
        """
        run = self.get(run_id)
        queue: asyncio.Queue[SeqEvent | None] = asyncio.Queue()
        run.subscribers.append(queue)
        last = after_seq
        try:
            for item in list(run.buffer):
                if item.seq > last:
                    last = item.seq
                    yield item
            if run.done:
                # Finished before or during the replay: drain what arrived meanwhile.
                while not queue.empty():
                    item = queue.get_nowait()
                    if item is not None and item.seq > last:
                        last = item.seq
                        yield item
                return
            while True:
                try:
                    item = await asyncio.wait_for(queue.get(), timeout=heartbeat)
                except asyncio.TimeoutError:
                    yield None
                    continue
                if item is None:
                    return
                if item.seq > last:
                    last = item.seq
                    yield item
        finally:
            with contextlib.suppress(ValueError):
                run.subscribers.remove(queue)

# Spec: Schedule queue mode (run next when the device is free)

Status: implemented
Repo: `app/mobilerun`. Extends the scheduling described in `device-task-runner.md`.

## Problem Statement

Every schedule is driven by a timer: it repeats `intervalSeconds` after the previous run finished, and a tick that lands while the device is busy or offline is recorded as a `skipped` run and lost until the next interval. That is the wrong shape for the common case of "I have three tasks for this phone, keep it working through them". Picking an interval short enough to keep the device busy produces a stream of skips; picking one long enough to avoid skips leaves the device idle.

## Solution

A schedule chooses a **mode**:

- **interval** — today's behavior, unchanged. Repeats on a timer, owns an Agenda tick, skips when the device is unavailable.
- **queue** — no timer. The schedule takes a position (`order`) in its device's rotation and runs whenever that device is free. After it runs it goes to the back of the rotation, so a device cycles through its queue schedules forever, in order, until `maxRuns` or `maxFails` retires one.

Both modes can target the same device. A due interval schedule outranks the rotation, so timers keep their meaning on a device that is otherwise kept busy.

## User Stories

1. As an operator, I want a schedule that runs "next time this phone is free" instead of on a clock, so that a device works continuously instead of skipping ticks.
2. As an operator, I want to set the position of each queue schedule, so that I control what the device does first.
3. As an operator, I want a device to cycle through its queue schedules in order, so that no task starves behind another.
4. As an operator, I want a timed schedule on the same device to still run on time, so that adding a queue does not silently break my hourly job.
5. As an operator, I want `maxRuns` and `maxFails` to work the same in both modes, so that the stop conditions I already know still apply.
6. As an operator, I want a queue schedule on an offline phone to wait rather than pile up skipped runs, so that history stays readable.
7. As an operator, I want to switch an existing schedule between modes, so that I can change my mind without recreating it.

## Data Model

Added to `Schedule`:

| Field | Type | Meaning |
| --- | --- | --- |
| `mode` | `"interval" \| "queue"` | Which trigger drives the schedule. Defaults to `interval`, so existing documents keep working untouched. |
| `intervalSeconds` | `number \| null` | Required in interval mode, null in queue mode. Was previously required outright. |
| `order` | `number \| null` | Required in queue mode, null in interval mode. Position in the device's rotation. |

`nextRunAt` stays the planned tick time for interval schedules and is always null for queue ones: a queue schedule has no predicted time, only a next turn. `maxRuns`, `maxFails`, `runCount`, `failStreak` and `enabled` are unchanged and mean the same in both modes.

A patch is validated against the document it produces, not on its own, so a request can move a schedule to queue mode and supply `order` in one call but cannot leave it half-switched.

## Whose Turn It Is

No cursor is stored. A device's eligible queue schedules are sorted by `lastRunAt` ascending — Mongo orders null before any date, so never-run schedules come first — then by `order`. The first pass therefore follows `order`, and afterwards the least recently run schedule goes next, which is a rotation. `order` also breaks every tie.

## Dispatch

A repeating Agenda job, `device-dispatch`, runs every 5 seconds with concurrency 1 so two polls can never hand out the same device. Each poll refreshes device state from the executor (queue schedules own no tick, so this poll is the only thing that would notice a phone coming back online) and then, for each online device with no active run:

1. If an enabled interval schedule on that device is already due, leave the device alone — its tick is about to claim it.
2. If a run for that device is `queued` or `running`, leave it alone. This closes the window between creating a run and the run acquiring the device lock.
3. Otherwise take the first runnable queue schedule by the ordering above, create its run and enqueue it.

Polling rather than reacting to device-free events is deliberate: a missed wake-up costs one 5-second cycle instead of stranding a device, and there is no path that frees a device which must remember to fire an event. Against runs that take minutes, the latency is noise. Event-driven dispatch can be layered on later without changing anything else.

## Interval Priority

A run cannot be preempted, so "interval wins" means the due interval schedule gets the next free slot. Two halves:

- Dispatch stands down for a device with a due interval schedule (step 1 above).
- A tick that finds its device busy **with any run** (queue, interval or manual) re-plans itself 10 seconds out and records nothing, instead of recording a `skipped` run and losing a whole interval. While it waits, its `nextRunAt` stays at the moment it fell due, so dispatch yields to it and it takes the device as soon as the device is free.

Only an offline device (or an unreachable executor) still records a skip. The cost is up to ~10 seconds of idle device between a queue run ending and the timed run starting.

## Run Bookkeeping

Counting a finished scheduled run previously happened in two places: `executeScheduleTick` ran the task inline and counted it, while `afterScheduledRunFinished` handled runs that finished outside their tick after a restart. Dispatch cannot run tasks inline without blocking the poll, so it goes through the normal `enqueueRun` → `executeRun` path, which did no bookkeeping at all.

Rather than add a third counting site, `afterScheduledRunFinished` is now the only one. It is called from `executeRun`'s `finally` for every run, and is idempotent via its existing `lastRunId` guard. It counts the run, applies the fail streak, and plans the next tick — which for a queue schedule means planning nothing, since dispatch finds it. The tick keeps a safety net: if the run's bookkeeping did not leave a tick behind, the tick plans one before it exits.

A run that never started because it lost the device lock is marked failed but is not counted against its schedule, matching how a skip behaves.

## Lifecycle

- Creating or enabling a queue schedule plans no job; disabling one cancels nothing.
- Switching interval → queue cancels the pending tick and clears `nextRunAt`; queue → interval plans a tick immediately.
- At boot, `reconcileSchedules` retires over-budget schedules in both modes and plans ticks only for interval ones. `startAgenda` (re-)registers the dispatch job, which is idempotent.
- An offline device's queue schedules simply wait; no `skipped` runs are recorded, because there is no tick to skip. Interval schedules keep recording them.
- Queues on different devices are independent and run in parallel.

## UI

The schedule dialog gains a trigger selector — "Repeat on a timer" or "Next in line when the device is free" — which swaps the interval input for an order input. Max runs and max fails apply to both. The table's former "Every" column becomes "Trigger" and reads `5 min` or `Queue #2`; "Next run" reads a timestamp for interval schedules and "when device is free" for queue ones.

There is deliberately no per-device queue-reordering screen; order is a field on each schedule.

## Out of Scope

- Reordering a device's queue by drag-and-drop.
- A minimum gap between consecutive queue runs on one device.
- Priority between two queue schedules beyond `order`.

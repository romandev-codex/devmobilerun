# 05: Run a task on a device now and watch it live

**What to build:** From a task, the operator presses Run now, picks an online device, and is taken to a run page that streams the agent's thoughts, actions, tool results and final outcome as they happen. The run continues if the browser tab is closed. A second run on a busy device is refused. This is the core tracer bullet: executor agent wrapper, SSE out of the executor, Agenda inside Next.js, run persistence, browser SSE.

**Blocked by:** 02 Device list, 04 Task CRUD

**Status:** done

- [ ] Executor `POST /runs` accepts run id, device serial, optional start URL, instruction, options and variables; opens the start URL through an adb VIEW intent; builds `MobileAgent` from the framework config with per-run overrides, trajectory saving disabled; 409 when the device already has an active run; 404 for unknown device
- [ ] Executor `GET /runs/{id}/events` streams SSE events `started`, `thought`, `action`, `plan`, `log`, `result`, `error` mapped from framework events and ends after a terminal event; `GET /runs` lists active runs
- [ ] Executor keeps an in-memory map of active runs keyed by run id and device; entries are removed on completion
- [ ] Next.js composes the instruction from start instruction, goal and end instruction as one prompt; start URL is passed separately
- [ ] `runs` and `runEvents` collections; `devices.activeRunId` acquired atomically as the device lock and released on any terminal state
- [ ] Agenda (`@hokify/agenda`) started once from the instrumentation hook; `run-task` job performs the executor call, tails SSE, persists events, sets final status; lock lifetime exceeds the longest possible run
- [ ] `POST /api/tasks/:id/run` with device serial creates a queued run and enqueues `run-task` immediately; returns 409 with a clear message if the device is busy
- [ ] `GET /api/runs/:id` and `GET /api/runs/:id/events` (browser SSE that replays stored events then tails new ones)
- [ ] Run page shows status, device, live event timeline and a result banner with success, reason, steps and duration; Tasks table now shows real last run status
- [ ] Executor tests use a scripted fake agent factory to cover 409, SSE ordering and termination on result and error; Next.js tests cover instruction composition, lock acquisition and release, event persistence and browser SSE replay against the fake executor

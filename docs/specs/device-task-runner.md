# Spec: Device Task Runner (app UI + execution API)

Status: ready-for-agent
Repos: `app/mobilerun` (Next.js UI + data), new `api/` folder in the same repo (Python execution service). The `mobilerun` framework repo is not modified.

## Problem Statement

I have several Android phones connected to my machine and the `mobilerun` framework, which can drive a phone with an LLM agent from Python or the CLI. Today every automation is a one-off terminal command: I cannot see all my phones in one place, I cannot watch what a phone is doing while the agent works, I cannot save a task and run it again later, and I cannot make a task repeat on a schedule. Run history exists only as loose trajectory folders on disk.

## Solution

A local web app with two processes:

- **Next.js app** (existing scaffold): the UI and the owner of all data in MongoDB. Devices, tasks, schedules, runs, run events, screenshots and settings all live here. Scheduling runs inside the Next.js server process using Agenda, a Mongo-backed job queue.
- **Python execution service** (new, FastAPI): a thin, stateless wrapper around the framework's `MobileAgent`. It lists adb devices, takes screenshots, starts a run on a device, streams the run's events back over Server-Sent Events (SSE), and can stop a run. It stores nothing.

The user opens the app, sees every connected phone with a live-ish screenshot, creates tasks (start with a URL or instruction, a main goal, an ending instruction), runs them on a chosen device, watches the agent's steps and screenshots in real time, and schedules tasks to repeat every N seconds, forever or up to a maximum number of runs.

## User Stories

### Devices
1. As an operator, I want to see a list of every Android device connected over adb, so that I know which phones are available.
2. As an operator, I want each device card to show its serial, model, adb state, and whether a run is active on it, so that I can tell busy phones from idle ones at a glance.
3. As an operator, I want each device card to show a recent screenshot that refreshes on an interval, so that I can see what is on every phone without touching it.
4. As an operator, I want to open a single device page with a large screenshot that refreshes on an interval, so that I can watch one phone closely.
5. As an operator, I want to give a device a friendly display name that survives restarts, so that I can tell "Pixel test" from "Samsung prod" instead of remembering serials.
6. As an operator, I want a device that disappears from adb to be shown as offline rather than deleted, so that its name and history are kept.
7. As an operator, I want the device page to show the current run and its live events when a run is active, so that I do not have to navigate elsewhere to see what the agent is doing.
8. As an operator, I want to pause the screenshot refresh on the device page, so that I stop hammering the phone when I am not looking.
9. As an operator, I want to set the screenshot refresh interval globally in settings, so that I can trade freshness against load.

### Tasks
10. As an operator, I want to create a task with a name, so that I can find it again.
11. As an operator, I want a task to optionally start with a URL, so that the phone opens that page before the agent begins working.
12. As an operator, I want a task to optionally start with an instruction instead of a URL, so that the agent performs a setup step first.
13. As an operator, I want a task to have a required main goal in natural language, so that the agent knows what to accomplish.
14. As an operator, I want a task to optionally end with an instruction, so that the agent leaves the phone in a known state (for example back on the home screen).
15. As an operator, I want to set per-task agent options: vision on/off, reasoning on/off, and max steps, so that expensive features are only used where needed.
16. As an operator, I want to define custom variables (key/value pairs) on a task, so that prompts can reference them and I can reuse one task with different data.
17. As an operator, I want to edit an existing task, so that I can refine instructions after seeing a run.
18. As an operator, I want to duplicate a task, so that I can create variants quickly.
19. As an operator, I want to delete a task, and be warned if schedules depend on it, so that I do not silently break a schedule.
20. As an operator, I want a task list with name, last run status, last run time and schedule count, so that I can see the state of my automations in one table.
21. As an operator, I want a task not to be bound to a device, so that I can run the same task on any phone.

### Running tasks
22. As an operator, I want to press "Run now" on a task and choose a device, so that I can execute it immediately.
23. As an operator, I want "Run now" to be refused with a clear message if the device already has an active run, so that two agents never fight over one phone.
24. As an operator, I want to be taken to the run page as soon as the run is created, so that I can watch it.
25. As an operator, I want the run page to show a live stream of events (thoughts, actions, tool calls, errors) as they happen, so that I understand what the agent is doing.
26. As an operator, I want the run page to show each step's screenshot as it arrives, so that I can see the phone's state at every step.
27. As an operator, I want a Stop button on a running run, so that I can abort a run that is going wrong.
28. As an operator, I want the run page to show the final result (success/failure, the agent's reason, step count, duration) when it finishes, so that I know the outcome.
29. As an operator, I want a manual run to continue even if I close the browser tab, so that runs are not tied to my session.
30. As an operator, I want a run that was in progress when the server restarted to be marked as lost rather than silently re-run, so that a phone never gets an unexpected duplicate run.
31. As an operator, I want a run to fail cleanly with the error message if the Python service is unreachable, so that I can diagnose infrastructure problems.

### Run history
32. As an operator, I want a run history per task, newest first, with status, device, start time and duration, so that I can review past executions.
33. As an operator, I want a run history per device, so that I can see everything that happened on one phone.
34. As an operator, I want to open any past run and see its full event log and step screenshots, so that I can debug a failure after the fact.
35. As an operator, I want screenshots of old runs to be pruned according to a retention setting while text events are kept, so that the database does not grow without bound.
36. As an operator, I want to delete a single run and its screenshots, so that I can remove noise.
37. As an operator, I want skipped scheduled runs to appear in history with the reason "device busy", so that I can see when a schedule could not fire.

### Schedules
38. As an operator, I want to create a schedule for a task on a specific device with an interval in seconds, so that the task repeats automatically.
39. As an operator, I want to set a maximum number of runs on a schedule, or leave it unlimited, so that I can loop a task N times or forever.
40. As an operator, I want a schedule to count only runs that actually started (not skipped ones) toward its maximum, so that a busy phone does not eat my run budget.
41. As an operator, I want a schedule to be automatically disabled when its maximum is reached, so that it does not keep firing.
42. As an operator, I want to enable and disable a schedule with a toggle, so that I can pause it without deleting it.
43. As an operator, I want a schedule tick to be skipped (and recorded) when the device is busy, so that runs never overlap on one phone.
44. As an operator, I want the interval to be measured from the end of the previous run rather than a fixed clock, so that a long run does not cause an immediate back-to-back run.
45. As an operator, I want to see the next fire time, last run status and run count on each schedule, so that I know what will happen next.
46. As an operator, I want to edit a schedule's interval, device and maximum, so that I can tune it without recreating it.
47. As an operator, I want to delete a schedule, so that a task stops repeating.
48. As an operator, I want schedules to survive a server restart and resume, so that I do not have to re-enable them after a deploy.
49. As an operator, I want a "Run now" on a schedule that runs the schedule's task on the schedule's device immediately, so that I can test it.

### Settings
50. As an operator, I want to see which LLM provider and model the framework is configured with, so that I know what my runs cost and use.
51. As an operator, I want to set global custom prompt overrides (system prompts for the agent roles), so that every run uses my house style without editing per task.
52. As an operator, I want to manage app cards (per-app instructions) globally, so that the agent gets app-specific hints on every run.
53. As an operator, I want to set the screenshot retention (number of recent runs per task that keep images), so that I control storage.
54. As an operator, I want to see whether the Python execution service is reachable and its version, so that I can diagnose problems.

### Developer / operations
55. As a developer, I want a single `docker-compose.yml` that starts MongoDB, the Python service and the Next.js app, so that the whole stack starts with one command.
56. As a developer, I want the Python service to require a shared token header, so that exposing it beyond localhost later does not require a redesign.
57. As a developer, I want the Python service to hold no persistent state, so that it can be restarted at any time without data loss.
58. As a developer, I want every HTTP contract in both services to be validated (Pydantic on the Python side, Zod on the Node side), so that malformed input fails fast with a useful error.

## Implementation Decisions

### Process architecture
- Two processes plus MongoDB. Next.js (App Router, React 19, shadcn/ui, Tailwind 4) is the UI and the only writer to MongoDB. The Python execution service ("executor") is FastAPI + uvicorn in a new `api/` folder of the app repo, depending on the published `mobilerun` package. The framework repo is untouched.
- Single user, no login. Next.js and the executor communicate over HTTP on localhost. The executor requires an `X-Mobilerun-Token` header equal to its `EXECUTOR_TOKEN` env var; Next.js reads `EXECUTOR_URL` and `EXECUTOR_TOKEN` from env.
- MongoDB accessed through Mongoose; connection string from `MONGODB_URI`. A `docker-compose.yml` runs mongo, the executor and Next.js.
- Scheduling and run orchestration use `@hokify/agenda` (maintained fork of Agenda), started inside the Next.js server from the instrumentation hook on boot, guarded so a duplicate start in dev is harmless. Agenda's Mongo locks handle duplicate processes.
- The executor is stateless across restarts but keeps an in-memory map of active runs (run id → asyncio task, device serial). This map supports cancel and returns 409 if a device is already busy.

### Executor HTTP contract (Python)
- `GET /health` → `{status, version, mobilerunVersion}`.
- `GET /config` → active LLM profiles (provider, model per agent role), read from the framework config. Read-only.
- `GET /devices` → adb device list: `[{serial, model, state}]`.
- `GET /devices/{serial}/screenshot` → `image/png` bytes from the driver's screenshot call. Returns 404 if the device is not listed.
- `POST /runs` with `{runId, deviceSerial, startUrl?, instruction, options: {vision, reasoning, maxSteps}, variables: {k: v}, prompts?: {role: template}, appCards?: [...]}` → 202 `{runId}`. 409 if the device already has an active run. 404 if the device is not listed. The executor opens `startUrl` on the device through an adb VIEW intent before constructing the agent, so the URL open is deterministic and costs no agent steps.
- `GET /runs/{runId}/events` → SSE stream. Event names: `started`, `screenshot` (base64 PNG, step index), `thought`, `action` (tool name, args, summary, success), `plan`, `log`, `result` (`success`, `reason`, `steps`), `error` (message), `cancelled`. Stream ends after `result`, `error` or `cancelled`. If the run id is unknown, 404. A client that connects after the run started receives events from that point on; the executor does not buffer history (Next.js is the history).
- `POST /runs/{runId}/stop` → 202; cancels the asyncio task, emits `cancelled`. 404 if unknown.
- `GET /runs` → list of active runs `[{runId, deviceSerial, startedAt}]` for diagnostics.
- Screenshots per step come from the framework's `ScreenshotEvent`; the executor enables screenshot streaming for every run so images arrive even with vision off.
- The executor constructs `MobileAgent` with the framework config loaded through its normal loader, overriding per-run options (vision, reasoning, max steps) on the config object, passing `variables`, optional `prompts`, and a driver bound to the requested serial. Trajectory saving is disabled; Next.js is the sole history store.

### Instruction composition (Node side)
- Next.js composes one instruction string per run from the task: an optional start instruction section ("First: ..."), the goal, and an optional end section ("When the goal is done, finally: ..."). A start URL is not folded into text; it is sent as `startUrl` and opened by the executor. One agent run per task run; the three-run alternative was rejected because it triples cost and loses context between phases.

### MongoDB schema (Mongoose)
- `devices`: `{serial (unique), displayName?, model?, state: online|offline, lastSeenAt, activeRunId?}`. Upserted from the executor's device list on every poll; `activeRunId` is the device lock, set with an atomic find-and-update where it is null.
- `tasks`: `{name, start?: {type: url|instruction, value}, goal, end?, options: {vision, reasoning, maxSteps}, variables: [{key, value}], createdAt, updatedAt}`.
- `schedules`: `{taskId, deviceSerial, intervalSeconds, maxRuns?: number|null, enabled, runCount, lastRunId?, nextRunAt?, agendaJobId?, createdAt, updatedAt}`.
- `runs`: `{taskId, scheduleId?, deviceSerial, status, trigger: manual|schedule, instruction (composed), startUrl?, options, variables, startedAt?, finishedAt?, result?: {success, reason, steps}, error?, skipReason?, createdAt}`.
- `runEvents`: `{runId, seq, type, at, payload}` where screenshot payloads hold a GridFS file id instead of bytes.
- `screenshots.files` / `screenshots.chunks`: GridFS bucket for step images, metadata `{runId, seq}`.
- `settings` (singleton): `{screenshotIntervalMs, screenshotRetentionRuns, prompts: {role: template}, appCards: [...]}`.

### Run state machine
```
queued ──▶ running ──▶ succeeded
   │           ├──────▶ failed
   │           ├──────▶ cancelled
   │           └──────▶ lost        (server restarted mid-run)
   └──▶ skipped                     (schedule tick, device busy)
```

### Agenda jobs
- `run-task` (data `{runId}`): acquires the device lock, `POST /runs` to the executor, subscribes to the SSE stream, writes each event to `runEvents` (screenshots to GridFS), writes the final status, releases the lock, then applies screenshot retention for that task. Lock lifetime is set above the longest allowed run (derived from max steps and a per-step ceiling). If the job starts and finds its run already in `running`, it marks the run `lost` and exits without contacting the executor.
- `schedule-tick` (data `{scheduleId}`): if the schedule is disabled or missing, cancels itself. If the device lock is held, creates a `skipped` run with `skipReason: device busy` and reschedules. Otherwise creates a `queued` run and runs the `run-task` logic inline, then increments `runCount`; if `maxRuns` is reached, disables the schedule. The next tick is scheduled `intervalSeconds` after the run finishes (interval from end, not fixed clock).
- Manual "Run now" creates a `queued` run and enqueues `run-task` with `now()`, so manual and scheduled runs share one code path and survive a closed tab.
- On boot, all enabled schedules are reconciled with Agenda so they resume after a restart.

### Next.js route handlers (app-facing API)
- `GET /api/devices`, `PATCH /api/devices/:serial` (display name), `GET /api/devices/:serial/screenshot` (proxies the executor, cached for the configured interval).
- `GET|POST /api/tasks`, `GET|PATCH|DELETE /api/tasks/:id`, `POST /api/tasks/:id/duplicate`, `POST /api/tasks/:id/run` (`{deviceSerial}`).
- `GET|POST /api/schedules`, `GET|PATCH|DELETE /api/schedules/:id`, `POST /api/schedules/:id/run`.
- `GET /api/runs` (filters: taskId, deviceSerial, status), `GET|DELETE /api/runs/:id`, `POST /api/runs/:id/stop`, `GET /api/runs/:id/events` (SSE to the browser, replays stored events then tails new ones by polling `runEvents` on a short interval), `GET /api/runs/:id/screenshots/:seq` (GridFS stream).
- `GET|PATCH /api/settings`, `GET /api/executor/health`.
- All request bodies validated with Zod; responses are JSON with a consistent `{error: {code, message}}` envelope on failure.

### UI pages
- `/devices` grid of device cards with refreshing screenshots; `/devices/[serial]` large screen, current run panel, device history.
- `/tasks` table; `/tasks/new` and `/tasks/[id]` form (start, goal, end, options, variables) with Run now and history tab.
- `/schedules` table with enable toggle, next fire, run count; create/edit dialog.
- `/runs/[id]` timeline: events on one side, current/selected step screenshot on the other, Stop button while running, result banner when done.
- `/settings` model info (read-only), executor health, screenshot interval, retention, prompt overrides, app cards.

## Testing Decisions

A good test exercises a process at its public boundary with real inputs and asserts on observable outputs, never on internal function calls. Two seams, one per process, and nothing lower:

1. **Executor HTTP seam.** Tests drive the FastAPI app through an in-process HTTP client. The only fake is an agent factory dependency that returns a scripted fake agent emitting a chosen sequence of framework events (screenshot, action, result, error) and an adb listing stub. Tests cover: device list, screenshot bytes, 404 on unknown device, 409 on busy device, SSE event ordering and termination, stop producing `cancelled`, token rejection with 401. Prior art: the framework repo's pytest suite (async tests with fixtures); the app repo has no Python tests yet.
2. **Next.js seam.** Tests call route handlers and Agenda job functions against a real in-memory MongoDB (mongodb-memory-server) with the executor replaced by a fake HTTP server that serves the same contract, including SSE streams, from scripted fixtures. Tests cover: task CRUD and validation, run creation writing events and GridFS files, device lock preventing overlap, schedule tick skipping when busy, maxRuns disabling the schedule, lost-run marking on restart, retention pruning, browser SSE replay. Tooling: Vitest. Prior art: none in the app repo (bare scaffold), so these establish the pattern.

UI components are covered by the route/job tests plus a small number of rendering tests only where logic lives in the component (for example the run timeline's step selection). No end-to-end browser tests in this spec.

## Out of Scope

- Cloud devices and iOS devices (the API shape allows adding a driver kind later).
- Video streaming of the phone screen and remote control (tap/swipe) from the browser.
- Multi-user accounts, login, per-user data.
- Cron expressions; only interval + max-runs.
- Editing LLM provider, model or API keys from the UI.
- Custom tools (Python code) and MCP servers per task.
- Sending messages to a running agent.
- Automatic retry of failed or lost runs.
- Structured output models per task.
- Trajectory export, GIF generation, macro record/replay.

## Further Notes

- `DroidAgent` in the docs is a deprecated alias; the executor uses `MobileAgent`.
- The framework's own trajectory saving is disabled in the executor to avoid a second, unmanaged history on disk.
- The framework configures logging and tracing at module level; the executor initialises these once at startup, not per run.
- If the executor is restarted mid-run, the Next.js SSE subscription drops; the `run-task` job marks the run `failed` with the connection error and releases the device lock.
- The framework currently references its own config path via `MOBILERUN_CONFIG`; the compose file mounts the user's config and credentials into the executor container, or the executor runs on the host when USB adb is required. Running adb inside Docker on macOS does not see USB devices, so the default dev setup runs the executor on the host and only mongo in Docker.

# mobilerun app

A local web app for running and scheduling [mobilerun](https://github.com/droidrun/mobilerun) agent tasks on
Android phones connected over adb. You see every phone with a refreshing screenshot, create tasks (start with a
URL or an instruction, a goal, an ending instruction), run them on a chosen phone while watching the agent's steps
and screenshots live, and schedule them to repeat.

Two processes plus MongoDB:

- **Next.js app** (this folder): the UI and the owner of all data in MongoDB (devices, tasks, schedules, runs,
  run events, step screenshots, settings). Scheduling and run orchestration use [Agenda](https://github.com/hokify/agenda)
  inside the Next.js server process.
- **Executor** (`api/`): a small, stateless FastAPI service wrapping the framework's `MobileAgent`. It lists adb
  devices, takes screenshots, starts runs and streams their events over Server-Sent Events. It stores nothing.

## Prerequisites

- Node 22+ and [uv](https://docs.astral.sh/uv/).
- `adb` on your PATH with phones authorised for USB debugging (`adb devices` must list them as `device`).
- MongoDB, either through Docker (`docker compose up -d`) or a local install:
  `brew tap mongodb/brew && brew install mongodb-community && brew services start mongodb-community`.
- A framework config with an LLM provider and API key. Run `uv tool install mobilerun && mobilerun setup` once,
  or point `MOBILERUN_CONFIG` at a config file. The executor reads the same config the `mobilerun` CLI uses
  (`~/Library/Application Support/droidrun/config.yaml` on macOS). See the
  [configuration docs](https://docs.mobilerun.ai/framework/sdk/configuration).

## Setup

```bash
cp .env.example .env            # set EXECUTOR_TOKEN to any secret string
npm install
(cd api && uv sync --extra dev)
```

## Run in development

The short way, once `make setup` has run:

```bash
make dev        # MongoDB (Docker or Homebrew) + executor + app, Ctrl+C stops all
make check      # typecheck, lint and both test suites
```

Or each process by hand:

```bash
docker compose up -d            # 1. MongoDB (or: brew services start mongodb-community)
EXECUTOR_TOKEN=change-me npm run executor   # 2. executor on the host, port 8765
npm run dev                     # 3. app on http://localhost:3000
```

The executor runs on the host so it can see USB phones. Open Settings in the app to confirm the executor is
reachable and which model is configured, then Devices to see your phones.

## Full stack in Docker

`docker compose --profile full up --build` also builds and runs the app and the executor in containers. This
only works for phones reachable over network adb (`adb connect <ip>`), because a container on macOS cannot see
USB devices. Mount your framework config directory via `MOBILERUN_CONFIG_DIR`. The Dockerfiles are provided
but were not built on a machine without Docker; report issues you hit.

## Production: one container with everything

`Dockerfile.aio` builds a single image containing the executor and the app,
supervised together; only port 3000 is published. MongoDB is not included: point
`MONGODB_URI` at a hosted cluster (e.g. MongoDB Atlas).

```bash
docker build -f Dockerfile.aio -t mobilerun:latest .
docker run -d -p 3000:3000 -v mobilerun-config:/config \
  -e MONGODB_URI='mongodb+srv://...' -e OPENROUTER_API_KEY=... mobilerun:latest
```

Or `docker compose -f docker-compose.prod.yml up -d --build`. The framework config is
seeded into the `/config` volume on first start. See [docker/README.md](docker/README.md)
for USB/adb and day-to-day operation.

## Tests and checks

```bash
npm test                        # Next.js routes and jobs against in-memory MongoDB and a fake executor
npm run test:executor           # executor HTTP contract against a scripted fake framework
npm run check                   # typecheck + lint + both test suites
```

## Environment variables

| Variable           | Used by  | Meaning                                                                            |
| ------------------ | -------- | ---------------------------------------------------------------------------------- |
| `MONGODB_URI`      | app      | MongoDB connection string                                                          |
| `MONGODB_DB`       | app      | Database name; overrides the database in `MONGODB_URI` when set                    |
| `EXECUTOR_URL`     | app      | Base URL of the executor, default `http://127.0.0.1:8765`                          |
| `EXECUTOR_TOKEN`   | both     | Shared secret sent as `X-Mobilerun-Token`; the executor refuses to start without it |
| `EXECUTOR_HOST`    | executor | Bind address, default `127.0.0.1`                                                  |
| `EXECUTOR_PORT`    | executor | Port, default `8765`                                                               |
| `MOBILERUN_CONFIG` | executor | Optional path to a framework config file                                           |
| `TYPESAFE_API_KEY` | executor | Enables the TypeSafe Jev agent; get a key from the [TypeSafe console](https://console.typesafe.ai) |
| `TYPESAFE_MODEL`   | executor | Jev model, default `jev-latest`; pin a fixed version when comparing runs           |
| `TYPESAFE_BASE_URL` | executor | System One API base, default `https://api.typesafe.ai`; `https://openrouter.ai/api` for OpenRouter |

## How runs work

1. "Run now" (or a schedule tick) creates a run document and enqueues an Agenda job.
2. The job takes the device lock, opens the start URL on the phone through an adb intent, starts the agent on the
   executor with the composed instruction, per-task options, variables and memory, plus the global prompt
   overrides from Settings and the app cards from App cards.
3. The executor streams events (thoughts, actions, plans, per-step screenshots, memory changes, result) which the
   job writes to MongoDB; step images go to GridFS and are pruned per the retention setting.
4. Task memory is the key/value facts a task keeps between runs (Memory tab on the task page). The agent sees
   them in its instruction and can change them with the `save_memory` / `delete_memory` tools; each change is
   persisted as it happens, so a run that fails halfway still leaves what it learned.
5. The run page receives events pushed from the job over SSE. Stop cancels the agent on the executor; if the
   executor is unreachable the stop fails rather than pretending the phone stopped.
6. Schedules re-plan the next tick from the end of each run, record a skipped run when the device is busy or
   offline, and disable themselves at their max run count.
7. After a server restart, in-flight runs reattach to the executor's stream from the last stored event; a run is
   marked lost only when the executor no longer knows it. Scheduled runs finished this way still count toward
   their schedule.
7. App cards are read by the framework's planner (reasoning on). With reasoning off they are appended to the
   instruction as app guidance so they still reach the model.

## Agents: mobilerun or TypeSafe Jev

Each task picks the engine that drives the phone under Agent options:

- **mobilerun** (default): the framework's agent with the LLM from the framework config. Vision, reasoning,
  prompt overrides, app cards and the memory tools apply.
- **TypeSafe Jev**: a port of [droidrun/mobile-jev](https://github.com/droidrun/mobile-jev) running in the
  executor over adb and Portal (no Mobilerun cloud device needed). Each step, code lists the controls on screen
  and [Jev](https://docs.typesafe.ai) picks one operation (open app, tap, type, scroll, back, home, enter, wait,
  done, blocked) and its target in a single request. Code checks that the target is unchanged before acting and
  never retries an action whose outcome is uncertain. Set `TYPESAFE_API_KEY` on the executor; Settings shows
  whether it is configured.

To use Jev through [OpenRouter](https://openrouter.ai/typesafe/jev-1.13) instead, billed to your OpenRouter
account, set `TYPESAFE_BASE_URL=https://openrouter.ai/api`. The executor then uses `OPENROUTER_API_KEY` unless
`TYPESAFE_API_KEY` is set. OpenRouter serves the same System One API, so nothing else changes.

Jev types only exact text: spans of up to eight words from the goal, plus the values of the task's variables
and memory. Put field values that are not in the goal in a variable. It sees task variables, memory and the app
card of the foreground app as context, but cannot change memory, and vision, reasoning and prompt overrides do
not apply. Jev's "done" is the model's claim, reported as such in the result; it is not independent
verification. Start URLs, end steps, stop, step screenshots and schedules work as for mobilerun.

## Troubleshooting

- **Executor unreachable** on Settings: it is not running, `EXECUTOR_URL` is wrong, or the tokens differ.
- **No devices**: run `adb devices`; `unauthorized` means the phone has not accepted the USB debugging prompt.
- **Run fails immediately with a config error**: the framework config has no API key for the configured
  provider. Run `mobilerun setup` or `mobilerun configure <provider>`.
- **Screenshots are slow**: raise the refresh interval in Settings; each refresh is one adb screencap.

## Layout

- `app/` pages and route handlers, `components/` UI, `lib/` data access, jobs and the executor client, `tests/` Vitest.
- `api/executor/` the FastAPI service, `api/tests/` pytest.
- `docs/specs/` the feature spec; `.scratch/device-task-runner/issues/` the ticket files.

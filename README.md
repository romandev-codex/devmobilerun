# mobilerun app

A local web app for running and scheduling [mobilerun](https://github.com/droidrun/mobilerun) agent tasks on
Android phones connected over adb. Two processes plus MongoDB:

- **Next.js app** (this folder): the UI and the owner of all data (devices, tasks, schedules, runs) in MongoDB.
  Scheduling runs inside the Next.js server via Agenda.
- **Executor** (`api/`): a small stateless FastAPI service wrapping the framework's `MobileAgent`. It lists adb
  devices, takes screenshots, runs tasks and streams their events. It stores nothing.

## Prerequisites

- Node 22+, [uv](https://docs.astral.sh/uv/), `adb` on your PATH with phones authorised for USB debugging.
- MongoDB. Either `docker compose up -d` (needs Docker) or a local install:
  `brew tap mongodb/brew && brew install mongodb-community && brew services start mongodb-community`.
- A framework config with an LLM provider and API key. Run `uv tool install mobilerun && mobilerun setup`
  once, or point `MOBILERUN_CONFIG` at a config file. See the
  [configuration docs](https://docs.mobilerun.ai/framework/sdk/configuration).

## Setup

```bash
cp .env.example .env            # set EXECUTOR_TOKEN to any secret string
npm install
(cd api && uv sync --extra dev)
```

## Run in development

```bash
# 1. MongoDB
docker compose up -d            # or brew services start mongodb-community

# 2. Executor (on the host, so it can see USB phones)
cd api && EXECUTOR_TOKEN=change-me uv run mobilerun-executor

# 3. App
npm run dev                     # http://localhost:3000
```

The executor runs on the host rather than in Docker because adb inside a container on macOS cannot see USB
devices.

## Tests

```bash
npm test                        # Next.js routes and jobs against in-memory MongoDB and a fake executor
(cd api && uv run pytest)       # executor HTTP contract against a scripted fake framework
npm run typecheck && npm run lint
```

## Environment variables

| Variable         | Used by  | Meaning                                                            |
| ---------------- | -------- | ------------------------------------------------------------------ |
| `MONGODB_URI`    | app      | MongoDB connection string                                          |
| `EXECUTOR_URL`   | app      | Base URL of the executor, default `http://127.0.0.1:8765`          |
| `EXECUTOR_TOKEN` | both     | Shared secret sent as `X-Mobilerun-Token`; the executor refuses to start without it |
| `EXECUTOR_HOST`  | executor | Bind address, default `127.0.0.1`                                  |
| `EXECUTOR_PORT`  | executor | Port, default `8765`                                               |
| `MOBILERUN_CONFIG` | executor | Optional path to a framework config file                         |

## Layout

- `app/` pages and route handlers, `components/` UI, `lib/` data access and executor client, `tests/` Vitest.
- `api/executor/` the FastAPI service, `api/tests/` pytest.
- `docs/specs/` the feature spec; `.scratch/` local ticket files.

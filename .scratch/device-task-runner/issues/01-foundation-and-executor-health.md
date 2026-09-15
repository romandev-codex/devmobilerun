# 01: Foundation: settings page shows executor health and active model

**What to build:** Opening the Settings page shows whether the Python execution service ("executor") is reachable, its version, and the LLM provider/model per agent role read from the framework config. This is the first tracer bullet through both processes and MongoDB, and it lays the shared foundation every later ticket builds on: the executor skeleton (FastAPI, shared-token auth, health and config endpoints, pytest harness with an in-process client), the Next.js data layer (Mongoose connection from `MONGODB_URI`, Zod validation, error envelope, Vitest with in-memory MongoDB and a fake executor server), the executor client module in Next.js, the app shell with navigation (Devices, Tasks, Schedules, Runs, Settings), and a compose file that starts MongoDB.

**Blocked by:** None (can start immediately)

**Status:** done

- [ ] `api/` folder contains a FastAPI app with `GET /health` returning status, service version and mobilerun version, and `GET /config` returning provider and model per agent role from the framework config
- [ ] Every executor endpoint rejects requests without a correct `X-Mobilerun-Token` header with 401
- [ ] Executor pytest suite runs the app through an in-process HTTP client and covers health, config and token rejection
- [ ] Next.js connects to MongoDB using `MONGODB_URI` with a singleton connection safe under dev hot reload
- [ ] `GET /api/executor/health` proxies the executor and returns a structured error envelope when it is unreachable
- [ ] Settings page renders executor status, versions and model table, and a clear "executor unreachable" state
- [ ] Vitest suite runs route handlers against in-memory MongoDB and a fake executor HTTP server; at least the health route is covered
- [ ] App shell with sidebar navigation to all planned sections, placeholder pages allowed
- [ ] `docker-compose.yml` starts MongoDB; `.env.example` documents `MONGODB_URI`, `EXECUTOR_URL`, `EXECUTOR_TOKEN`; README explains starting mongo, executor and app

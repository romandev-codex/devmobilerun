# 08: Interrupted runs are marked lost, unreachable executor fails cleanly

**What to build:** If the Next.js server restarts while a run is in progress, that run is marked lost and is not re-run on the phone. If the executor cannot be reached or drops the stream mid-run, the run is marked failed with the error and the device is released. On boot, stale device locks are cleared and Agenda state is reconciled.

**Blocked by:** 05 Run task now

**Status:** ready-for-agent

- [ ] `run-task` that starts and finds its run already in `running` marks it `lost` and exits without contacting the executor
- [ ] Executor unreachable at start, or SSE drop before a terminal event, results in status `failed` with the error message and a released device lock
- [ ] On boot, runs in `running` whose job is no longer active are marked lost and their device locks cleared
- [ ] Run page and run lists render lost and failed states distinctly with the error text
- [ ] Tests cover lost marking on re-entry, failure on connection drop using the fake executor, and boot cleanup

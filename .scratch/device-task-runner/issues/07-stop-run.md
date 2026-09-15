# 07: Stop a running task

**What to build:** The run page shows a Stop button while a run is in progress. Pressing it aborts the agent on the phone, the run ends with status cancelled, the device becomes free, and the timeline shows the cancellation.

**Blocked by:** 05 Run task now

**Status:** done

- [ ] Executor `POST /runs/{id}/stop` cancels the run's asyncio task, emits `cancelled` on the SSE stream, removes it from the active map; 404 for unknown run
- [ ] `POST /api/runs/:id/stop` forwards to the executor; `run-task` sets status cancelled and releases the device lock
- [ ] Run page Stop button with confirmation, disabled once the run is terminal
- [ ] Device card and device page show the device as idle immediately after a stop
- [ ] Tests cover executor cancellation and the Next.js status transition

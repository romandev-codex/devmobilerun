# 11: Schedule max runs, run now, and resume after restart

**What to build:** A schedule can have a maximum number of runs; only runs that actually started count, and the schedule disables itself when the maximum is reached. The operator can edit interval, device and maximum in place, and press Run now on a schedule to execute its task on its device immediately. Enabled schedules resume automatically after the server restarts.

**Blocked by:** 10 Schedules basic

**Status:** done

- [ ] `maxRuns` nullable on schedules; the tick disables the schedule and cancels its job once `runCount` reaches `maxRuns`; skipped runs do not increment `runCount`
- [ ] `PATCH` on a schedule re-plans its Agenda job when interval, device or maximum change
- [ ] `POST /api/schedules/:id/run` creates a manual run on the schedule's device and enqueues it; refused with 409 when busy
- [ ] On boot, every enabled schedule without a live Agenda job is re-planned
- [ ] Schedules page shows "N of M runs" or "N runs, unlimited", an edit dialog, and a Run now action
- [ ] Tests cover max-runs disable, edit re-planning, run now, and boot reconciliation

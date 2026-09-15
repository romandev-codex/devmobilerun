# 10: Schedule a task to repeat on an interval, skipping when the device is busy

**What to build:** The operator creates a schedule for a task on a device with an interval in seconds and toggles it on or off. While enabled, the task runs repeatedly, with the next run starting the interval after the previous one finished. If the device is busy when a tick is due, the tick is recorded as a skipped run with reason "device busy" and the schedule waits for the next interval. The Schedules page lists schedules with next fire time, last run status and run count.

**Blocked by:** 05 Run task now

**Status:** ready-for-agent

- [ ] `schedules` collection matching the spec; `GET|POST /api/schedules`, `GET|PATCH|DELETE /api/schedules/:id` with validation (interval a positive integer, task and device must exist)
- [ ] `schedule-tick` Agenda job: exits and cancels itself if the schedule is disabled or deleted; creates a `skipped` run when the device lock is held; otherwise creates a run, executes the run-task logic inline, increments `runCount`, and schedules the next tick `intervalSeconds` after the run finished
- [ ] Enabling a schedule creates its Agenda job and sets `nextRunAt`; disabling cancels the job
- [ ] Schedules page with create/edit dialog, enable toggle, next fire time, last run status, run count; Tasks table shows real schedule count and task delete warns about dependent schedules
- [ ] Skipped runs appear in run history with the skip reason
- [ ] Tests cover tick execution, skip-when-busy, interval-from-end scheduling, and toggle behaviour, using Agenda against in-memory MongoDB and the fake executor

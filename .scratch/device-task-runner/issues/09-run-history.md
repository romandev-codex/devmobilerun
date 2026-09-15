# 09: Run history per task and per device, run detail for past runs, delete run

**What to build:** Each task has a History tab and each device page has a history list, both newest first with status, device or task, trigger, start time and duration. Opening any past run shows its full event log and step screenshots exactly as during the live run. A run can be deleted together with its screenshots. A global Runs page lists everything with filters.

**Blocked by:** 06 Step screenshots

**Status:** done

- [ ] `GET /api/runs` with filters for task, device, status and trigger, paginated, newest first
- [ ] `DELETE /api/runs/:id` removes the run, its events and its GridFS files; refused while the run is active
- [ ] Task History tab, device page history list, and a global Runs page with filters
- [ ] Run page works identically for finished runs (no live tail) and shows skipped runs with their skip reason once schedules exist
- [ ] Tests cover filtering, pagination and cascading delete

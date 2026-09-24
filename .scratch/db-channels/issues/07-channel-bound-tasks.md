# 07: Channel-bound tasks

**What to build:** A task can be bound to a DB channel from the task form. Every run of such a task consumes exactly one record: when the run is created the app claims the next pending record, merges the record's fields into the run's variables (stringified) and appends a "Record to process" block to the goal, and stores which record the run holds. When the run reaches a terminal status the record is settled: `succeeded` marks it `done`, `failed` marks it `failed` (both with a result carrying the run id, reason and steps), and `cancelled`, `lost` or `skipped` hands it back to `pending` at its original queue position. A record an operator already changed by hand is left alone. An interval tick on an empty channel records a skipped run with a "no pending records" reason; queue dispatch skips a channel task whose channel is empty and tries the next runnable schedule. The run page links to the record's channel and the records table and dialog link a record's `result.runId` to the run. The Python executor is not changed.

**Blocked by:** 06 Edit, reset and purge records

**Status:** done

- [x] `Task.channel` (slug or null) validated with the slug rule and checked to exist on create and update (`404 not_found` "Channel"); included in the task view and summary; copied by duplicate
- [x] `Run.dbRecord` (`{ channel, recordId }` or null) stored on claim and exposed in the run view as strings
- [x] Run creation claims the oldest pending record atomically, builds variables and the instruction block from it, and refuses with `409 conflict` when the channel is empty; a failed run write undoes the claim; skipped runs never claim
- [x] Every terminal-status write settles the record (finish path and the queued-run cancel path), only while the record is still `processing`; settling is idempotent and never throws
- [x] Interval tick on an empty channel records a skipped run with the "has no pending records" reason; queue dispatch passes over a channel task with nothing pending and picks the next runnable schedule
- [x] Task form "Channel" select (None plus every channel) with helper text; task table shows the channel as a badge; run page shows "Record `<id>` from channel `<slug>`" linking to the channel; records table and dialog link `result.runId` to the run
- [x] Spec section "Channel-bound tasks" (data model, claim, settle table, schedule behaviour)
- [x] Tests at the route seam: unknown channel is refused and a valid one round-trips and clears; run-now claims the oldest record into the run's variables, instruction and `dbRecord`; empty channel answers `409` with no run and no device lock; succeeded and failed runs settle the record with the run id; stopping a queued run returns the record to pending and the next `get` hands it out; a record set by hand while the run is running is not overwritten; tick on an empty channel records the skip and queue dispatch skips to the next schedule

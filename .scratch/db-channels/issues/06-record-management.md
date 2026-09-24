# 06: Edit, reset and purge records

**What to build:** From the channel page the operator can fix or clean up work without touching the API by hand. Per record: edit `data` as JSON, change status from a select, delete. Per channel: add a single record by hand from a small JSON dialog, reset every `processing` record back to `pending`, delete all records with a chosen status, and clear the whole channel behind a confirmation. Counts and the table refresh after every action.

**Blocked by:** 04 Browse a channel's records

**Status:** ready-for-agent

- [ ] Operator API: update a record's `data` and/or `status`, delete one record, bulk reset `processing` to `pending`, bulk delete by status, clear channel; all scoped to the channel in the path so a record id from another channel answers `404 not_found`
- [ ] Record dialog gains an editable JSON textarea for `data` (invalid JSON blocks save with a message), a status select, and a delete button with confirmation
- [ ] Channel page header gains "Add record", "Reset processing", "Delete by status" and "Clear channel" actions; clear and delete-by-status confirm and state how many records will be affected
- [ ] Tests at the route seam: edit data round-trips; status change via the operator route; reset touches only `processing`; delete-by-status touches only that status; clear empties the channel and leaves other channels intact

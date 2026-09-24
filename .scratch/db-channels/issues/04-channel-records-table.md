# 04: Browse a channel's records

**What to build:** The channel page shows per-status counts in its header and a paginated table of records, newest first, with status filter tabs. Clicking a row opens a read-only dialog with the record's `data`, `result`, status and timestamps (including how long it has been `processing`). The channel list page shows the same per-status counts for every channel.

**Blocked by:** 02 Worker queue API

**Status:** ready-for-agent

- [ ] Operator API: list records for a channel with `status` filter and pagination (page size and page or cursor), get one record, per-status counts included in the channel list and channel detail responses
- [ ] Channel list page shows pending / processing / done / failed counts per channel
- [ ] Channel page: counts in the header, status filter tabs (all plus each status), paginated table (id, status badge, a truncated preview of `data`, created, claimed), row click opens the detail dialog
- [ ] Tests at the route seam: pagination boundaries, status filter returns only that status, counts match what was added and claimed

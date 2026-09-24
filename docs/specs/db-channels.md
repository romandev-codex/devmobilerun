# Spec: DB channels (FIFO record queue for external workers)

Status: ready-for-agent
Repo: `app/mobilerun`. New module; independent of the Task / Run / Schedule pipeline described in `device-task-runner.md`.

Vocabulary used here, chosen to avoid clashing with existing terms:

- **Channel** — a named queue. Identified by a URL-safe slug.
- **Record** — one JSON object stored in a channel, with a lifecycle status. Deliberately not called a "task" because `Task` already means a phone-automation instruction.
- **Worker** — an external process (what the request calls a "task agent") that consumes records over HTTP. Deliberately not called an "agent" because `agent` already means the LLM engine that drives the phone.
- **Operator** — a human using the web UI.

## Problem Statement

An operator has lists of things for external workers to process: leads to contact, URLs to check, accounts to act on. Today there is nowhere in mobilerun to put such a list. The operator keeps it in a spreadsheet or a file, hands slices to workers by hand, and has no shared record of which items are untouched, in progress, finished or failed. When two workers pull from the same list they collide; when a worker dies mid-item the item is silently lost.

## Solution

A **DB channels** module: a simple queue-style store on top of MongoDB.

- The operator creates channels in the UI, fills them by uploading a JSON file or pasting JSON into a textarea, chooses which fields of each object to keep, and then manages the resulting records (filter by status, edit, reset, delete).
- Workers use a four-call HTTP API per channel: **get** the next pending record (FIFO, atomically claimed so no two workers receive the same one), **add** records, **set** a record's status and result, and **undo** a claim so the record is handed out again.
- A channel holds an unbounded number of records. Every record has a `status` that starts as `pending`.

## User Stories

### Channels

1. As an operator, I want to create a channel with a slug name and optional description, so that I have a named queue for one kind of work.
2. As an operator, I want channel names validated as URL-safe slugs and unique, so that the API path for a channel is predictable and unambiguous.
3. As an operator, I want to see a list of all channels with per-status record counts, so that I can tell at a glance how much work is waiting, running, done or failed.
4. As an operator, I want to rename a channel's description without touching its records, so that I can keep notes current.
5. As an operator, I want to delete a channel and have all of its records removed with it, so that no orphaned data lingers.
6. As an operator, I want a DB entry in the sidebar navigation, so that the module is reachable like Tasks, Runs and Schedules are.

### Importing data

7. As an operator, I want to upload a `.json` file containing an array of objects, so that I can bulk-load records from another system.
8. As an operator, I want to paste JSON into a textarea instead of uploading a file, so that small batches are quick.
9. As an operator, I want the UI to reject input that is not a JSON array of objects with a clear message, so that I know what to fix.
10. As an operator, I want to see every top-level key found across the pasted objects, with how many objects contain it, so that I understand the shape of the data before importing.
11. As an operator, I want to tick or untick keys and have only the ticked keys stored on each record, so that I can drop columns I do not need workers to see.
12. As an operator, I want all keys ticked by default, so that the common case is one click.
13. As an operator, I want a preview of how many records will be created before I confirm, so that I do not accidentally import ten thousand rows.
14. As an operator, I want imported records to be `pending` and ordered after any existing records, so that FIFO order is preserved across imports.

### Managing records

15. As an operator, I want a paginated table of a channel's records, newest first, so that large channels stay usable.
16. As an operator, I want to filter the table by status, so that I can look at only failed or only processing records.
17. As an operator, I want to open a record and see its stored data, its result and its timestamps, so that I can inspect what a worker did with it.
18. As an operator, I want to edit a record's data as JSON, so that I can fix a bad row without re-importing.
19. As an operator, I want to change a single record's status from the UI, so that I can retry a failed one or park a pending one.
20. As an operator, I want to delete a single record, so that I can remove junk.
21. As an operator, I want to reset every `processing` record in a channel back to `pending` in one action, so that after a worker crash the stuck items are handed out again.
22. As an operator, I want to delete all records with a given status in one action, so that I can purge finished work.
23. As an operator, I want to clear a whole channel in one action with a confirmation, so that I can reuse it for a new batch.
24. As an operator, I want to add a single record by hand from the channel page, so that I can test a worker without preparing a file.

### Worker API

25. As a worker, I want to call **get** on a channel and receive the oldest `pending` record, so that work is processed first-in first-out.
26. As a worker, I want **get** to atomically mark the record as `processing`, so that a second worker calling at the same instant receives a different record or nothing.
27. As a worker, I want **get** on an empty channel to return an explicit empty result with a success status rather than an error, so that polling loops do not need to treat "no work" as a failure.
28. As a worker, I want **get** to work with either GET or POST, so that a tool that can only issue GETs still works.
29. As a worker, I want to call **add** with one object or an array of objects, so that I can push new work, including follow-up work discovered while processing.
30. As a worker, I want **set** on a record id to update its status and attach a free-form result object, so that I can mark work done or failed and hand back output.
31. As a worker, I want **undo** on a record id to return a `processing` record to `pending`, so that an item I could not finish is retried by the next worker.
32. As a worker, I want the record's own id in every response, so that I can call set or undo later.
33. As a worker, I want the same `{ error: { code, message } }` error envelope the rest of the API uses, so that one error handler works everywhere.
34. As a worker, I want a `not_found` error when the channel slug does not exist, so that a typo is obvious rather than silently creating a channel.
35. As a worker, I want a `conflict` error when I try to undo a record that is not `processing`, so that I cannot accidentally reopen a finished record.
36. As a worker, I want to authenticate with a bearer token when the operator has configured one, so that the queue can be reached from outside a trusted network.
37. As an operator, I want the worker API to require no token when none is configured, so that local setups keep working with zero configuration, matching the rest of the app.

### Robustness

38. As an operator, I want the status values to be a closed set, so that filters and counts are stable and a worker cannot invent a fifth state.
39. As an operator, I want user data stored in its own sub-document so that keys like `status` or `_id` in my JSON can never collide with the record's own fields.
40. As an operator, I want a record to remember when it was claimed, so that I can see how long something has been processing.
41. As a developer, I want the queue operations covered by tests that run against a real MongoDB, so that FIFO order and claim atomicity are proven, not assumed.

## Implementation Decisions

### Placement

- Worker API lives under `/api/db/{channel}/...`, following the existing `/api/...` convention, not literally at `/db/...`. The UI lives at `/db` with a channel detail page at `/db/{channel}`.
- The module follows the existing horizontal layering: Mongoose models, a service module with zod schemas, thin route handlers wrapped in the shared `route()` helper, server-component pages that call the service directly, and client components that mutate through the shared client fetch helpers and then refresh the router.
- A new sidebar item labelled **DB** is added to the navigation array.

### Data model

Two collections.

**DbChannel**

| Field | Type | Meaning |
| --- | --- | --- |
| `name` | string, unique, `^[a-z0-9][a-z0-9_-]{0,63}$` | Slug used in API paths and UI URLs. Immutable after creation. |
| `description` | string, optional | Free text for operators. |
| `createdAt` / `updatedAt` | dates | Standard timestamps. |

**DbRecord**

| Field | Type | Meaning |
| --- | --- | --- |
| `channel` | string | Slug of the owning channel. Denormalised so worker calls need no join. |
| `status` | `"pending" \| "processing" \| "done" \| "failed"` | Lifecycle state. Defaults to `pending`. |
| `data` | object | The operator's or worker's JSON object, stored verbatim under this key. |
| `result` | object, optional | Free-form output written by a worker via set. |
| `claimedAt` | date, optional | Set when get hands the record out; cleared by undo. |
| `createdAt` / `updatedAt` | dates | Standard timestamps. |

Indexes: `{ channel, status, _id }` on records (serves get, filters and counts); unique `{ name }` on channels.

FIFO order is `_id` ascending. ObjectIds are time-ordered at the second, with a per-process counter breaking ties, which is sufficient for this use.

Status is a closed enum; the service rejects anything else with a validation error.

### Status machine

```
pending ──get──▶ processing ──set(done)───▶ done
   ▲                 │       └set(failed)─▶ failed
   └──────undo───────┘
```

- `get` moves exactly one `pending` record to `processing` using a single `findOneAndUpdate` sorted by `_id` ascending, so concurrent callers are serialised by MongoDB and never share a record. It stamps `claimedAt`.
- `undo` requires the record to be `processing`; otherwise `conflict`. It clears `claimedAt` and returns the record to `pending`, keeping its original `_id` so it goes back to its original queue position.
- `set` accepts `{ status?, result? }`. Any of the four statuses is allowed, including moving directly to `pending`; the UI's per-row status change uses the same operation. `result` replaces the previous result wholesale.
- There is no automatic lease timeout. A record stays `processing` until a worker sets or undoes it or an operator resets it. This is a deliberate first-version choice; see Out of Scope.

### Worker API contract

All paths are prefixed by `/api/db/{channel}` where `{channel}` is the slug. Responses use the app's existing envelope conventions: a named key on success, `{ error: { code, message } }` on failure.

| Operation | Method(s) | Body | Success |
| --- | --- | --- | --- |
| get next | `GET` or `POST` `/get` | none | `200 { record }` where `record` is the claimed record or `null` |
| add | `POST` `/add` | one object, or an array of objects | `201 { records: [...] }` |
| set | `PATCH` or `POST` `/set/{id}` | `{ status?, result? }`, at least one key | `200 { record }` |
| undo | `POST` `/undo/{id}` | none | `200 { record }` |

A record in responses is `{ id, channel, status, data, result, claimedAt, createdAt, updatedAt }`.

Errors: unknown channel → `404 not_found`; invalid id → `404 not_found`; undo on a non-processing record → `409 conflict`; bad body → `400 validation_error`; missing or wrong bearer token when one is configured → `401 unauthorized`.

An `add` body that is an array is limited to 10 000 objects per call; each element must be a plain object.

### Operator API (used by the UI)

Also under `/api/db`, following the same envelope:

- Channels: list (with per-status counts), create, update description, delete (cascades to records).
- Records for a channel: list with `status` filter and cursor or page-based pagination, get one, update `data` / `status`, delete one.
- Bulk on a channel: reset all `processing` to `pending`; delete all records with a given status; clear channel.
- Import reuses the worker `add` service function after the UI has already filtered keys client-side, so the server has a single insertion path.

### Authentication

- A new optional environment variable, `DB_API_TOKEN`, is added to the env schema.
- When set, every request under `/api/db/*` must carry `Authorization: Bearer <token>`; otherwise `401` with a new `unauthorized` error code added to the shared error-code union.
- When unset, no check is performed, matching the rest of the app, which has no authentication.
- The check lives in the db route handlers (a small helper called at the top of each), not in global middleware, so no other route's behaviour changes.

### UI

- **Channel list page** (`/db`): table of channels with counts per status and a "New channel" dialog (name, description). Row click opens the channel page.
- **Channel page** (`/db/{channel}`): header with description, counts, and the channel's API base path shown as copyable text so an operator can paste it into a worker config. Below: import panel and records table.
- **Import panel**: file input accepting `.json` and a textarea, either of which populates the same parsed array. On successful parse the panel shows the detected top-level keys as checkboxes with per-key occurrence counts, all checked by default, and an "Import N records" button. Parsing happens client-side; only the filtered objects are sent to the server.
- **Records table**: status filter tabs, pagination, newest first. Row actions: view/edit (dialog with a JSON textarea for `data`, read-only `result`, and a status select), delete. Bulk actions in the header: reset processing, delete by status, clear channel (confirm dialog).
- Built with the existing shadcn/ui primitives already in the repo (table, dialog, select, textarea, badge, button).

## Testing Decisions

**Seam**: the HTTP route handlers, called directly as functions with `Request` objects against a per-test-file MongoDB database provided by mongodb-memory-server. This is the seam every existing API test in the repo already uses, so no new seam is introduced. The service layer is exercised through the routes, not tested separately.

**What a good test looks like**: it makes the same calls a worker or the UI would make and asserts on status codes and response bodies. It does not import models to inspect documents, and it does not assert on internal function calls.

**Prior art**: the existing tasks and schedules API tests, which build small helper functions that import a route module, invoke its exported handler with a constructed `Request` and a `params` promise, and return `{ status, body }`.

**Cases to cover**

1. Creating a channel, listing it, and rejecting a duplicate or malformed slug.
2. Adding a single object and an array; both come back `pending` with ids.
3. `get` returns records in insertion order across two separate adds.
4. Concurrent `get` calls (fired with `Promise.all`) on a channel with N pending records return N distinct records and then `null`.
5. `get` on an empty channel returns `200 { record: null }`; `get` on an unknown channel returns `404`.
6. `undo` returns a processing record to pending and it is handed out first by the next `get`; `undo` on a pending or done record returns `409`.
7. `set` changes status and stores a result; a bad status returns `400`.
8. Deleting a channel deletes its records.
9. Bulk reset and delete-by-status affect only the targeted status.
10. With `DB_API_TOKEN` set, a request without the header gets `401` and one with the correct bearer succeeds; with it unset, requests succeed without a header.

## Out of Scope

- **Lease timeouts / auto-undo** of stale `processing` records. Operators reset them by hand or workers undo them. A per-channel visibility timeout can be added later without changing the API.
- **Priority or delayed records.** Strict FIFO only.
- **Per-channel tokens.** One shared token or none.
- **Nested key selection, renaming or type coercion on import.** Top-level keys, keep or drop only.
- **Duplicate detection on import.**
- **Export of a channel to JSON.**
- **Retention or automatic purge** of done records.
- **Editing a channel's slug** after creation.
- **Long-polling or SSE** for workers waiting on an empty channel; workers poll.
- Any integration with the existing Task / Run / Schedule pipeline. This module is a standalone store that external workers happen to use.

## Further Notes

- The user's original request used the paths `/db/channel/get`, `/db/channel/add`, `/db/channel/set/id`, `/db/channel/undo/id`. `channel` and `id` are read as placeholders. The `/api` prefix and the acceptance of GET on `/get` are the spec author's recommendations from the design review and were not overridden.
- The decisions on status enum, `data` wrapper, single collection, bearer-token auth, bulk `add`, and UI scope were likewise put to the user as recommendations during the design review and are adopted here as stated. Any of them can be revised before implementation begins.
- The existing Agenda job queue is intentionally not reused: it models internal, code-defined jobs with handlers in-process, whereas channels hold opaque data consumed by processes outside the app.

# 02: Worker queue API: add, get, set, undo

**What to build:** An external worker can drive a channel entirely over HTTP. `add` pushes one object or an array of objects as `pending` records. `get` hands out the oldest `pending` record and atomically marks it `processing` with a `claimedAt` stamp, so concurrent workers never receive the same record; on an empty channel it returns a success response with `record: null`. `set` changes a record's status and stores a free-form `result`. `undo` returns a `processing` record to `pending` at its original queue position. After this ticket the full worker lifecycle is demoable with curl.

**Blocked by:** 01 Create, list and delete channels

**Status:** done

- [ ] Routes under `/api/db/{channel}`: `GET|POST /get`, `POST /add`, `PATCH|POST /set/{id}`, `POST /undo/{id}`; responses use `{ record }` / `{ records }` envelopes and records are serialised as `{ id, channel, status, data, result, claimedAt, createdAt, updatedAt }`
- [ ] `get` uses a single atomic find-and-update sorted by `_id` ascending; `undo` requires status `processing` and answers `409 conflict` otherwise; `set` validates status against the closed enum and requires at least one of `status` / `result`
- [ ] `add` accepts a plain object or an array of plain objects, caps arrays at 10 000, and stores each object verbatim under `data`
- [ ] Unknown channel slug and invalid or unknown record id both answer `404 not_found`
- [ ] Tests at the route seam: add single and array; FIFO order across two adds; N concurrent `get` calls return N distinct records then `null`; `get` on empty and unknown channels; `undo` re-queues at the front and rejects non-processing records; `set` stores status and result and rejects a bad status

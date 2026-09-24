# 01: Create, list and delete channels

**What to build:** The operator opens a new **DB** entry in the sidebar, sees a list of channels, creates one from a dialog (slug name plus optional description), edits its description, and deletes it. Deleting a channel removes any records it holds (the records collection is created now so the cascade is real, even though nothing writes records until 02). Channel names are validated as unique URL-safe slugs and are immutable after creation. Clicking a channel opens `/db/{channel}`, which for now shows only the channel header and its worker API base path as copyable text.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] `DbChannel` model (unique slug `name`, optional `description`, timestamps) and `DbRecord` model (`channel`, closed-enum `status` defaulting to `pending`, `data`, optional `result`, optional `claimedAt`, timestamps) with the compound `{ channel, status, _id }` index
- [ ] Operator API under `/api/db`: list channels, create channel, update description, delete channel with record cascade; zod validation in the service; existing `route()` envelope and error codes
- [ ] Nav item **DB** pointing at `/db`
- [ ] `/db` page listing channels (name, description, created) with a "New channel" dialog and delete with confirmation; `/db/{channel}` page with header, description and the copyable API base path; unknown slug renders not found
- [ ] Tests at the route seam: create, duplicate slug rejected, malformed slug rejected, description update, delete removes the channel and its records

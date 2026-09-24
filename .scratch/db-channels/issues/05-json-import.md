# 05: Import records from JSON

**What to build:** On the channel page the operator either uploads a `.json` file or pastes JSON into a textarea. The input must be an array of plain objects; anything else shows a clear error. On a successful parse the panel lists every top-level key found across the objects with a count of how many objects contain it, all ticked by default. Unticking a key drops it from every object. The button reads "Import N records"; clicking it creates N `pending` records through the same insertion path workers use and refreshes the table and counts.

**Blocked by:** 04 Browse a channel's records

**Status:** ready-for-agent

- [ ] Import panel on the channel page with file input (`.json`) and textarea feeding one shared parse step; parse and key filtering happen client-side
- [ ] Key checklist with per-key occurrence counts, all checked by default; only checked keys are sent
- [ ] Clear validation messages for non-JSON, non-array, and arrays containing non-objects; empty array disables the button
- [ ] Import posts the filtered objects to the worker `add` route (or the operator equivalent that reuses the same service function) and shows a success count; a failure surfaces the API error message
- [ ] Imported records land after existing ones in FIFO order (verified by a route-seam test that adds, imports, then `get`s in order)

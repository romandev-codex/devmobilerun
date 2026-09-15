# 02: Devices page lists connected phones with names and online state

**What to build:** The Devices page shows every Android phone the executor sees over adb as a card with serial, model, online/offline state and a friendly display name the operator can edit. Devices that disappear from adb stay in the list as offline. Each card shows whether a run is active on the device (always idle in this ticket, wired later).

**Blocked by:** 01 Foundation

**Status:** ready-for-agent

- [ ] Executor `GET /devices` returns serial, model and state for each adb device
- [ ] `devices` collection upserts from the executor list on every `GET /api/devices`, marking devices missing from the list as offline while keeping their document
- [ ] `PATCH /api/devices/:serial` updates the display name with validation
- [ ] Devices page renders cards with name (falls back to model or serial), serial, state badge, and an inline name editor
- [ ] Devices page shows a clear message when the executor is unreachable or no devices are connected
- [ ] Executor tests cover the device list with a stubbed adb listing; Next.js tests cover upsert, offline marking and rename

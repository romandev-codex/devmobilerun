# 03: Live-ish phone screens via refreshing screenshots

**What to build:** Every device card shows a screenshot of the phone that refreshes on a configurable interval, and the single-device page shows a large refreshing screenshot with a pause toggle. The refresh interval is a global setting on the Settings page.

**Blocked by:** 02 Device list

**Status:** done

- [ ] Executor `GET /devices/{serial}/screenshot` returns PNG bytes; 404 for unknown serial
- [ ] `GET /api/devices/:serial/screenshot` proxies the executor with a cache no shorter than the configured interval, so several open cards do not multiply adb calls
- [ ] `settings` singleton with `screenshotIntervalMs`; `GET|PATCH /api/settings` with validation; Settings page exposes the interval
- [ ] Device cards refresh their image on the interval; device page shows a large image with a Pause/Resume toggle and stops fetching while paused or when the tab is hidden
- [ ] Offline devices show a placeholder instead of erroring
- [ ] Tests cover the executor screenshot endpoint, the proxy cache, and settings validation

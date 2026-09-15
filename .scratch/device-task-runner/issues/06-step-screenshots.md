# 06: Step screenshots in the run timeline with retention

**What to build:** While a run is in progress the run page shows the phone's screenshot for each step next to the events, and the operator can click any past step to see its image. Screenshots are stored in MongoDB and pruned per task according to a retention setting so only the most recent N runs keep images.

**Blocked by:** 05 Run task now

**Status:** ready-for-agent

- [ ] Executor enables screenshot streaming for every run and emits `screenshot` SSE events with base64 PNG and step index, even with vision off
- [ ] `run-task` writes each screenshot to a GridFS bucket with run id and step metadata and stores the file id in the event payload
- [ ] `GET /api/runs/:id/screenshots/:seq` streams the image
- [ ] Run page shows the latest screenshot live and lets the operator select any step to view its screenshot
- [ ] `settings.screenshotRetentionRuns` editable on the Settings page; after a run finishes, images of older runs of the same task beyond the retention count are deleted while their text events remain
- [ ] Tests cover GridFS persistence from the fake executor stream and retention pruning

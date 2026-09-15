# 04: Create, edit, duplicate and delete tasks

**What to build:** The operator can create a task with a name, an optional start (a URL or an instruction), a required goal, an optional end instruction, agent options (vision, reasoning, max steps) and custom variables (key/value list); edit it, duplicate it and delete it. The Tasks page lists tasks with name, last run status and time (empty until runs exist) and schedule count (zero until schedules exist).

**Blocked by:** 01 Foundation

**Status:** ready-for-agent

- [ ] `tasks` collection matching the spec schema; `GET|POST /api/tasks`, `GET|PATCH|DELETE /api/tasks/:id`, `POST /api/tasks/:id/duplicate` with Zod validation (goal required, start type is url or instruction, URL validated, max steps a positive integer, variable keys unique and identifier-like)
- [ ] Task form page for new and existing tasks with all fields, variables editor, and validation messages
- [ ] Tasks table with name, last run status/time placeholders, schedule count placeholder, and row actions run (disabled until 05), duplicate, delete
- [ ] Delete is confirmed; the confirmation lists dependent schedules once they exist (the check is written now against the schedules collection and simply returns zero)
- [ ] Tests cover validation errors, CRUD round trip and duplicate naming

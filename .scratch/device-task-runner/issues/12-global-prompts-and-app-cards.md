# 12: Global prompt overrides and app cards applied to every run

**What to build:** On the Settings page the operator can set system prompt overrides for the agent roles and maintain a list of app cards (per-app instructions). Every run started afterwards passes these to the executor, which applies them to the agent. Custom variables defined on a task are available inside the prompt templates.

**Blocked by:** 05 Run task now

**Status:** done

- [ ] `settings.prompts` keyed by the framework's prompt roles and `settings.appCards` list, editable with validation on the Settings page
- [ ] `run-task` includes the current prompts and app cards in `POST /runs`; the executor passes prompts to `MobileAgent` and provides app cards through an in-memory app card provider for that run
- [ ] A run records the prompt overrides and app cards it was started with, visible on the run page
- [ ] Executor tests verify the agent factory receives prompts and app cards; Next.js tests verify they are sent and recorded

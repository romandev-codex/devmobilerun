# 13: One-command stack and operator documentation

**What to build:** A developer can start MongoDB, the executor and the Next.js app with documented commands, and the README explains the host-versus-Docker choice for the executor (adb inside Docker on macOS cannot see USB phones), required environment variables, how the framework config and API keys are found, and how to run both test suites.

**Blocked by:** 11 Schedules max runs and resume, 12 Global prompts and app cards

**Status:** done

- [ ] `docker-compose.yml` defines mongo, executor and app services; the executor service is documented as optional with the host-run default for USB adb
- [ ] Executor Dockerfile and app Dockerfile build successfully
- [ ] Root scripts or a Makefile start the executor on the host and the app in dev mode against the compose MongoDB
- [ ] README covers setup, environment variables, framework config location, running tests for both processes, and troubleshooting adb visibility

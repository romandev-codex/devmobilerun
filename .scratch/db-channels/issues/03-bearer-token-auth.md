# 03: Optional bearer token for the DB API

**What to build:** When the operator sets `DB_API_TOKEN` in the environment, every request under `/api/db/*` must carry `Authorization: Bearer <token>` or it is rejected with `401` and a new `unauthorized` error code. When the variable is unset nothing changes, so local setups keep working with zero configuration. The channel page's API base path hint mentions the header when a token is configured.

**Blocked by:** 02 Worker queue API

**Status:** done

- [ ] `DB_API_TOKEN` added as an optional entry in the env schema and documented in the env example file
- [ ] `unauthorized` added to the shared error-code union; a small helper called at the top of every `/api/db` handler (operator and worker routes alike) enforces the token, no global middleware
- [ ] UI fetches from the operator pages are unaffected because they run same-origin against server components, or, if they go through the client fetch helper, they attach the token from a server-rendered prop; whichever path is chosen, the UI keeps working with the token set
- [ ] Tests: with the token set, a request without the header gets `401 unauthorized`, a wrong token gets `401`, the right token succeeds; with it unset, requests succeed without a header

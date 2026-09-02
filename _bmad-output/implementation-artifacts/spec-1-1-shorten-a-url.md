---
title: 'Story 1.1: Shorten a URL'
type: 'feature'
created: '2026-09-02'
status: 'done'
baseline_revision: '962fa3d44c95f138acdda2b94bc65f28241363b6'
review_loop_iteration: 0
followup_review_recommended: true
context: []
warnings: [oversized]
deferred:
  - summary: >-
      The shared pg.Pool has no pool.on('error', ...) handler for idle/background connection errors.
    evidence: |-
      src/repos/db.js constructs `new Pool(...)` but registers no error listener; an async
      connection-level error on an idle client would crash the whole Node process
      (per Node's EventEmitter unhandled-error behavior).
    location: >-
      src/repos/db.js
    severity: medium
  - summary: >-
      src/index.js calls process.exit(1) on bootstrap failure without closing the pool.
    evidence: |-
      bootstrapSchema() rejecting logs and exits without releasing pool resources first;
      harmless at process-exit but not a clean shutdown.
    location: >-
      src/index.js
    severity: low
  - summary: >-
      No .env.example documents the required environment variables.
    evidence: |-
      DATABASE_URL, BASE_URL, and PORT are required for the app to run correctly but are
      only documented in the (gitignored-style) .env file itself, not in a checked-in example.
    severity: low
  - summary: >-
      src/app.js has no error-handling middleware after the router.
    evidence: |-
      routes/links.js calls next(err) for any non-400 error, which falls through to
      Express's default error handler instead of a controlled JSON error response.
    location: >-
      src/app.js
    severity: low
  - summary: >-
      redis and amqplib are unused dependencies, and the pg pool has no SSL configuration.
    evidence: |-
      package.json lists redis/amqplib for later epics (unused by this story); pg.Pool is
      constructed without SSL options, which most managed Postgres providers require in production.
    location: >-
      src/repos/db.js
    severity: low
  - summary: >-
      No test covers routes/links.js's next(err) path for a non-400 error.
    evidence: |-
      Only the 400 (invalid URL) error path is exercised by shorten.test.js; a real
      insertLink/database failure falling through to next(err) has no test coverage.
    location: >-
      src/routes/links.js
    severity: low
---

<intent-contract>

## Intent

**Problem:** The API only has a `/health` route; there is no way to submit a long URL and get back a short code, and no `links` table exists yet.

**Approach:** Add `POST /shorten` (routes → services → repos, per the architecture spine's layered paradigm) that validates the URL, generates a base62 (~7 char) code, persists `{ code, long_url, click_count: 0 }` to Postgres, and returns `201 { shortUrl, code }`. Bootstrap the `links` schema once at pool-init time in a new `src/repos/db.js`, which constructs but does not connect the shared `pg.Pool` at import time.

## Boundaries & Constraints

**Always:**
- Layering: `routes/links.js` → `services/shortenService.js` → `repos/db.js` + `repos/linksRepo.js`. Services never touch `req`/`res`; repos never call services; routes never call repos directly (AD-1).
- One shared `pg.Pool`, created once in `src/repos/db.js`, imported by `linksRepo.js` — no repo creates its own pool/client (AD-5).
- `src/repos/db.js` exports a `bootstrapSchema()` function that runs `CREATE TABLE IF NOT EXISTS links (id SERIAL PRIMARY KEY, code VARCHAR UNIQUE NOT NULL, long_url TEXT NOT NULL, click_count INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMP NOT NULL DEFAULT now())` exactly once (AD-7). This must be invoked explicitly at server boot (from `src/index.js`, before/around `app.listen`) — never automatically as a side effect of `require`-ing `db.js` (AD-8).
- The `pg.Pool` is constructed but not connected at module-import time; connection happens only when `src/index.js` calls `bootstrapSchema()` at boot, or lazily on first real query (AD-8, NFR3). `require('./app')` alone (as tests do) must never touch a live Postgres — importing `db.js`/`linksRepo.js` transitively via `app.js` must only construct the `Pool` object, not query it.
- Code is auto-generated only: base62 (`[A-Za-z0-9]`), ~7 characters. No `code`/`alias` field is ever read from the request body (FR1, FR2).
- `shortUrl` = `BASE_URL` env var + code, never hardcoded.
- Error shape on invalid input: `400 { "error": "url must be a valid http(s) URL" }`.
- `url` is valid only if it parses as an absolute URL with scheme `http` or `https`.

**Block If:** None identified — ACs and architecture spine fully determine behavior for this story.

**Never:** Do not implement `GET /:code` (redirect) or `GET /:code/clicks` — out of scope for this story (Story 1.2 / Epic 2). Do not implement Redis, RabbitMQ, or `pino` logging — not required by this story's ACs. Do not add short-code collision retry/backoff (explicitly deferred by the architecture spine).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Valid https URL | `{ "url": "https://example.com/very/long/path" }` | `201 { "shortUrl": "<BASE_URL><code>", "code": "<code>" }`; row inserted in `links` with `click_count = 0` | No error expected |
| Valid http URL | `{ "url": "http://example.com" }` | `201` as above | No error expected |
| Missing `url` field | `{}` | `400 { "error": "url must be a valid http(s) URL" }` | Validation error, no DB write |
| Non-string / empty `url` | `{ "url": "" }` or `{ "url": 123 }` | `400 { "error": "url must be a valid http(s) URL" }` | Validation error, no DB write |
| Malformed URL | `{ "url": "not a url" }` | `400 { "error": "url must be a valid http(s) URL" }` | Validation error, no DB write |
| Non-http(s) scheme | `{ "url": "ftp://example.com/file" }` | `400 { "error": "url must be a valid http(s) URL" }` | Validation error, no DB write |
| Custom code/alias supplied | `{ "url": "https://example.com", "code": "custom1" }` | `201`; supplied `code` is ignored, server generates its own | No error — extra field silently ignored |
| Server boot | `src/index.js` starts and calls `bootstrapSchema()` | `CREATE TABLE IF NOT EXISTS links (...)` runs once against the pool | If Postgres is unreachable, the bootstrap query rejects — surfaced as a boot-time failure, not swallowed |
| Module require only (no boot) | test/route code does `require('../app')` without calling `bootstrapSchema()` | Pool object constructed, no query issued, no connection attempted | N/A — this is the lazy-connect guarantee (AD-8) |

</intent-contract>

## Code Map

- `src/app.js` -- existing Express app (`express.json()` already wired); mount the new router here: `app.use(require('./routes/links'))`.
- `src/index.js` -- existing boot entrypoint (`app.listen`); must call `bootstrapSchema()` from `repos/db.js` at boot, before/around `app.listen`, so the schema exists once the server starts accepting requests (AD-7/AD-8 — bootstrap runs at explicit boot time, not at module import).
- `src/__tests__/health.test.js` -- existing test pattern to follow: `require('supertest')` + `require('../app')`, no live services touched.
- `package.json` -- dependencies already present: `express ^5.2.1`, `pg ^8.23.0`; devDeps `jest ^30.5.1`, `supertest ^7.2.2`. No new dependencies needed (base62 code generated via Node's built-in `crypto`).
- `.env` -- `DATABASE_URL`, `BASE_URL` already defined; use both via `process.env`, no new vars.
- **New files to create:**
  - `src/repos/db.js` -- shared `pg.Pool` (constructed, not connected, at import — `new Pool({ connectionString: process.env.DATABASE_URL })`), plus an exported `bootstrapSchema()` async function that runs the `CREATE TABLE IF NOT EXISTS links` DDL against the pool. `bootstrapSchema()` is NOT auto-invoked at module load — `require`-ing `db.js` must only construct the `Pool`, never query it (AD-8). Export both `pool` and `bootstrapSchema`.
  - `src/repos/linksRepo.js` -- `insertLink({ code, longUrl })` running `INSERT INTO links (code, long_url) VALUES ($1, $2)` (click_count/created_at default). Imports `pool` from `db.js`; no pool of its own.
  - `src/services/shortenService.js` -- `generateCode()` (base62, 7 chars, via `crypto.randomBytes`), `isValidHttpUrl(url)` (uses `new URL(url)` guarded in try/catch, checks `protocol` is `http:`/`https:`), and `shortenUrl(url)` orchestrating validate → generate → `linksRepo.insertLink` → return `{ code }`. No `req`/`res` here.
  - `src/routes/links.js` -- Express `Router()`; `POST /shorten` reads `req.body.url`, calls `shortenService.shortenUrl`, on success responds `201 { shortUrl: process.env.BASE_URL + code, code }`, on invalid input responds `400 { error: 'url must be a valid http(s) URL' }`.
  - `src/__tests__/shorten.test.js` -- Supertest suite covering the I/O matrix above. Mock/stub `linksRepo.insertLink` (e.g. `jest.mock('../repos/linksRepo')`) so tests never touch a live Postgres, matching the existing "no live services" test convention (`bootstrapSchema`'s pool query must not run/fail in this path — mock `../repos/db` too if `linksRepo`'s mock doesn't already prevent it from executing).

## Tasks & Acceptance

**Execution:**
- `src/repos/db.js` -- create shared lazy-connect `pg.Pool` + exported `bootstrapSchema()` (one-time `CREATE TABLE IF NOT EXISTS links (...)`, not auto-run at import) -- AD-5, AD-7, AD-8
- `src/repos/linksRepo.js` -- add `insertLink({ code, longUrl })` using the shared pool -- AD-5, keeps repo layer infra-only
- `src/services/shortenService.js` -- add URL validation, base62 code generation, and `shortenUrl(url)` orchestration -- keeps business logic out of routes (AD-1)
- `src/routes/links.js` -- add `POST /shorten` route wiring validation errors to `400` and success to `201` -- AD-1 (routes own HTTP status/shape only)
- `src/app.js` -- mount `routes/links.js` -- exposes the new endpoint
- `src/index.js` -- call `bootstrapSchema()` at boot, before/around `app.listen` -- AD-7/AD-8, table exists once the server accepts traffic without connecting at import time
- `src/__tests__/shorten.test.js` -- cover every I/O matrix row with mocked repo -- keeps suite runnable with no live services (per project convention and NFR3)

**Acceptance Criteria:**
- Given a valid http(s) URL in the request body, when `POST /shorten` is called, then the response is `201` with `{ "shortUrl": "<BASE_URL><code>", "code": "<code>" }` and the mapping is persisted to `links` with `click_count` defaulting to `0`.
- Given the server has not yet bootstrapped its schema, when `src/index.js` boots and calls `bootstrapSchema()`, then it runs `CREATE TABLE IF NOT EXISTS links (...)` once, so the table always exists before any query runs.
- Given a missing, malformed, or non-http(s) `url` field, when `POST /shorten` is called, then the response is `400 { "error": "url must be a valid http(s) URL" }`.
- Given no `code`/`alias` field is accepted, when `POST /shorten` is called with one supplied anyway, then the system ignores it and always auto-generates the short code itself (base62, ~7 chars).
- Given the app module is required directly (as `src/__tests__/*.test.js` does via `require('../app')`), then no live Postgres connection is attempted — the pool is constructed but not connected at import time.

## Spec Change Log

## Review Triage Log

### 2026-09-02 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 4 (high 0, medium 4, low 0)
- defer: 6 (high 0, medium 1, low 5)
- reject: 7 (high 0, medium 0, low 7)
- addressed_findings:
  - `[medium]` `[patch]` shorten.test.js's BASE_URL assertions were tautological because `process.env.BASE_URL` is unset in the test run, comparing `"undefined<code>"` to itself — fixed by pinning a real BASE_URL value for the test process.
  - `[medium]` `[patch]` No test exercised src/index.js's boot sequencing (bootstrap-before-listen; exit-on-bootstrap-failure) required by the AC on schema bootstrap — added a dedicated index.js test.
  - `[medium]` `[patch]` src/repos/linksRepo.js's actual SQL/parameter binding was never executed by any test (always mocked in shorten.test.js) — added a direct unit test for insertLink.
  - `[medium]` `[patch]` click_count defaulting to 0 was asserted nowhere (db.test.js's regex only checked the DDL prefix) — strengthened the DDL assertion to check for click_count/DEFAULT 0.
## Verification

**Commands:**
- `npm test` -- expected: all tests pass, including the new `shorten.test.js` suite, with no live Postgres/Redis required.

**Manual checks (if no CLI):**
- Inspect `src/repos/db.js` to confirm `bootstrapSchema()` is exported but not called at module scope, and `src/index.js` calls it explicitly at boot — so `require('../app')` (as tests do) never issues a query or opens a connection.

## Auto Run Result

Status: done

**Summary of implemented change:** Added `POST /shorten` end-to-end (routes → services → repos, one-way layering per AD-1) — validates a submitted URL as an absolute http(s) URL, generates a base62 ~7-char code, persists `{code, long_url}` to Postgres (click_count defaults to 0 via DDL), and returns `201 { shortUrl, code }` or `400 { error }`. Added `src/repos/db.js` with a shared, lazy-connect `pg.Pool` and an explicit `bootstrapSchema()` (`CREATE TABLE IF NOT EXISTS links (...)`) invoked once from `src/index.js` at boot — never as an import side effect (AD-5, AD-7, AD-8, NFR3).

**Files changed:**
- `src/repos/db.js` (new) — shared `pg.Pool` construction (not connected at import) + exported `bootstrapSchema()`.
- `src/repos/linksRepo.js` (new) — `insertLink({ code, longUrl })` against the shared pool.
- `src/services/shortenService.js` (new) — URL validation, base62 code generation, `shortenUrl(url)` orchestration.
- `src/routes/links.js` (new) — `POST /shorten` route: 201 on success, 400 on invalid input.
- `src/app.js` (modified) — mounts the new `routes/links.js` router.
- `src/index.js` (modified) — calls `bootstrapSchema()` before `app.listen`, exits with an error on bootstrap failure.
- `src/__tests__/shorten.test.js` (new) — covers every I/O matrix row (valid http/https, missing/empty/non-string/malformed/non-http(s) url, ignored custom code); pins `BASE_URL` to a real value so shortUrl composition is genuinely asserted.
- `src/__tests__/db.test.js` (new) — asserts the pool is constructed without querying at require time, and that `bootstrapSchema()` issues the full `CREATE TABLE ... click_count INTEGER NOT NULL DEFAULT 0` DDL.
- `src/__tests__/linksRepo.test.js` (new) — asserts `insertLink`'s exact SQL text and `[code, longUrl]` parameter order against a mocked pool.
- `src/__tests__/index.test.js` (new) — asserts boot sequencing: `bootstrapSchema()` resolving → `app.listen` called; rejecting → `app.listen` not called and `process.exit(1)` called.

**Review findings breakdown:**
- Patches applied (4, all medium): tautological BASE_URL test assertions (fixed by pinning a real value); missing test coverage for `index.js` boot sequencing (added); `linksRepo.insertLink`'s real SQL/param binding never executed by any test (added direct unit test); `click_count DEFAULT 0` never asserted in the DDL check (strengthened).
- Deferred (6): no `pool.on('error', ...)` handler (medium); `process.exit(1)` without closing the pool on bootstrap failure (low); no `.env.example` (low); no error-handling middleware in `app.js` beyond Express's default (low); unused `redis`/`amqplib` deps + no pg SSL config (low); no test for `routes/links.js`'s non-400 `next(err)` path (low).
- Rejected (7, out of scope for this story): missing redirect endpoint / click_count never incremented (Story 1.2/Epic 2); short-code collision retry (explicitly deferred by architecture spine and FR2); SSRF/allow-list protection (never required, hobby-scope MVP); URL max-length validation (not required); migration framework/extra indexes (contradicts AD-7's explicit "no migration framework"); request logging/pino (explicitly excluded by this story's spec `Never` boundary); `bootstrapSchema` hang/timeout handling (hobby-scope MVP, not required).

**Follow-up review recommendation:** `true` — 4 patched findings, all medium severity (0 high, 4 medium, 0 low); score = 3×4 + 1×0 = 12 ≥ 5.

**Verification performed:** `npm test` run independently after the implementation subagent's initial pass (2 suites, 9 tests, all passing) and again after patches were applied (5 suites, 14 tests, all passing). Matrix Test Audit: all 9 I/O-matrix rows now covered by a passing test, including the two rows (server boot, module-require-only) that initially lacked coverage and were added during the Verify step. Manually inspected `src/repos/db.js`/`src/index.js` to confirm `bootstrapSchema()` is not auto-invoked at module load.

**Residual risks:** The 6 deferred items above are real but intentionally out of this story's scope; most notable is the missing `pool.on('error', ...)` handler (medium severity — an idle-client connection error could crash the process in production). None block this story's acceptance criteria.


---
title: 'Story 1.2: Redirect through a short code with cache-aside lookup'
type: 'feature'
created: '2026-09-02'
status: 'done'
baseline_revision: '1a6fe717a2ab1632880fc9fb95fa5d821253b1d8'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: [oversized]
deferred:
  - summary: >-
      The Redis client in src/repos/cache.js has no client.on('error', ...) handler for
      connection-level errors.
    evidence: |-
      src/repos/cache.js constructs `createClient(...)` but registers no error listener; an
      async connection-level error (e.g. an idle connection drop) would crash the whole Node
      process (per Node's EventEmitter unhandled-error behavior). Mirrors the same deferred
      item already logged for src/repos/db.js's pg.Pool in Story 1.1.
    location: >-
      src/repos/cache.js
    severity: medium
  - summary: >-
      No graceful shutdown / client.quit() is wired into app lifecycle for the Redis client.
    evidence: |-
      Nothing in this story's diff or the existing app lifecycle closes the Redis connection on
      process exit; harmless at process-exit but not a clean shutdown. Mirrors Story 1.1's
      deferred item about process.exit(1) not closing the pg.Pool.
    location: >-
      src/repos/cache.js
    severity: low
---

<intent-contract>

## Intent

**Problem:** `POST /shorten` (Story 1.1) persists `{code, long_url}` to Postgres, but there is no way to resolve a short code back to its long URL — no `GET /:code` route exists, and no Redis client/wrapper exists yet.

**Approach:** Add `GET /:code` (routes → `services/redirectService.js` → `repos/cache.js` + `repos/linksRepo.js`) implementing cache-aside: check Redis (`shorturl:{code}`) first; on hit, `302` redirect straight from Redis with no Postgres query; on miss, query Postgres via `linksRepo`, and if found, populate Redis before responding `302`; if not found in either, or the code fails the base62 format check, respond `404`.

## Boundaries & Constraints

**Always:**
- Layering unchanged: `routes/links.js` → `services/redirectService.js` → `repos/cache.js` + `repos/linksRepo.js`. Services never touch `req`/`res`; repos never call services; routes never call repos directly (AD-1).
- New `src/repos/cache.js` constructs the Redis client (`redis.createClient({ url: process.env.REDIS_URL })`) at module load but does **not** call `.connect()` at import time — connection is lazy, established on first real use (an internal `ensureConnected()`/`isOpen` guard that awaits `.connect()` once). `require('../app')` (as tests do) must never open a live Redis connection (AD-8/NFR3, same guarantee as `db.js`'s `pg.Pool`).
- `cache.js` exports `getCachedUrl(code)` (returns the cached long URL string or `null`) and `setCachedUrl(code, longUrl)` (writes `shorturl:{code}` → `longUrl`, no TTL/expiry).
- `GET /:code` route placement: mounted at root in `routes/links.js` (not nested under `/shorten`), so short links stay bare/shareable.
- Code format validated against `^[A-Za-z0-9]{7}$` before any lookup; a non-matching code short-circuits straight to `404` (no Redis/Postgres call).
- Cache-miss-but-found-in-Postgres path populates Redis with the fetched `long_url` **before** sending the `302` response.
- Response shapes: hit or miss-then-found → `302` with `Location: <long_url>` header, empty body; not found (Postgres miss after cache miss, or malformed code) → `404 { "error": "short code not found" }`.
- `src/repos/linksRepo.js` gains `findByCode(code)` (`SELECT long_url FROM links WHERE code = $1`), reusing the existing shared `pool` from `db.js` — no new pool.

**Block If:** None identified — ACs and architecture spine fully determine behavior for this story.

**Never:** Do not increment `click_count` or publish click events — that is Epic 2 (RabbitMQ/consumer), out of scope here. Do not implement `GET /:code/clicks`. Do not add a Redis TTL/expiry (explicitly deferred by the architecture spine). Do not add `pino` logging (not required by this story's ACs, consistent with Story 1.1's deferral).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Cache hit | `GET /:code`, `shorturl:{code}` present in Redis | `302` `Location: <long_url>` served from Redis; no Postgres query issued | No error expected |
| Cache miss, found in Postgres | `GET /:code`, key absent in Redis, row exists in `links` | `302` `Location: <long_url>` from Postgres; Redis populated with `shorturl:{code}` → `long_url` before the response is sent | No error expected |
| Cache miss, not in Postgres | `GET /:code`, key absent in Redis, no matching row | `404 { "error": "short code not found" }`; no redirect; Redis not populated | Not-found error, no cache write |
| Malformed code | `GET /:code` where code fails `^[A-Za-z0-9]{7}$` (e.g. wrong length, symbols) | `404 { "error": "short code not found" }` immediately | Validation short-circuit — no Redis/Postgres call |

</intent-contract>

## Code Map

- `src/repos/db.js` -- existing shared `pg.Pool`; reuse as-is, no changes.
- `src/repos/linksRepo.js` -- existing `insertLink`; add `findByCode(code)` running `SELECT long_url FROM links WHERE code = $1` against the shared `pool`, returning the row's `long_url` or `undefined`/`null` if not found.
- `src/routes/links.js` -- existing `POST /shorten`; add `GET /:code` calling `redirectService.resolveCode(code)`, mapping its result to `302`/`404`.
- `src/app.js` -- no change needed; `routes/links.js` is already mounted at root via `app.use(require('./routes/links'))`, so a new route added to that router is automatically exposed at root.
- `src/index.js` -- no change; boot sequence (`bootstrapSchema()` then `app.listen`) is unaffected by Redis, which lazy-connects on first real request exactly like `pg.Pool` does today.
- **New files to create:**
  - `src/repos/cache.js` -- Redis client wrapper (`redis` ^6.2.1, already a dependency in `package.json`). `createClient({ url: process.env.REDIS_URL })` at module load, no `.connect()` call at import time. Exports `getCachedUrl(code)` and `setCachedUrl(code, longUrl)`, each internally ensuring the client is connected (e.g. `if (!client.isOpen) await client.connect();`) before issuing `GET`/`SET`.
  - `src/services/redirectService.js` -- `resolveCode(code)`: validates code format (`^[A-Za-z0-9]{7}$`) → on mismatch return `{ found: false }`; else `cache.getCachedUrl(code)` → if hit return `{ found: true, longUrl }`; else `linksRepo.findByCode(code)` → if found, `cache.setCachedUrl(code, longUrl)` then return `{ found: true, longUrl }`; else return `{ found: false }`. No `req`/`res` here.
  - `src/__tests__/redirect.test.js` -- Supertest suite covering the I/O matrix above. Mock `../repos/cache` and `../repos/linksRepo` (and `../repos/db` transitively, matching the `shorten.test.js` convention) so tests never touch live Redis/Postgres; assert the cache-hit path never calls `linksRepo.findByCode`, and the cache-miss-found path calls `cache.setCachedUrl` before the response is sent.
  - `src/__tests__/cache.test.js` -- unit test asserting `cache.js`'s Redis client is constructed but `.connect()` is not called at require time (mirrors `db.test.js`'s pattern for `pg.Pool`), and that `getCachedUrl`/`setCachedUrl` issue the correct `GET`/`SET` calls against a mocked client.
  - `src/__tests__/linksRepo.test.js` -- extend existing suite with a case for `findByCode`'s exact SQL text and parameter binding against a mocked pool.

## Tasks & Acceptance

**Execution:**
- `src/repos/cache.js` -- create Redis client wrapper, lazy-connect, `getCachedUrl`/`setCachedUrl` -- AD-8/NFR3, mirrors `db.js`'s lazy-connect pattern
- `src/repos/linksRepo.js` -- add `findByCode(code)` -- keeps repo layer infra-only (AD-1), reuses shared pool (AD-5)
- `src/services/redirectService.js` -- add `resolveCode(code)` orchestrating format validation → cache lookup → Postgres fallback → cache repopulation -- keeps business logic and cache-aside policy out of routes (AD-1)
- `src/routes/links.js` -- add `GET /:code` route wiring `resolveCode` result to `302`/`404` -- AD-1 (routes own HTTP status/shape only)
- `src/__tests__/redirect.test.js` -- cover every I/O matrix row with mocked cache/repo -- keeps suite runnable with no live services (NFR3)
- `src/__tests__/cache.test.js` -- assert lazy-connect guarantee and correct Redis calls -- AD-8/NFR3
- `src/__tests__/linksRepo.test.js` -- extend with `findByCode` SQL/param assertion

**Acceptance Criteria:**
- Given a short code already cached in Redis (`shorturl:{code}`), when `GET /:code` is called, then the response is `302` with `Location: <long_url>`, served from Redis without querying Postgres.
- Given a short code not in Redis but present in Postgres, when `GET /:code` is called, then the response is `302` with `Location: <long_url>` served from Postgres, and Redis is populated with `shorturl:{code}` → `long_url` before responding.
- Given an unknown or malformed short code, when `GET /:code` is called, then the response is `404 { "error": "short code not found" }` and no redirect occurs.
- Given the app module is required directly (as `src/__tests__/*.test.js` does via `require('../app')`), then no live Redis connection is attempted — the client is constructed but not connected at import time.
- Given a cache-miss-then-Postgres-hit resolution, the value written to Redis is byte-identical to the `long_url` stored in Postgres for that code, so cached and persisted mappings never diverge.

## Spec Change Log

## Review Triage Log

### 2026-09-02 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 2 (high 0, medium 1, low 1)
- defer: 2 (high 0, medium 1, low 1)
- reject: 15 (high 0, medium 0, low 15)
- addressed_findings:
  - `[medium]` `[patch]` `resolveCode` had no error handling around Redis calls, so a Redis outage/error turned an otherwise-available Postgres redirect into a 500 instead of falling back gracefully — fixed by wrapping `cache.getCachedUrl`/`cache.setCachedUrl` in try/catch so a cache read error is treated as a miss (falls through to Postgres) and a cache write error never fails the response; added test coverage for both.
  - `[low]` `[patch]` `cache.js`'s `ensureConnected()` had a race where concurrent cold-cache callers could each see `isOpen === false` and call `client.connect()` concurrently — fixed by tracking a single in-flight connect promise so concurrent callers await the same connect.

## Verification

**Commands:**
- `npm test` -- expected: all tests pass, including the new `redirect.test.js` and `cache.test.js` suites, with no live Postgres/Redis required.

**Manual checks (if no CLI):**
- Inspect `src/repos/cache.js` to confirm the Redis client is constructed but `.connect()` is not called at module scope, so `require('../app')` (as tests do) never opens a live Redis connection.

## Auto Run Result

Status: done

**Summary of implemented change:** Added `GET /:code` end-to-end (routes → `services/redirectService.js` → `repos/cache.js` + `repos/linksRepo.js`, one-way layering per AD-1) implementing cache-aside redirect: validates the code against `^[A-Za-z0-9]{7}$`, checks Redis (`shorturl:{code}`) first and redirects `302` on a hit without touching Postgres, falls back to Postgres on a cache miss and repopulates Redis with the fetched `long_url` before responding `302`, and returns `404 { "error": "short code not found" }` for an unknown or malformed code. Added `src/repos/cache.js` with a lazy-connect Redis client (constructed but not connected at import time, matching `db.js`'s `pg.Pool` pattern — AD-8/NFR3). After review, hardened `resolveCode` to degrade gracefully (fall back to Postgres / never fail the response) on a Redis read/write error, and hardened `cache.js`'s connect guard against a concurrent-connect race.

**Files changed:**
- `src/repos/cache.js` (new) — lazy-connect Redis client wrapper; `getCachedUrl(code)` / `setCachedUrl(code, longUrl)` against `shorturl:{code}` keys, no TTL; `ensureConnected()` guards against concurrent `connect()` calls via a shared in-flight promise.
- `src/services/redirectService.js` (new) — `resolveCode(code)`: format check → cache lookup (error-tolerant) → Postgres fallback → cache repopulation (write failures swallowed, never fail the response).
- `src/repos/linksRepo.js` (modified) — added `findByCode(code)` (`SELECT long_url FROM links WHERE code = $1`) against the shared `pool`.
- `src/routes/links.js` (modified) — added `GET /:code` mounted at root: `302` with `Location` header (empty body via `res.status(302).location(longUrl).end()`) on found, `404` on not-found.
- `src/__tests__/redirect.test.js` (new) — covers every I/O matrix row (cache hit, cache-miss-found, cache-miss-not-found, malformed code, non-base62 code) plus the two review-added resilience cases (cache-read error still redirects from Postgres; cache-write error still redirects).
- `src/__tests__/cache.test.js` (new) — asserts the lazy-connect guarantee (client constructed, not connected, at require time), correct `GET`/`SET` calls, and the review-added concurrency case (two concurrent calls on a cold client result in exactly one `connect()`).
- `src/__tests__/linksRepo.test.js` (modified) — extended with `findByCode`'s exact SQL/param-binding assertion and its not-found case.

**Review findings breakdown:**
- Patches applied (2): `resolveCode` had no error handling around Redis calls, so a cache outage would 500 an otherwise-available Postgres redirect (medium) — fixed with try/catch fallback-to-Postgres and swallowed cache-write errors; `cache.js`'s `ensureConnected()` had a concurrent-connect race (low) — fixed with a shared in-flight connect promise. Both re-verified with `npm test` (7 suites, 28 tests, all passing) after the fix.
- Deferred (2): no `client.on('error', ...)` handler on the Redis client, mirroring Story 1.1's deferred `pool.on('error', ...)` gap (medium); no graceful shutdown/`client.quit()` wired into app lifecycle, mirroring Story 1.1's deferred pool-cleanup gap (low).
- Rejected (15, noise/out-of-scope for this story): no TTL/cache-invalidation (explicit architecture decision — no TTL, deferred by design); `GET /shorten` colliding with `GET /:code`'s format check (not a real bug — resolves correctly to 404 via the normal not-found path); no separate test for cache failures (addressed via the patched tests instead of a standalone item); redirecting without re-validating URL scheme at read time (unreachable — `long_url` is only ever written after write-time http(s) validation in Story 1.1, no update/delete path exists); `REDIS_URL` unvalidated with implicit localhost fallback (consistent with `DATABASE_URL`'s existing, unchanged handling); no logging/observability (explicitly excluded by this story's `Never` boundary, consistent with Story 1.1's pino deferral); `CODE_FORMAT` regex duplicated from the code generator (currently in sync, speculative future-drift concern only); no rate limiting (explicitly out of scope per the epic); empty-string cached/DB value edge cases (unreachable — `long_url` can never be an empty string given Story 1.1's non-empty URL validation); non-divergence invariant asserted only structurally (already exercised by the existing test asserting the exact retrieved value is what's passed to `setCachedUrl`); "no Postgres query" verified via a mocked repo call rather than a live query (the expected/required test shape under NFR3's no-live-services convention); malformed-code check ordering being an unstated implementation choice (the spec explicitly pins the short-circuit ordering, so this is resolved, not open).

**Follow-up review recommendation:** `false` — 2 patched findings (0 high, 1 medium, 1 low); score = 3×1 + 1×1 = 4 < 5.

**Verification performed:** `npm test` run independently after the implementation subagent's initial pass (7 suites, 25 tests, all passing) and again after the two patches were applied (7 suites, 28 tests, all passing). Matrix Test Audit: all 4 I/O-matrix rows (cache hit, cache-miss-found, cache-miss-not-found, malformed code) covered by a passing test both before and after patching, with no regressions. Manually inspected `src/repos/cache.js` to confirm the Redis client is constructed but `.connect()` is not invoked at module scope, and `src/services/redirectService.js`/`src/repos/cache.js` to confirm the patched error-handling and connect-race fixes.

**Residual risks:** The 2 deferred items above are real but intentionally out of this story's scope, consistent with the precedent set by Story 1.1 for the equivalent `pg.Pool` gaps; most notable is the missing `client.on('error', ...)` handler (medium severity — an async Redis connection error outside a request context could still crash the process in production). Neither blocks this story's acceptance criteria, which are all met and covered by passing tests.

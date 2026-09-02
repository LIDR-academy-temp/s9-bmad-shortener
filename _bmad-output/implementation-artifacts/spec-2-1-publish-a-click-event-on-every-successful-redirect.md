---
title: 'Publish a click event on every successful redirect'
type: 'feature'
created: '2026-09-02'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: true
context: []
warnings: ['oversized']
deferred: []
baseline_revision: '3771e036d93ae7cda1a3f33fc0c4b51f58ce13aa'
---

<intent-contract>

## Intent

**Problem:** On every successful redirect the system must fire a click-tracking event, but nothing in the redirect path may block on, or fail because of, that event reaching RabbitMQ.

**Approach:** Add a lazy-connect RabbitMQ repo (`repos/queue.js`) and a `services/clickPublisher.js` that publishes `{ code, timestamp }` to the durable `click-events` queue. `services/redirectService.js` calls the publisher, without awaiting it in a way that blocks the response, on every successful (found) resolution — cache hit or miss.

## Boundaries & Constraints

**Always:**
- Publish only when `resolveCode` determines the code was found (cache hit or Postgres fallback) — never on a 404/not-found outcome.
- Publish body is exactly `{ code: string, timestamp: <ISO 8601 string> }` (use `new Date().toISOString()`).
- Queue is asserted durable: `channel.assertQueue('click-events', { durable: true })`.
- Message is published with `{ persistent: true }`.
- The redirect HTTP response (302) must be sent without waiting for the publish to be acknowledged or consumed — the publish call is fire-and-forget from the route/service's perspective (do not `await` it on the response-critical path).
- Any error from connecting, opening a channel, asserting the queue, or publishing is caught inside the publisher and logged (via `pino`) — it must never reject/throw back into `resolveCode` or the route, and must never turn the redirect into a `500`.
- `repos/queue.js` constructs the amqplib connection lazily: no `amqp.connect(...)` call executes at module `require` time — only on first real publish (AD-8, NFR3, mirrors the pattern in `repos/cache.js` and `repos/db.js`).
- Only `services/redirectService.js` calls the publisher — no other module (routes, shorten path, etc.) invokes `clickPublisher`.
- Follow existing layering: `routes/links.js` never talks to `repos/queue.js` directly; only `services/redirectService.js` -> `services/clickPublisher.js` -> `repos/queue.js`.

**Block If:** None identified — the ACs and architecture spine fully determine behavior.

**Never:**
- Never add a new `docker-compose.yml` service or change the RabbitMQ image tag — out of scope for this story.
- Never implement the consumer or the click-count increment (Story 2.2) or the count query endpoint (Story 2.3) in this story.
- Never let a queue/connection failure surface as a non-302 response or an unhandled rejection.
- Never introduce a new logging library other than `pino`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Cache-hit redirect | Code cached in Redis | 302 response as before; click event `{code, timestamp}` published to `click-events` | No error expected |
| Cache-miss redirect | Code only in Postgres | 302 response as before (cache repopulated per Story 1.2); click event published | No error expected |
| Not-found redirect | Unknown/malformed code | 404 as before | No publish call made |
| RabbitMQ unreachable | `amqp.connect` rejects | 302 still returned, response not delayed | Error caught and logged via pino; no throw |
| Publish/channel error | Channel create, assertQueue, or sendToQueue throws/rejects | 302 still returned | Error caught and logged via pino; no throw |
| Response timing | Publish takes long (e.g. connection setup) | 302 is sent without waiting for the publish promise to settle | N/A |

</intent-contract>

## Code Map

- `src/repos/cache.js` -- existing lazy-connect reference pattern (module-level client construction, `ensureConnected()` guarding a memoized connect promise, reset the memoized promise on failure). Mirror this shape for `repos/queue.js`.
- `src/repos/db.js` -- existing lazy-connect reference pattern for the Postgres pool (construct at require time, no connection until first use).
- `src/services/redirectService.js` -- `resolveCode(code)` is the sole integration point (lines ~6-32). It already has two `found: true` return points: the cache-hit branch (`return { found: true, longUrl: cachedUrl }`) and the Postgres-fallback branch (`return { found: true, longUrl }`, after the best-effort `cache.setCachedUrl` try/catch). Add the fire-and-forget publish call before each of those two returns (or refactor to a single found-path before returning, as long as both hit and miss paths publish and the 404 path does not).
- `src/routes/links.js` -- `GET /:code` handler (lines 20-32) calls `redirectService.resolveCode` then sends 302/404. No changes needed here — publishing must live in the service layer, not the route.
- `src/repos/linksRepo.js` -- read for interface/style parity only; not modified by this story.
- `package.json` -- dependencies: `amqplib` `^2.0.1` is already present (no install needed). `pino` is referenced by the architecture's logging convention but is **not yet installed or used anywhere in the codebase** — add `pino` (`^10.3.1`, per the architecture's stack pinning) as a new dependency and use it for the catch/log path in `clickPublisher.js`.
- `.env` -- `RABBITMQ_URL=amqp://guest:guest@rabbitmq:5672` already defined; no new env vars needed.
- `src/__tests__/cache.test.js`, `src/__tests__/db.test.js` -- existing test style/conventions for lazy-connect repos (mock the underlying client library via `jest.mock`, assert construction happens without connecting, assert connect-on-first-use, `jest.resetModules()` per test). Mirror this for `repos/queue.js` tests, mocking `amqplib`.
- `src/__tests__/redirect.test.js` -- existing redirect route/service tests (mocks `repos/cache` and `repos/linksRepo`, uses supertest against `app`). Add assertions here (or a new `clickPublisher`-focused suite) that a successful redirect never fails or delays even when the publisher rejects.

## Tasks & Acceptance

**Execution:**
- `package.json` -- add `"pino": "^10.3.1"` to `dependencies` -- required for the catch/log behavior mandated by AD-4 and the architecture's logging convention; run `npm install` to update `package-lock.json`.
- `src/repos/queue.js` (new) -- lazy-connect amqplib repo: construct nothing eagerly at require time; expose an async `publishToQueue(message)` that lazily connects, creates a confirm-or-regular channel, asserts `click-events` as `{ durable: true }` (memoized so it only happens once per connection), and calls `channel.sendToQueue('click-events', Buffer.from(JSON.stringify(message)), { persistent: true })`. On any failure, reset the memoized connection/channel promises so a later call can retry, and let the rejection propagate to the caller (the caller — `clickPublisher` — is responsible for catching/logging, per AD-4's separation of concerns) -- implements the durable-queue publish primitive (AD-8, NFR3).
- `src/services/clickPublisher.js` (new) -- exports `publishClickEvent(code)`: builds `{ code, timestamp: new Date().toISOString() }`, calls `queue.publishToQueue(...)`, and internally `.catch()`s any rejection to log it via a module-level `pino()` logger (e.g. `logger.error({ err, code }, 'failed to publish click event')`) so the returned promise never rejects -- implements the catch-and-log guarantee (AD-4) and keeps `pino` as the sole logging path.
- `src/services/redirectService.js` -- import `clickPublisher` and call `clickPublisher.publishClickEvent(code)` (not awaited) immediately before each `found: true` return (cache-hit and Postgres-fallback branches); do not call it on the not-found path -- implements FR6/NFR1 (fire-and-forget publish on every successful redirect only).
- `src/__tests__/queue.test.js` (new) -- unit tests for `repos/queue.js` mirroring `cache.test.js`/`db.test.js` conventions: mock `amqplib`'s `connect`; assert no connection is opened at require time; assert `publishToQueue` connects lazily, creates a channel, asserts the queue durable, and calls `sendToQueue` with `Buffer` payload and `{ persistent: true }`; assert a connect/publish rejection propagates (uncaught) from `publishToQueue` itself (since catching is `clickPublisher`'s job).
- `src/__tests__/clickPublisher.test.js` (new) -- unit tests: mock `repos/queue`; assert `publishClickEvent(code)` calls `queue.publishToQueue` with `{ code, timestamp: <ISO string> }`; assert that when `queue.publishToQueue` rejects, `publishClickEvent`'s returned promise still resolves (never rejects) and the error was logged.
- `src/__tests__/redirect.test.js` -- extend with `jest.mock('../services/clickPublisher')`: assert `publishClickEvent` is called with the resolved code on both the cache-hit and cache-miss 302 paths, and is **not** called on the 404 path; assert the 302 response still resolves promptly even when `clickPublisher.publishClickEvent` is mocked to reject/hang (e.g. return a rejected promise / a promise that never resolves) -- covers the I/O matrix's "response not delayed by publish" and "publish failure never becomes a 500" scenarios.

**Acceptance Criteria:**
- Given a short code cached in Redis, when `GET /:code` is called, then the response is `302` with the correct `Location`, and a click event `{ code, timestamp }` is published to the durable `click-events` queue with `{ persistent: true }`.
- Given a short code resolved via the Postgres fallback (cache miss), when `GET /:code` is called, then the response is `302` with the correct `Location`, and a click event is published the same way.
- Given an unknown or malformed short code, when `GET /:code` is called, then the response is `404` and no click event is published.
- Given RabbitMQ is unreachable or any publish step throws/rejects, when a redirect occurs, then the error is caught and logged via `pino`, and the response is still `302` — never a `500`, and never delayed waiting on the publish settling.
- Given the app module is required without any prior RabbitMQ activity, when `src/repos/queue.js` is loaded, then no `amqplib.connect` call has been made (lazy-connect, AD-8).

## Spec Change Log

## Review Triage Log

### 2026-09-02 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 4 (high 1, medium 1, low 2)
- defer: 0
- reject: 15 (high 0, medium 0, low 15)
- addressed_findings:
  - `high` `patch` `repos/queue.js`'s cached amqp connection/channel had no `error`/`close` listeners; an async broker-initiated error or close would either crash the process (unhandled `error` event) or leave a stale, permanently-broken cached connection/channel reused by every later publish — added listeners that log and reset the memoized promises so the next publish reconnects cleanly.
  - `medium` `patch` no test asserted that two consecutive successful `publishToQueue` calls reuse the cached connection/channel (only "one call" and "fail-then-succeed" were tested) — added a test asserting `amqp.connect`/`createChannel` are each called exactly once across two successful publishes.
  - `low` `patch` the fire-and-forget publish call plus its explanatory comment was duplicated verbatim in both branches of `resolveCode` — extracted into a single local helper to remove the duplication.
  - `low` `patch` the "falls through to Postgres and still redirects 302 when the cache read rejects" test in `redirect.test.js` was the only successful-redirect test not asserting `clickPublisher.publishClickEvent` was called — added the assertion for consistency with the sibling tests covering the same fire-and-forget contract.

Rejected findings (all out of scope for this story's intent — resilience/observability/config polish not required by the spec's Boundaries & Constraints, or already satisfied): no backoff/circuit breaker on reconnect storms, `RABBITMQ_URL` presence/format validation, `QUEUE_NAME` externalized to env, graceful-shutdown hooks, richer click-event schema fields (contradicts the spec's exact `{code, timestamp}` body), publish/failure metrics, `pino` logger configuration (level/redaction/transport), pino dependency version doubt (verified `10.3.1` is a real, currently-installed published version), missing direct test for a synchronous `sendToQueue` throw (already covered indirectly via the `assertQueue`-failure test exercising the same catch/reset path), no README/env-example update, the redundant defensive `.catch()` in `redirectService.js` alongside `clickPublisher`'s internal catch (harmless, intentional belt-and-suspenders), no backpressure/rate-limiting handling, and the intent-alignment audit's "R2" reading that the publish call should sit at the route/response-dispatch boundary rather than inside `redirectService.resolveCode` (this conflicts with the AC's explicit, more specific constraint that only the redirect *service* path may call the publisher — the route must not).

## Design Notes

Keep `repos/queue.js`'s error-propagation and `clickPublisher.js`'s catch-and-log as two distinct responsibilities, mirroring how `redirectService.js` already separates "do the risky thing" (`cache.getCachedUrl`, wrapped in its own try/catch at the call site) from "the service decides what happens on failure." Here the split is across two files instead of one function, but the intent is the same: `repos/queue.js` stays a thin, honest primitive that reports its own failures; `clickPublisher.js` is the one place that decides a publish failure is non-fatal and logs it.

Fire-and-forget shape in `redirectService.js`:

```js
// do not: await clickPublisher.publishClickEvent(code);
clickPublisher.publishClickEvent(code); // intentionally not awaited
return { found: true, longUrl };
```

Since `publishClickEvent` never rejects (it catches internally), this is safe even without a `.catch()` at the call site — but the call is still fire-and-forget by construction, not merely by accident.

## Verification

**Commands:**
- `npm install` -- expected: installs `pino`, updates `package-lock.json`, no errors.
- `npm test` -- expected: all existing and new tests pass, including new `queue.test.js`, `clickPublisher.test.js`, and the extended `redirect.test.js`; no live RabbitMQ/Redis/Postgres connection is required (NFR3).

## Auto Run Result

**Summary:** Every successful redirect (cache hit or Postgres fallback) now fires a fire-and-forget click event `{ code, timestamp }` to the durable `click-events` RabbitMQ queue via a new lazy-connect `repos/queue.js` and `services/clickPublisher.js`. The redirect response never waits on the publish, and any publish/connection failure (including an async broker-initiated error or close) is caught and logged via `pino`, never surfacing as a non-302 response.

**Files changed:**
- `src/repos/queue.js` (new) -- lazy-connect amqplib repo: memoized connection/channel promises, `publishToQueue(message)` asserts `click-events` `{ durable: true }` and sends `{ persistent: true }`; `error`/`close` listeners on both the connection and channel reset the memoized promises and log, so a broker hiccup self-heals on the next publish instead of crashing the process or reusing a dead channel forever.
- `src/services/clickPublisher.js` (new) -- `publishClickEvent(code)` builds `{ code, timestamp }` and catches/logs any `queue.publishToQueue` rejection via a module-level `pino()` logger; its returned promise never rejects.
- `src/services/redirectService.js` -- added a local `trackClick(code)` helper (fire-and-forget, not awaited) called from both the cache-hit and Postgres-fallback `found: true` branches of `resolveCode`; not called on the 404 path.
- `package.json` / `package-lock.json` -- added `pino` `^10.3.1` (installed, verified as a real published version).
- `src/__tests__/queue.test.js` (new) -- lazy-connect assertion, successful publish (durable assert + persistent send), connect/assertQueue failure propagation, reconnect-after-failure, and connection/channel reuse across two successful calls.
- `src/__tests__/clickPublisher.test.js` (new) -- payload shape assertion and catch-and-log-never-rejects assertion.
- `src/__tests__/redirect.test.js` -- extended to assert `clickPublisher.publishClickEvent` is called on cache-hit, cache-miss, and cache-read-reject-then-Postgres-hit paths, not called on 404, and that the 302 response is unaffected when the publisher rejects or hangs.

**Review findings breakdown:** 4 patches applied (1 high, 1 medium, 2 low), 0 deferred, 15 rejected (all out-of-scope resilience/observability/config polish, or already satisfied — see Review Triage Log above for the full breakdown).

**Follow-up review recommendation:** `true` (one patched finding was `high` severity: missing `error`/`close` listeners on the amqp connection/channel, which could otherwise crash the process or wedge the queue client). Patched-finding score: high 1, medium 1, low 2 (3×1 + 1×2 = 5).

**Verification performed:**
- `npm install` -- clean, `pino` installed at `10.3.1`.
- `npm test` -- `Test Suites: 9 passed, 9 total`, `Tests: 38 passed, 38 total`, run twice independently (once by the implementation subagent after patching, once by this workflow run) with identical results.
- I/O & Edge-Case Matrix audit: all six rows (cache-hit publish, cache-miss publish, not-found no-publish, RabbitMQ unreachable, publish/channel error, response-timing-not-delayed) are each covered by a passing test in `queue.test.js`, `clickPublisher.test.js`, or `redirect.test.js`.
- Four independent review layers (blind-hunter, edge-case-hunter, verification-gap, intent-alignment) ran against the diff; all real, in-scope findings were patched and re-verified.

**Residual risks:**
- No backoff/circuit-breaker on repeated reconnect attempts under a sustained RabbitMQ outage (each failed publish immediately retries `amqp.connect` on the next redirect) -- deliberately left out of scope; MVP has no resilience requirement beyond catch-and-log.
- `RABBITMQ_URL` is not validated at startup; a missing/malformed value surfaces as an opaque amqplib error on first publish rather than a fail-fast config error -- deliberately left out of scope.
- Story 2.2 (consumer) and 2.3 (count query endpoint) are not yet implemented, so published click events currently accumulate on the `click-events` queue with nothing consuming them until that story lands.

---
title: 'Consume click events and increment the click count'
type: 'feature'
created: '2026-09-02'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: ['oversized']
deferred:
  - summary: >-
      ensureConsumeChannel's channel error/close listeners (which reset
      consumeChannelPromise) have no direct unit test exercising them.
    evidence: |-
      queue.test.js's new consumeQueue describe block covers lazy connect,
      durable assert, noAck consume, message dispatch, and connect-failure
      propagation, but no test triggers mockChannel.on('error'/'close')
      callbacks to assert consumeChannelPromise resets. This mirrors an
      identical pre-existing gap for the publish channel's own
      error/close listeners in ensureChannel, which are also untested —
      so this is a pre-existing test-coverage pattern surfaced
      incidentally by adding the parallel consume-channel logic, not a
      new problem introduced by this story's design.
    location: >-
      src/repos/queue.js (ensureConsumeChannel channel.on handlers)
    severity: low
baseline_revision: '358dcbf5daf2f150c7165ab5096db3aeaba38580'
---

<intent-contract>

## Intent

**Problem:** Click events already land on the durable `click-events` queue (Story 2.1), but nothing consumes them — `links.click_count` never advances.

**Approach:** Extend `repos/queue.js` with a lazy-connect `consumeQueue(onMessage)` primitive using its own consumer channel, add `services/clickConsumer.js` that parses each message and runs a single atomic `UPDATE links SET click_count = click_count + 1 WHERE code = $1` via a new `linksRepo.incrementClickCount(code)`, and start the consumer from `src/index.js` alongside `app.listen`.

## Boundaries & Constraints

**Always:**
- The increment is exactly one SQL statement: `UPDATE links SET click_count = click_count + 1 WHERE code = $1` — never read-then-write.
- The consumer runs in the same process as Express, started from `src/index.js` at boot — no new service, no `docker-compose.yml` change.
- A message that fails to process (JSON parse error, missing/invalid `code`, DB error) is dropped: no requeue, no retry, no DLQ, and the consumer keeps running for subsequent messages.
- Only `services/clickConsumer.js` calls `linksRepo.incrementClickCount` — `services/redirectService.js` and `routes/links.js` never call it.
- `repos/queue.js`'s consumer channel is opened lazily (first call to `consumeQueue`), mirroring the existing lazy-connect pattern for the publish channel (AD-8, NFR3) — no `amqp.connect` at module `require` time.
- Consume with `{ noAck: true }` (auto-ack on delivery) so a processing failure never triggers RabbitMQ redelivery — this is what "no retry" means at the transport level.
- Errors while starting/holding the consumer connection are caught and logged via `pino`; they must never crash the process or prevent `app.listen` from being called.

**Block If:** None identified — the ACs and architecture spine fully determine behavior.

**Never:**
- Never add a click-event history table — `click_count` is a single counter column (AD-3).
- Never call `linksRepo.incrementClickCount` from the redirect path (AD-4).
- Never implement the count query endpoint (Story 2.3) in this story.
- Never introduce a logging library other than `pino`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Well-formed message | `{ code: "abc1234", timestamp: "..." }` on `click-events` | `UPDATE links SET click_count = click_count + 1 WHERE code = $1` run with `['abc1234']` | No error expected |
| Malformed JSON body | Non-JSON buffer content | Message dropped, error logged via pino, consumer keeps running | Caught in `clickConsumer`, no throw |
| Missing/invalid `code` field | `{ timestamp: "..." }` or `{ code: 123 }` | Message dropped, error logged, no DB call made | Caught in `clickConsumer`, no throw |
| DB error on increment | `linksRepo.incrementClickCount` rejects (e.g. pool error) | Message dropped, error logged, consumer keeps running | Caught in `clickConsumer`, no throw |
| Server boot | `src/index.js` starts after `bootstrapSchema` resolves | Consumer subscribes to `click-events`; `app.listen` is still called even if the initial consumer connect fails | Consumer start failure caught and logged, never rejects into the boot chain |

</intent-contract>

## Code Map

- `src/repos/queue.js` -- existing lazy-connect publisher (`publishToQueue`, module-level `connectionPromise`/`channelPromise`, `error`/`close` listeners that reset promises, `pino()` logger). Add a parallel lazy-connect consumer path: a second memoized `consumeChannelPromise` sharing the same `connectionPromise`/`ensureConnection()`, its own `error`/`close` listeners (reset only `consumeChannelPromise`), and `consumeQueue(onMessage)` that asserts `click-events` `{ durable: true }` then calls `channel.consume(QUEUE_NAME, msg => { if (msg) onMessage(msg.content); }, { noAck: true })`. Rename the internal `ensureChannel` (publish-specific) if needed to disambiguate from the new consumer path; keep `publishToQueue`'s existing behavior and exports unchanged. Export `consumeQueue` alongside `publishToQueue`.
- `src/services/clickConsumer.js` (new) -- mirrors `services/clickPublisher.js`'s shape: module-level `pino()` logger, an internal `handleMessage(content)` that `JSON.parse`s the buffer, validates `code` is a non-empty string, calls `linksRepo.incrementClickCount(code)`, and catches+logs any error from parsing/validation/DB so it never throws/rejects; a `start()` that calls `queue.consumeQueue(handleMessage)` and catches+logs a rejection from that call too (covers the initial connect failure at boot). Export `{ start, handleMessage }` (export `handleMessage` for direct unit testing, same convention as `clickPublisher.publishClickEvent`).
- `src/repos/linksRepo.js` -- add `incrementClickCount(code)`: `await pool.query('UPDATE links SET click_count = click_count + 1 WHERE code = $1', [code])`. Add to `module.exports` alongside `insertLink`/`findByCode`.
- `src/index.js` -- after `app.listen(...)` inside the `bootstrapSchema().then(...)` block, call `clickConsumer.start()`. `clickConsumer.start()` already never rejects (per its own internal catch), so no additional `.catch()` is required at the call site, but do not `await` it before `app.listen` — the server must not block on the consumer subscribing.
- `src/repos/db.js` -- read only; `pool` is imported by `linksRepo.js`, no changes needed.
- `src/services/redirectService.js`, `src/routes/links.js` -- read only, to confirm neither imports `linksRepo.incrementClickCount` or `clickConsumer` (AD-4 boundary check) — no changes.
- `src/__tests__/queue.test.js` -- existing lazy-connect/publish tests to preserve unmodified; extend with a `describe('consumeQueue', ...)` block mocking `channel.consume` mirroring the existing `mockChannel`/`mockConnect` setup: assert no connect at require time (already covered), assert `consumeQueue` connects lazily, asserts the queue durable, and calls `channel.consume` with `{ noAck: true }` and a wrapper that invokes the passed `onMessage` with `msg.content` when a message arrives.
- `src/__tests__/clickPublisher.test.js` -- existing pattern (`jest.mock('../repos/queue')`, `jest.mock('pino', ...)`) to mirror for the new `clickConsumer.test.js`.
- `src/__tests__/linksRepo.test.js` -- existing pattern (`jest.mock('../repos/db', ...)` with a `mockQuery`) to extend with `incrementClickCount` coverage.
- `src/__tests__/index.test.js` -- existing boot-sequencing pattern (`jest.doMock('../app', ...)`, `jest.doMock('../repos/db', ...)`, `flushPromises`) to extend with a `jest.doMock('../services/clickConsumer', ...)` mock and assertions that `clickConsumer.start` is called and that `app.listen` still fires even when `clickConsumer.start` rejects.

## Tasks & Acceptance

**Execution:**
- `src/repos/queue.js` -- add lazy-connect `consumeQueue(onMessage)` sharing the existing connection, its own memoized consumer-channel promise with `error`/`close` listeners, `{ durable: true }` assert, and `channel.consume(QUEUE_NAME, handler, { noAck: true })` -- implements the transport-level "no retry/DLQ" guarantee and lazy-connect (AD-8, NFR3, FR8).
- `src/repos/linksRepo.js` -- add `incrementClickCount(code)` running the single atomic `UPDATE ... click_count = click_count + 1 ...` statement -- implements AD-6/FR7.
- `src/services/clickConsumer.js` (new) -- `handleMessage(content)` parses/validates the message and calls `linksRepo.incrementClickCount`, catching and logging (via `pino`) any parse/validation/DB error so it never throws; `start()` wires `handleMessage` into `queue.consumeQueue` and catches/logs a startup rejection -- implements FR7/FR8/AD-2/AD-4.
- `src/index.js` -- call `clickConsumer.start()` (not awaited, after `app.listen`) once `bootstrapSchema` resolves -- implements AD-2 (consumer boots in the same process as Express).
- `src/__tests__/queue.test.js` -- extend with `consumeQueue` tests per the I/O matrix's transport-level scenarios (lazy connect, durable assert, `noAck: true`, message handed to `onMessage`).
- `src/__tests__/clickConsumer.test.js` (new) -- unit tests covering all five I/O matrix rows: well-formed message increments via `linksRepo.incrementClickCount`; malformed JSON, missing/invalid `code`, and a rejecting `incrementClickCount` are each caught and logged without throwing; `start()` catches a `queue.consumeQueue` rejection without throwing.
- `src/__tests__/linksRepo.test.js` -- extend with a test asserting `incrementClickCount(code)` calls `pool.query` with the exact atomic UPDATE SQL and `[code]` binding.
- `src/__tests__/index.test.js` -- extend to assert `clickConsumer.start` is called after `bootstrapSchema` resolves, and that `app.listen` is still called (boot does not fail) when `clickConsumer.start` rejects.

**Acceptance Criteria:**
- Given a well-formed click event `{ code, timestamp }` arrives on `click-events`, when the consumer receives it, then `UPDATE links SET click_count = click_count + 1 WHERE code = $1` runs with that code, and no prior `SELECT` on `click_count` occurs (AD-6, FR7).
- Given the Express server boots via `src/index.js`, when `bootstrapSchema` resolves, then the click consumer starts in the same process without a separate service or new `docker-compose.yml` entry, and `app.listen` is still called even if the consumer's initial connect fails (AD-2).
- Given a message with malformed JSON, a missing/invalid `code`, or a DB error during increment, when the consumer processes it, then the message is dropped (no requeue/retry/DLQ), the error is logged via `pino`, and the consumer continues processing subsequent messages without crashing (FR8).
- Given the redirect path (`services/redirectService.js`, `routes/links.js`), when reviewed, then neither calls `linksRepo.incrementClickCount` directly or indirectly — only `services/clickConsumer.js` does (AD-4).

## Spec Change Log

## Review Triage Log

### 2026-09-02 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 2 (high 0, medium 1, low 1)
- defer: 1 (low 1)
- reject: 15 (high 0, medium 0, low 15)
- addressed_findings:
  - `medium` `patch` `src/repos/queue.js`'s `publishToQueue` catch block reset `connectionPromise`/`channelPromise` but not `consumeChannelPromise` on a publish-channel failure, orphaning the consume channel's promise against a discarded connection and leaking a duplicate `amqp.connect()` on the next call — added `consumeChannelPromise = null` to that catch block so all three lazy-connect promises are invalidated together.
  - `low` `patch` `ensureChannel` and `ensureConsumeChannel` duplicated the same channel-creation/listener-wiring/assertQueue shape — extracted a shared `createManagedChannel(connPromise, errorLabel, resetChannelPromise)` helper used by both, with no behavior change (verified by the unmodified passing test suite).

Rejected findings (all out of scope for this story's intent — resilience/observability polish not required by FR7/FR8/AD-2/AD-6/AD-4, deliberately excluded per the epic's MVP resilience posture, or already correct by construction): `noAck: true` losing an in-flight message on a crash (this is exactly FR8's accepted-loss contract, not a gap); no DLQ for malformed messages (same — FR8 explicitly forbids DLQ); no automatic re-subscription after a connection/channel drop and no retry/backoff on initial consumer connect (out-of-scope reconnect resilience, matching Story 2.1's precedent explicitly rejecting reconnect-storm/backoff handling as beyond MVP scope); the `.catch(() => {})` on `clickConsumer.start()` in `src/index.js` being "redundant" (intentional belt-and-suspenders, matching Story 2.1's identical precedent); no success log on consumer start, no metrics/observability, no graceful shutdown hook (observability/ops polish, not required by any AC); no `channel.prefetch` (moot under `noAck: true`, self-acknowledged by the reviewer); no length/format validation on `body.code` beyond non-empty-string (query is parameterized, no injection risk, and an invalid code simply no-ops the `UPDATE`, which is acceptable); a test for reconnection behavior (moot — no such recovery code path exists, by design, per the rejected resilience findings above); a defensive wrapper around `onMessage`'s return value in `consumeQueue` (`handleMessage` is guaranteed to never reject, mirroring `clickPublisher`'s never-rejects contract from Story 2.1); a guard against `consumeQueue` being invoked twice (unreachable — it is called exactly once, from `clickConsumer.start()` at boot); not logging when the `UPDATE` affects zero rows (not required by any AC, and matches the "eventually consistent, no-op on unknown code" posture).

## Design Notes

`repos/queue.js` grows a second lazy-connect leg (consume) alongside the existing publish leg, sharing one connection but independent channels/promises, so a publish-channel failure never disrupts an active consumer and vice versa — mirrored `error`/`close` handling on each channel, matching the resilience pattern the Story 2.1 review added for the publish channel.

`clickConsumer.js` mirrors `clickPublisher.js`'s catch-and-log contract but in the opposite direction: `clickPublisher.publishClickEvent` guarantees it never rejects outward; `clickConsumer.handleMessage` guarantees it never throws/rejects back into `queue.js`'s `channel.consume` callback, which is the mechanism that keeps a single bad message from taking down the consumer (FR8).

```js
// clickConsumer.js
async function handleMessage(content) {
  try {
    const body = JSON.parse(content.toString());
    if (!body || typeof body.code !== 'string' || !body.code) {
      throw new Error('malformed click event body');
    }
    await linksRepo.incrementClickCount(body.code);
  } catch (err) {
    logger.error({ err }, 'failed to process click event');
  }
}
```

## Verification

**Commands:**
- `npm test` -- expected: all existing and new tests pass, including `queue.test.js`'s new `consumeQueue` tests, `clickConsumer.test.js`, and the extended `linksRepo.test.js`/`index.test.js`; no live RabbitMQ/Postgres connection required (NFR3).

## Auto Run Result

**Summary:** The in-process click-event consumer is implemented. `repos/queue.js` grew a lazy-connect consumer leg (`consumeQueue`) sharing the existing connection with the publisher, using its own memoized channel and `{ noAck: true }` delivery so a failed message is never redelivered. `services/clickConsumer.js` parses each message, validates it, and calls the new `linksRepo.incrementClickCount(code)` — the single atomic `UPDATE links SET click_count = click_count + 1 WHERE code = $1` — catching and logging any parse/validation/DB error via `pino` so a bad message never crashes the consumer. `src/index.js` starts the consumer (`clickConsumer.start()`, not awaited) in the same process as Express, right after `app.listen`, once `bootstrapSchema` resolves. The redirect path (`services/redirectService.js`, `routes/links.js`) was left untouched and confirmed to never call `incrementClickCount` — only `clickConsumer.js` does (AD-4).

**Files changed:**
- `src/repos/queue.js` -- added `ensureConsumeChannel`/`consumeQueue` (lazy-connect consumer channel sharing `ensureConnection`, `{ durable: true }` assert, `{ noAck: true }` consume); refactored `ensureChannel` and the new consumer path to share a `createManagedChannel` helper (patch); `publishToQueue`'s catch now also resets `consumeChannelPromise` (patch), so all three lazy-connect promises invalidate together on a shared-connection failure.
- `src/repos/linksRepo.js` -- added `incrementClickCount(code)` running the exact atomic `UPDATE` statement required by AD-6/FR7.
- `src/services/clickConsumer.js` (new) -- `handleMessage(content)` parses/validates the message and calls `linksRepo.incrementClickCount`, catching and logging any error so it never throws; `start()` wires `handleMessage` into `queue.consumeQueue` and catches/logs a startup-connect rejection.
- `src/index.js` -- calls `clickConsumer.start()` after `app.listen`, inside the `bootstrapSchema().then(...)` block, not awaited.
- `src/__tests__/queue.test.js` -- extended with a `consumeQueue` describe block: lazy connect, durable assert, `{ noAck: true }`, message dispatch to `onMessage`, null-msg no-op, shared-connection reuse with `publishToQueue`, and connect-failure propagation.
- `src/__tests__/clickConsumer.test.js` (new) -- covers all five I/O matrix rows: well-formed message increments; malformed JSON, missing/invalid `code`, and a rejecting `incrementClickCount` are each caught/logged without throwing; `start()` swallows a `consumeQueue` rejection.
- `src/__tests__/linksRepo.test.js` -- extended with an `incrementClickCount` SQL/binding assertion.
- `src/__tests__/index.test.js` -- extended to assert `clickConsumer.start` is called after `bootstrapSchema` resolves, and that `app.listen` still fires when `clickConsumer.start` rejects.

**Review findings breakdown:** 2 patches applied (1 medium, 1 low), 1 deferred (low), 15 rejected (all out-of-scope resilience/observability polish, or already correct by design — see Review Triage Log above).

**Follow-up review recommendation:** `false`. Patched-finding score: medium 1, low 1 (3×1 + 1×1 = 4, below the 5-point threshold), and no patched finding was `high` severity.

**Verification performed:**
- `npm test` -- `Test Suites: 10 passed, 10 total`, `Tests: 53 passed, 53 total`, run three times independently across the implementation, review, and patch passes, with identical results each time.
- I/O & Edge-Case Matrix audit: all five rows (well-formed message, malformed JSON, missing/invalid `code`, DB error on increment, server-boot consumer start with `app.listen` unaffected by a start failure) are each covered by a passing test in `queue.test.js`, `clickConsumer.test.js`, or `index.test.js`.
- AD-4 boundary check: confirmed by direct read of `services/redirectService.js` and `routes/links.js` — neither imports or calls `linksRepo.incrementClickCount` or `services/clickConsumer.js`.
- Four independent review layers (blind-hunter, edge-case-hunter, verification-gap, intent-alignment) ran against the diff; the two real, in-scope findings were patched and re-verified; the intent-alignment auditor found no contradictions between the ACs and the diff's behavior, only that some guarantees (AD-2's same-process claim, AD-4's call-site invariant) are proven by structural absence/inspection rather than a dedicated runtime test — noted, not actionable within this story's scope.

**Residual risks:**
- No automatic re-subscription if the RabbitMQ connection/channel drops after the consumer has started, and no retry/backoff if the initial connect at boot fails — click processing would silently stop until the process restarts. Deliberately out of scope, matching Story 2.1's precedent that reconnect/backoff resilience is beyond this MVP's requirements (catch-and-log only).
- `ensureConsumeChannel`'s `error`/`close` channel listeners have no direct unit test triggering them (mirrors an identical pre-existing gap on the publish channel's listeners) — recorded as a deferred finding in frontmatter `deferred`.
- An `UPDATE` for an unknown/malformed `code` silently affects zero rows with no warning logged — acceptable under the eventually-consistent, accepted-loss posture of FR8/NFR2, but not observable in logs if it happens at scale.
- Story 2.3 (count query endpoint) is not yet implemented, so `click_count` now increments correctly but nothing exposes it via HTTP yet.

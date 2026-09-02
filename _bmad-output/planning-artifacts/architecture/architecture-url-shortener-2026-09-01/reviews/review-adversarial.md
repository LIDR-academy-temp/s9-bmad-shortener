---
name: 'Adversarial Review — URL Shortener MVP Architecture Spine'
type: review
target: '_bmad-output/planning-artifacts/architecture/architecture-url-shortener-2026-09-01/ARCHITECTURE-SPINE.md'
lens: adversarial
created: '2026-09-01'
---

# Adversarial Review — Architecture Spine

**Verdict:** The spine's five ADs correctly constrain *layer direction* and *ownership of the click-count write*, but leave the *shape* of shared state — the RabbitMQ payload, the queue's wire properties, the click-count column's null-safety, and the click-count query's own layering — underspecified enough that two AD-compliant builders can produce code that is individually correct and mutually incompatible.

Each finding below names a concrete pair of independently-buildable units (by story/FR, or by "two developers implementing the same module") that both satisfy every applicable AD's Rule, plus the exact gap that permits the divergence.

---

## Critical

### C1 — `click_count` increment is not specified as atomic; read-then-write loses increments under concurrency
AD-3's Rule says only "`links.click_count` is an integer column, incremented in place by the consumer." AD-4's Rule constrains *who* calls the increment method, not *how* it executes. Neither Rule requires a single atomic statement.

- **Unit A** (spec-literal, correct): `linksRepo.incrementClickCount(code)` → `UPDATE links SET click_count = click_count + 1 WHERE code = $1`. Atomic at the database level.
- **Unit B** (equally spec-literal, broken): `linksRepo.incrementClickCount(code)` → `SELECT click_count FROM links WHERE code = $1`, computes `count + 1` in JS, then `UPDATE links SET click_count = $1 WHERE code = $2`. This still "increments in place" and is still called only by the consumer — it satisfies AD-3 and AD-4 to the letter.

Under concurrent redirects for the same code (multiple in-flight click-events messages, or a consumer whose per-message handler isn't fully awaited before the next message is processed — realistic in Node even in a single "consumer instance" per the Deferred note on concurrency), Unit B's SELECT/UPDATE pair races and silently loses increments. Nothing in AD-3, AD-4, or the Deferred section ("consumer concurrency/scaling... no prefetch/concurrency tuning decided") forces atomic SQL. **Gap: AD-3's Rule constrains storage shape (column vs event log), not write atomicity.**

### C2 — `click_count` has no NOT NULL / DEFAULT specified; a legal insert path can permanently null out the counter
The ERD gives `integer click_count` with no `NOT NULL`, no `DEFAULT 0`. AD-5 only governs pool sharing; nothing governs how `click_count` is initialized at row creation.

- **Unit A**: shorten INSERT explicitly sets `click_count = 0`.
- **Unit B**: shorten INSERT omits `click_count`, assuming a migration-level default exists (the ERD doesn't show one, so whether it does depends on whoever wrote the migration).

If the migration doesn't carry a default, Unit B's rows get `click_count = NULL`. The consumer's `click_count = click_count + 1` (even done correctly per C1's fix) evaluates to `NULL + 1 = NULL` in Postgres — the counter silently stays NULL forever, and FR9/FR10's read returns `null` instead of a count, with no error anywhere in the path. **Gap: the Structural Seed's ERD doesn't pin NOT NULL/DEFAULT, and no AD assigns ownership of initializing the counter.**

### C3 — The Capability→Architecture Map contradicts AD-1's own Rule for the click-count query
AD-1's Rule states plainly: "routes never call repos/clients directly." But the Capability→Architecture Map row for FR9/FR10 reads:

> `Click count query (FR9, FR10) | routes/links.js → repos/linksRepo.js | AD-1, AD-3`

— routes calling the repo directly, with no service in between, *cited as governed by AD-1*. Every other row in that table (shorten, redirect, click publish, click consume) correctly routes through a service. This is a self-contradiction inside the spine, not just a gap:

- **Unit A** follows AD-1's Rule text and adds a thin service (or reuses `redirectService`/a new `clickQueryService`) between `routes/links.js` and `linksRepo.js` for the `/:code/clicks` endpoint.
- **Unit B** follows the Capability Map row literally — which explicitly names this exact path and tags it "governed by AD-1" — and calls `linksRepo.getClickCount(code)` straight from the route handler.

Both builders can point to the spine to justify their choice; a reviewer citing AD-1's Rule text would flag Unit B as a violation, while Unit B's author can point to the Map as the authoritative capability wiring. **Gap: the spine's own artifacts disagree with each other for this one capability.**

---

## High

### H1 — RabbitMQ message `timestamp` field has no specified format
The Consistency Conventions pin the message body to `{ code, timestamp }` but never say what `timestamp` *is*.

- **Publisher A**: `timestamp: Date.now()` (epoch-ms number).
- **Publisher B**: `timestamp: new Date().toISOString()` (ISO-8601 string).

Both satisfy "`{ code, timestamp }`" literally. Nothing downstream in AD-3 currently reads `timestamp` (click-count is column-only, no event log), so this is latent today — but it's a live schema-drift trap the moment anything (a stricter consumer, a schema validator, a future analytics consumer that the "Deferred" section explicitly anticipates reintroducing) starts asserting a shape. **Gap: the Data & formats convention names the field but not its type/format.**

### H2 — Queue declaration properties aren't pinned, risking a RabbitMQ PRECONDITION_FAILED at runtime
"Single durable queue `click-events`" fixes the name and the `durable` flag only. `channel.assertQueue` also takes `exclusive`, `autoDelete`, and `arguments` (e.g. a dead-letter-exchange or TTL), and amqplib/RabbitMQ throws a channel-level 406 PRECONDITION_FAILED if two callers assert the same queue with different properties.

- **Publisher-side queue.js** asserts `click-events` with plain `{ durable: true }`.
- **Consumer-side queue.js** (built independently against the same "single durable queue" line) asserts `click-events` with `{ durable: true, arguments: { 'x-dead-letter-exchange': '' } }`, anticipating the DLQ that the Deferred section says is out of scope but that a builder might pre-wire anyway.

Both cite the same Rule; whichever asserts second crashes its channel. **Gap: "durable queue" under-specifies the full queue declaration both sides must agree on byte-for-byte.**

### H3 — Message persistence (`deliveryMode`) is unspecified, so "durable" doesn't mean what one implementation assumes
A durable *queue* survives broker restart; a message only does if published with `persistent: true` (`deliveryMode: 2`). The spine never mentions this.

- **Publisher A**: `channel.sendToQueue(q, buf, { persistent: true })` — click events survive a RabbitMQ restart.
- **Publisher B**: omits the option (default transient) — click events are silently dropped on any broker restart, even though the queue itself (and its name/shape) is fully spine-compliant.

Both implementations satisfy every AD and the "durable queue" convention; only one actually delivers durable messages. **Gap: no Rule distinguishes queue durability from message persistence.**

### H4 — Redirect-path publish ordering/error handling is unspecified, so RabbitMQ health can silently gate redirect availability
AD-4 only forbids the redirect path from writing `click_count`; it says nothing about whether the click-event publish is awaited before responding, or how a publish failure is handled.

- **redirectService A**: `await clickPublisher.publish(code)` before sending the 302 — if the RabbitMQ channel is down (a scenario the Deferred section already accepts as unaddressed: "RabbitMQ connection resiliency... not addressed"), the redirect itself now 500s even though the cache/Postgres lookup succeeded.
- **redirectService B**: fires the publish without awaiting it (or wraps it in a swallowed try/catch), so redirect success is fully decoupled from RabbitMQ health.

Both are AD-4-compliant (neither writes the counter in the redirect path), but they give the MVP materially different availability characteristics under the exact failure mode the spine already flags as an accepted gap. **Gap: AD-4 governs *what* the redirect path may not do, not how it must handle failure of what it *is* required to do (FR6's publish).**

### H5 — Short-code collision handling is deferred, but the UK constraint forces *some* behavior on collision, and the spine gives no shape for it
`code` is `varchar UK`. The Deferred section explicitly says "no uniqueness retry/backoff decided" — but a collision is still a live, reachable code path (a Postgres 23505 unique-violation) that every implementation must do *something* with, and the Errors convention only defines 400 (shorten validation) and 404 (redirect/count lookup) — nothing for this case.

- **shortenService A**: catches 23505, regenerates, retries up to N times, then 500s with `{ "error": "..." }`.
- **shortenService B**: doesn't catch it at all; the raw pg error bubbles up through Express's default error handler, producing a different status code and a body shape that doesn't match the `{"error": "<message>"}` convention.

Both are spine-compliant (collision handling was explicitly out of scope, so neither violates a stated Rule) yet they produce incompatible client-facing contracts for the same failure. **Gap: deferring the *strategy* also deferred the *error contract*, but the Errors convention reads as if it were exhaustive.**

---

## Medium

### M1 — `repos/cache.js` and `repos/queue.js` have no interface contract, only a one-line description
The Structural Seed describes `cache.js` as "Redis client wrapper" and `queue.js` as "RabbitMQ connection, publisher + consumer channel" — no method names, return types, or miss/error semantics. AD-1 fixes *direction* of calls (services → repos) but not *shape*.

- **cache.js A**: `get(code)` returns `null` on a miss (mirrors node-redis's native return).
- **cache.js B**: `get(code)` throws a `CacheMissError` on a miss.

A `redirectService` written against A's contract (`if (!longUrl) fallthrough to Postgres`) throws unhandled against B. Since repos own no interface per AD-1's table ("no infra calls... no business logic" is the only constraint given), nothing forces the two modules built for the same repo file to agree on this. **Gap: AD-1 assigns ownership per layer, not a contract per module.**

### M2 — "Publisher + consumer channel" in `queue.js` is ambiguous between one shared channel and two
If read as one amqplib `Channel` object used for both `sendToQueue` and `consume`, a protocol-level error on the consume side (e.g., an unhandled exception surfacing as a channel error) closes the channel and silently kills publishing too, and vice versa. If read as two channels over one shared `Connection`, the failure domains are isolated. Nothing in AD-2 or AD-5 (which governs pool sharing for Postgres specifically, not RabbitMQ) resolves which reading is intended.

### M3 — AD-2 forces in-process consumer startup but gives no Rule for startup-failure handling
AD-2's Rule mandates the consumer boots in the same process as the Express server, foreclosing the process isolation a separate worker would have given for free. It says nothing about what happens if the RabbitMQ connection isn't ready at boot (a real risk with docker-compose's `depends_on` not waiting for actual broker readiness).

- **index.js A**: connects the consumer with retry/backoff before calling `app.listen`.
- **index.js B**: one-shot `await queue.connect()` that throws on the first boot race, taking down the whole process — including the redirect path that AD-4 was written to protect from exactly this kind of RabbitMQ-availability coupling.

Both satisfy AD-2's literal Rule ("boots both... same process"); only one preserves redirect availability under a startup race the Deferred section otherwise treats as an accepted, contained gap.

---

## Low

### L1 — Short-code alphabet/length is unconstrained in the ERD
`varchar code UK` carries no length bound and the spine names no generation algorithm (random vs sequence-derived). Within this single-instance MVP this doesn't cause interop breakage (only one `shortenService` instance runs), but it's an open door for a later story to pick an incompatible scheme (e.g., id-derived codes requiring a two-phase insert-then-update) without violating anything stated.

### L2 — Cache population timing on the write path is unaddressed
"Cache-aside... falls back to Postgres" only constrains the *read* miss path. Nothing says whether `shortenService` also warms Redis at creation time. Two compliant `shortenService`/`redirectService` pairs — one that warms the cache on write, one that populates lazily only — behave identically in correctness but differently in latency/behavior profile, an inconsistency a later reviewer would have no Rule to cite against either choice.

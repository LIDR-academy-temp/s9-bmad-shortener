# Epic 2 Context: Click Tracking & Count Query (async fan-out)

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Every successful redirect fires a click event asynchronously, without adding latency or failure risk to the redirect response itself. A consumer running in the same process picks up these events and increments a persistent per-code click counter, and a query endpoint exposes that counter. This epic exists to practice and prove out async decoupling: the redirect path and the click-counting path must stay fully independent, connected only by a queue.

## Stories

- Story 2.1: Publish a click event on every successful redirect
- Story 2.2: Consume click events and increment the click count
- Story 2.3: Query the click count for a short code

## Requirements & Constraints

- Every successful redirect (cache hit or miss) must publish a click event; the redirect response must be returned without waiting for the publish to be acknowledged or consumed.
- A publish failure (e.g., queue unreachable) must be caught and logged, never surfaced as a redirect failure — the redirect still responds successfully.
- A consumer, running in-process alongside the API server, processes click events and increments the counter for the corresponding code.
- A message that fails to process (malformed body, DB error, etc.) is dropped without retry or dead-lettering; the consumer must keep running, not crash.
- The click count is eventually consistent — a small, bounded lag between a redirect and the count reflecting it is acceptable and expected.
- A query endpoint returns the current click count for a single short code; there is no endpoint that aggregates counts across all codes.
- Unknown or malformed short codes on the count query return the same not-found shape used elsewhere (no distinct treatment for "malformed" vs. "unknown").
- No live external services (Postgres/Redis/RabbitMQ) may be touched as a side effect of requiring/importing a module — this keeps the existing test suite runnable without live infra.

## Technical Decisions

- **Layering (established in Epic 1, applies here too):** routes → services → repos/clients, one-way dependency. Services never touch Express `req`/`res`; repos/clients never call services; routes never call repos/clients directly.
- **In-process consumer, no new service:** the RabbitMQ consumer starts in the same process as the Express server (`src/index.js` boots both). No new `docker-compose.yml` entry — the existing `api` container hosts both.
- **Single counter column, not an event log:** `links.click_count` is an integer column incremented in place. No click-event history table is persisted.
- **Consumer-only mutation:** only the consumer module may call the repo method that increments `click_count`. The redirect service/route must never call it, synchronously or otherwise — this boundary is what keeps the redirect path non-blocking.
- **Atomic increment:** the increment is a single SQL statement, `UPDATE links SET click_count = click_count + 1 WHERE code = $1`. Never read-then-write.
- **Lazy-connect infra clients:** the RabbitMQ connection/channel (like the existing Postgres pool and Redis client) is constructed but not opened at module load — it connects only on server boot or on first real use. Follow the existing pattern already established in `src/repos/db.js` and `src/repos/cache.js`.
- **Naming/data conventions:** short code is the public identifier everywhere; the internal Postgres `id` is never returned. RabbitMQ: durable queue `click-events` (asserted `{ durable: true }`), messages published `{ persistent: true }`, body `{ code: string, timestamp: <ISO 8601 string> }`.
- **Response/error shapes:** count query → `200 { "code": "<code>", "clicks": <n> }`; `404 { "error": "short code not found" }` for both unknown and malformed codes.
- **Config:** only existing `.env` vars (`DATABASE_URL`, `REDIS_URL`, `RABBITMQ_URL`, `BASE_URL`, `PORT`) — no new vars for this epic.
- **Logging:** `pino` only, no other logging library.
- **Suggested module layout** (per the architecture's structural seed — not yet present in the codebase, to be added by this epic): `services/clickPublisher.js` (publish after successful redirect), `services/clickConsumer.js` (consume + increment), `services/statsService.js` (thin pass-through for the count query), `repos/queue.js` (RabbitMQ connection, publisher + consumer channel, lazy-connect). Existing repo/service files (`repos/db.js`, `repos/cache.js`, `repos/linksRepo.js`, `services/redirectService.js`, `services/shortenService.js`, `routes/links.js`) already follow this same naming convention — extend it rather than introducing new patterns.
- **RabbitMQ image:** `docker-compose.yml`'s RabbitMQ service should use `4-management` (3-management's community support ended 2025-07-31).

## Cross-Story Dependencies

- Story 2.1 (publish) and Story 2.2 (consume) are connected only through the `click-events` queue — no direct code dependency, by design (this is the async decoupling the epic is built to demonstrate).
- Story 2.2's increment depends on the `links` table and its `click_count` column already existing (bootstrapped in Epic 1 via `src/repos/db.js`).
- Story 2.3 (count query) reads the same `click_count` column that Story 2.2 writes; it can be built and tested independently of 2.1/2.2 by seeding the column directly, but its real-world accuracy depends on 2.2 being wired up.
- Story 2.1 hooks into the existing redirect path from Epic 1 (`services/redirectService.js` / `routes/links.js`) — it adds a publish call after a successful redirect, without modifying that path's existing cache-aside behavior or response contract.

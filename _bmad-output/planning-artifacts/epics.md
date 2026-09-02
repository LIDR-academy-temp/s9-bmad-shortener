---
stepsCompleted: [step-01-validate-prerequisites-complete, step-02-design-epics-complete, step-03-create-stories-complete]
inputDocuments: ['_bmad-output/planning-artifacts/prds/prd-url-shortener-2026-09-01/prd.md', '_bmad-output/planning-artifacts/prds/prd-url-shortener-2026-09-01/addendum.md', '_bmad-output/planning-artifacts/architecture/architecture-url-shortener-2026-09-01/ARCHITECTURE-SPINE.md']
---

# url-shortener - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for url-shortener, decomposing the requirements from the PRD and Architecture requirements into implementable stories. There is no UX design contract for this project — it is an API-only MVP with no UI/frontend (explicitly out of scope per the PRD).

## Requirements Inventory

### Functional Requirements

FR1: The system accepts a long URL via an HTTP endpoint and returns a short code / short URL. No custom alias input is accepted.
FR2: The system generates the short code itself (auto-generated); code collisions are explicitly not handled in this MVP.
FR3: The system resolves a short code to its original URL and issues an HTTP redirect to the client.
FR4: On resolving a short code, the system checks Redis first (cache hit → serve from cache). On a cache miss, it falls back to the persistent store and populates Redis with the result before responding.
FR5: An unknown short code returns a not-found response rather than a redirect.
FR6: On every successful redirect, the system publishes a click event to RabbitMQ. The redirect response is returned without waiting for this event to be consumed or the count to be updated.
FR7: A consumer process reads click events from RabbitMQ and increments the click count for the corresponding short code.
FR8: A message that fails to process is an accepted loss for this MVP — no retry, no dead-letter queue.
FR9: The system exposes an endpoint that returns the current click count for a given short code.
FR10: The click count is per short code; there is no endpoint aggregating counts across all short codes.

### NonFunctional Requirements

NFR1 — Redirect latency isolation: Click-count processing must not add latency to the redirect response; it happens fully out of band via the queue.
NFR2 — Eventual consistency: The click count is eventually consistent with actual redirects, not strongly consistent — a small, bounded lag between a redirect and the count reflecting it is acceptable.
NFR3 — Test isolation: The automated test suite runs without any live external services (matching the existing Jest/Supertest suite convention in this repo), while the full stack is separately verifiable via `docker compose up` (api, postgres, redis, rabbitmq, nginx).
NFR4 — No auth, no rate limiting: Explicitly out of scope; endpoints are unauthenticated and unthrottled for this MVP.

### Additional Requirements

- **Layered architecture** (AD-1): routes → services → repos/clients, one-way dependency. Services never import Express `req`/`res`; repos/clients never call services; routes never call repos/clients directly.
- **In-process click consumer** (AD-2): the RabbitMQ consumer starts in the same process as the Express server (`src/index.js` boots both). No new `docker-compose.yml` service.
- **Click count is a single counter column** (AD-3): `links.click_count` is an integer column incremented in place by the consumer — no click-event history/table.
- **Redirect never writes the click count, never blocks on publish** (AD-4): only the consumer may call the increment repo method. A publish failure is caught and logged; the redirect still responds successfully.
- **Single shared Postgres pool** (AD-5): one `pg.Pool` instance, created once in `src/repos/db.js` and imported by every repo.
- **Atomic click-count increment** (AD-6): single SQL statement `UPDATE links SET click_count = click_count + 1 WHERE code = $1` — no read-then-write.
- **Schema bootstrap, no migration framework** (AD-7): repo layer runs `CREATE TABLE IF NOT EXISTS links (...)` once at boot in `src/repos/db.js`.
- **Infra clients lazy-connect** (AD-8): `pg.Pool`, Redis client, and amqplib connection are constructed but not connected at module load — connection happens only on server boot or lazily on first use (supports NFR3 test isolation).
- **Naming/data conventions**: short code is the public identifier everywhere; Postgres `id` stays internal. Redis key: `shorturl:{code}` → long URL. RabbitMQ: durable queue `click-events`, messages published `{ persistent: true }`, body `{ code: string, timestamp: <ISO 8601 string> }`. Redirect status: HTTP 302.
- **Response/error shapes**: shorten → `201 { "shortUrl": "<url>", "code": "<code>" }`, `400 { "error": "url must be a valid http(s) URL" }`; redirect → `302` with `Location` header, `404 { "error": "short code not found" }`; count → `200 { "code": "<code>", "clicks": <n> }`, `404` on unknown code. Malformed `code` param (regex mismatch) also returns 404, not 400.
- **Config via existing `.env` vars only**: `DATABASE_URL`, `REDIS_URL`, `RABBITMQ_URL`, `BASE_URL`, `PORT` — no new vars introduced.
- **Logging**: via `pino` only, no other logging library.
- **RabbitMQ image bump**: `docker-compose.yml` RabbitMQ service image needs updating to `4-management` (from `3-management`, whose community support ended 2025-07-31).
- **Route surface**: `POST /shorten`, `GET /:code` (redirect), `GET /:code/clicks` — the latter two sit at root (not nested under `/shorten`) so the redirect stays a bare, shareable link.
- **Stack pinning**: Node.js 20 (`node:20-alpine`), Express ^5.2.1, pg ^8.23.0, redis (node-redis) ^6.2.1, amqplib ^2.0.1, pino ^10.3.1, Jest ^30.5.1, Supertest ^7.2.2, Postgres 16, Redis 7.

### UX Design Requirements

Not applicable — no UX design contract exists for this project. It is an API-only MVP with no UI/frontend (explicitly listed under PRD Out of Scope).

### FR Coverage Map

FR1: Epic 1 - Shorten endpoint accepts URL, generates code
FR2: Epic 1 - Auto-generated code, no collision handling
FR3: Epic 1 - Resolve code, issue redirect
FR4: Epic 1 - Cache-aside: Redis first, Postgres fallback + repopulate
FR5: Epic 1 - Unknown code → not-found response
FR6: Epic 2 - Publish click event async, non-blocking
FR7: Epic 2 - Consumer increments click count
FR8: Epic 2 - Failed message = accepted loss, no retry/DLQ
FR9: Epic 2 - Click count query endpoint
FR10: Epic 2 - Count is per-code only, no global aggregation

## Epic List

### Epic 1: Shorten & Redirect (cache-aside)
A user can shorten a URL and be redirected correctly through the short code, with reads served from Redis when possible and automatic fallback/repopulation from Postgres on a miss.
**FRs covered:** FR1, FR2, FR3, FR4, FR5

### Epic 2: Click Tracking & Count Query (async fan-out)
Every successful redirect fires a click event asynchronously (without blocking the response), a consumer processes it and increments the count, and an endpoint exposes the current count per short code.
**FRs covered:** FR6, FR7, FR8, FR9, FR10

<!-- Repeat for each epic in epics_list (N = 1, 2, 3...) -->

## Epic 1: Shorten & Redirect (cache-aside)

A user can shorten a URL and be redirected correctly through the short code, with reads served from Redis when possible and automatic fallback/repopulation from Postgres on a miss.

### Story 1.1: Shorten a URL

As a link creator,
I want to submit a long URL and receive a short code,
So that I can share a compact link.

**Acceptance Criteria:**

**Given** a valid http(s) URL in the request body
**When** `POST /shorten` is called
**Then** the response is `201` with `{ "shortUrl": "<BASE_URL><code>", "code": "<code>" }`
**And** the mapping is persisted in the `links` table (Postgres) with `click_count` defaulting to `0`

**Given** the server has not yet bootstrapped its schema
**When** the process boots and `src/repos/db.js` initializes the shared pool
**Then** it runs `CREATE TABLE IF NOT EXISTS links (...)` once (AD-7), so the table always exists before any query runs

**Given** a missing, malformed, or non-http(s) `url` field
**When** `POST /shorten` is called
**Then** the response is `400` `{ "error": "url must be a valid http(s) URL" }`

**Given** no `code`/`alias` field is accepted in the request
**When** `POST /shorten` is called
**Then** the system always auto-generates the short code itself (base62, ~7 chars) — no custom alias path exists (FR1, FR2)

**And** the Postgres pool is constructed but not connected at module-import time — connection happens only on server boot or first real use (AD-8, NFR3)

### Story 1.2: Redirect through a short code with cache-aside lookup

As a link visitor,
I want to be redirected to the original URL when I visit a short link,
So that I reach the destination quickly, whether or not it was already cached.

**Acceptance Criteria:**

**Given** a short code already cached in Redis (`shorturl:{code}`)
**When** `GET /:code` is called
**Then** the response is `302` with `Location: <long_url>`, served from Redis without querying Postgres

**Given** a short code not in Redis but present in Postgres
**When** `GET /:code` is called
**Then** the response is `302` with `Location: <long_url>` served from Postgres, **and** Redis is populated with `shorturl:{code}` → `long_url` before responding, so the next lookup is a cache hit

**Given** an unknown or malformed short code (regex mismatch)
**When** `GET /:code` is called
**Then** the response is `404` `{ "error": "short code not found" }` — no redirect occurs (FR5)

**And** a cached entry never diverges from the persistent store's mapping for the same code (PRD success metric)
**And** the Redis client is constructed but not connected at import time — lazy-connect only (AD-8, NFR3)

## Epic 2: Click Tracking & Count Query (async fan-out)

Every successful redirect fires a click event asynchronously (without blocking the response), a consumer processes it and increments the count, and an endpoint exposes the current count per short code.

### Story 2.1: Publish a click event on every successful redirect

As a link creator,
I want each redirect to trigger a tracked click event without slowing down the visitor's redirect,
So that click counts eventually reflect real usage with zero added latency.

**Acceptance Criteria:**

**Given** a redirect completes successfully (cache hit or miss)
**When** the response is about to be sent
**Then** a click event `{ code: string, timestamp: <ISO 8601> }` is published to the durable queue `click-events` (`{ durable: true }`, message `{ persistent: true }`)
**And** the redirect response is returned without waiting for the publish to be acknowledged or consumed (FR6, NFR1)

**Given** RabbitMQ is unreachable or the publish fails
**When** a redirect occurs
**Then** the failure is caught and logged, and the redirect still responds `302` successfully — a queue outage never turns a redirect into a `500` (AD-4)

**And** only the redirect service path publishes click events — no other code path calls the publisher
**And** the RabbitMQ connection/channel is constructed but not opened at import time — lazy-connect only (AD-8, NFR3)

### Story 2.2: Consume click events and increment the click count

As a link creator,
I want click events to be processed asynchronously and reflected in a persistent counter,
So that I can eventually see accurate usage numbers for my link.

**Acceptance Criteria:**

**Given** a click event message arrives on `click-events`
**When** the in-process consumer receives it
**Then** it runs the single atomic statement `UPDATE links SET click_count = click_count + 1 WHERE code = $1` for that code — no read-then-write (AD-6, FR7)

**Given** the Express server boots (`src/index.js`)
**When** the process starts
**Then** the click consumer starts in the same process — no separate worker service or `docker-compose.yml` entry (AD-2)

**Given** a message fails to process (e.g. malformed body, DB error)
**When** the consumer attempts to handle it
**Then** the message is dropped without retry or dead-lettering, and the consumer keeps running — an accepted loss, not a crash (FR8)

**And** only the consumer module ever calls the increment repo method — the redirect path never calls it directly (AD-4)

### Story 2.3: Query the click count for a short code

As a link creator,
I want to query the current click count for my short code,
So that I can see how many times it's been visited.

**Acceptance Criteria:**

**Given** an existing short code
**When** `GET /:code/clicks` is called
**Then** the response is `200` `{ "code": "<code>", "clicks": <n> }` reflecting the current `click_count` (eventually consistent with recent redirects per NFR2)

**Given** an unknown or malformed short code
**When** `GET /:code/clicks` is called
**Then** the response is `404` `{ "error": "short code not found" }`

**And** no endpoint aggregates counts across all short codes — only this per-code query exists (FR10)

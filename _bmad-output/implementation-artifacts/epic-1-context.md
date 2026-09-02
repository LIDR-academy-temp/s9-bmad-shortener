# Epic 1 Context: Shorten & Redirect (cache-aside)

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Let a user shorten a URL and be redirected correctly through the resulting short code, with reads served from Redis when possible and automatic fallback/repopulation from Postgres on a cache miss. This epic proves out the cache-aside read pattern (Redis first, Postgres fallback, cache repopulation) that is central to the project's purpose, and establishes the shorten/redirect foundation that click tracking (Epic 2) builds on.

## Stories

- Story 1.1: Shorten a URL
- Story 1.2: Redirect through a short code with cache-aside lookup

## Requirements & Constraints

- A long URL submitted via HTTP returns an auto-generated short code / short URL; no custom alias or code input is ever accepted, and code collisions are explicitly not handled.
- Resolving a short code issues an HTTP redirect (302) to the original URL.
- Redirect lookups check Redis first; on a hit, serve from cache without querying Postgres. On a miss, fall back to Postgres, populate Redis before responding, so the next lookup is a cache hit.
- A cached entry must never diverge from the persistent store's mapping for the same code (this is a success metric, not just a nice-to-have).
- An unknown or malformed short code (regex mismatch) returns `404` — never a redirect, and never a `500`.
- Short code format: base62 (`[A-Za-z0-9]`), ~7 characters.
- No auth, no rate limiting (out of scope for this MVP).
- The automated test suite must run without any live external services; the full stack is separately verifiable via `docker compose up`.

## Technical Decisions

- **Layered architecture, one-way dependency**: routes → services → repos/clients. Services never touch Express `req`/`res`; repos/clients never call services; routes never call repos/clients directly.
- **Single shared Postgres pool**: one `pg.Pool`, created once in `src/repos/db.js`, imported by every repo — no repo creates its own pool/client.
- **Schema bootstrap, no migrations**: `src/repos/db.js` runs `CREATE TABLE IF NOT EXISTS links (...)` once at boot.
- **Infra clients lazy-connect**: `pg.Pool` and the Redis client are constructed but not connected at module-import time — connection happens on server boot or on first real use, never as an import side effect (this is what keeps the test suite able to run with no live services).
- **Data model** — `links` table: `id` (serial PK, internal only, never returned by any endpoint), `code` (varchar, unique), `long_url` (text), `click_count` (integer, `NOT NULL DEFAULT 0`), `created_at` (timestamp).
- **Redis key convention**: `shorturl:{code}` → long URL. No TTL/expiry.
- **Naming**: the short code is the public identifier everywhere (routes, responses, logs).
- **Suggested module layout**: `routes/links.js` (`POST /shorten`, `GET /:code`, `GET /:code/clicks`) → `services/shortenService.js` (generates code, persists mapping) and `services/redirectService.js` (cache-aside resolve) → `repos/db.js`, `repos/linksRepo.js`, `repos/cache.js`.
- **Response/error shapes**:
  - `POST /shorten` → `201 { "shortUrl": "<BASE_URL><code>", "code": "<code>" }`; `400 { "error": "url must be a valid http(s) URL" }` on missing/invalid/non-http(s) `url`.
  - `GET /:code` → `302` with `Location: <long_url>`, empty body; `404 { "error": "short code not found" }` on unknown or malformed code.
  - `shortUrl` is composed from the `BASE_URL` env var + code — never hardcoded.
- **Route placement**: `GET /:code` sits at root (not nested under `/shorten`) so the redirect stays a bare, shareable link.
- **Config**: via existing `.env` vars only (`DATABASE_URL`, `REDIS_URL`, `BASE_URL`, `PORT`) — no new vars.
- **Logging**: via `pino` only.
- **Stack pins relevant to this epic**: Node.js 20 (`node:20-alpine`), Express ^5.2.1, pg ^8.23.0, redis (node-redis) ^6.2.1, pino ^10.3.1, Jest ^30.5.1, Supertest ^7.2.2, Postgres 16, Redis 7.
- Short-code collision handling is explicitly deferred/out of scope — no uniqueness retry or backoff is expected.

## Cross-Story Dependencies

- Story 1.2 (redirect + cache-aside) depends on Story 1.1 having created the `links` table and the shorten path existing, since redirect reads from the same table/schema that shorten writes to.
- Epic 2 (click tracking) depends on Story 1.2's redirect path: click events are published from the same redirect flow built here, and the `click_count` column this epic's schema bootstrap creates is what Epic 2's consumer increments.

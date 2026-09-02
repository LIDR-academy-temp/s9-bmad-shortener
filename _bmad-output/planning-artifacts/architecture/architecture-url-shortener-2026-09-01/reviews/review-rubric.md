---
review: reviewer-gate-rubric
target: ../ARCHITECTURE-SPINE.md
date: 2026-09-01
---

# Reviewer-Gate Rubric Review — ARCHITECTURE-SPINE.md

**Verdict:** The spine's five ADs are each enforceable, correctly scoped to the layered paradigm, and genuinely prevent the divergence they name — but the spine leaves one operational dimension completely silent (how the `links` table actually gets created), lets test isolation (NFR3) rest on an unstated assumption about repo connection timing, and stays quiet on three specific things the addendum explicitly flagged as "confirm or override before architecture" (redirect status code, success response envelopes, short-code format).

This review evaluates the rubric dimensions not already covered by `reviews/review-versions.md` (stack currency — see that file for full detail on the RabbitMQ 3.x EOL and other image/version findings, folded in below at High #4 by reference).

---

## Critical

### C1 — No schema/migration strategy decided; the ERD is aspirational, not actionable

The spine's Structural Seed defines a `links` table (erDiagram: `id`, `code`, `long_url`, `click_count`, `created_at`) and AD-5 assumes a Postgres pool talking to it — but nothing in the spine says **how that table comes into existence**. Checked the brownfield reality to confirm this isn't just undocumented:

- `docker-compose.yml`'s `postgres` service mounts only a `pgdata` volume — no `docker-entrypoint-initdb.d` init script.
- No migration tool (`node-pg-migrate`, `knex`, raw SQL runner, etc.) appears in the Stack table or `package.json`.
- No `*.sql` or `*migrat*` file exists anywhere in the repo.

This is not a "flag it and move on" gap — it's a hard blocker. The PRD's own success metric is "Shorten → redirect → count round-trip works correctly end to end under `docker compose up`," and that cannot happen without a `links` table existing first. Left silent, this is exactly the kind of divergence point a spine exists to close: one story might add an init SQL script mounted into the postgres container, another might have the app run `CREATE TABLE IF NOT EXISTS` on boot, another might expect the human to run `psql` manually — three incompatible, uncoordinated answers to the same question, all plausible under the current text. At minimum this needed a Rule ("schema is created via docker-entrypoint-initdb.d/init.sql, mounted read-only into the postgres service") or an explicit Deferred entry acknowledging the gap and who owns it. It has neither.

**Why Critical, not High:** every other finding below degrades quality, testability, or robustness; this one prevents the MVP's stated success criterion from being achievable at all until *someone* makes this call — and as written, the spine gives the level below no basis for making it consistently.

---

## High

### H1 — NFR3 (test isolation) is bound but structurally unguarded

The spine's frontmatter lists `NFR3` in `binds`, and NFR3 requires the automated suite to "run without any live external services." Nothing in the AD/Rules/Conventions sections addresses *how* that's achieved once `routes/links.js` gets wired into `app.js` per the Structural Seed.

Concretely: `redis` (node-redis v6, the pinned client) requires an explicit `.connect()` call — it does not lazily connect per-command the way v3 did. If `repos/cache.js` calls `.connect()` at module scope (a very natural, common pattern), then simply `require('../app')` — exactly what the existing `src/__tests__/health.test.js` does with Supertest, and what any new route-level test will do — will transitively load `routes/links.js` → `services/*` → `repos/cache.js` and attempt a real network connection to Redis during a test run that's supposed to need zero live services. The same risk applies to `repos/queue.js` (amqplib) if it connects eagerly.

The spine never states a Rule like "repos expose connection functions, never connect at module load" or "route/service tests mock the repos layer via `jest.mock`." Given the existing test convention already imports `app.js` directly (not `index.js`), the *split* between the two files is doing real protective work for NFR3 (AD-2 keeps the AMQP consumer's connection in `index.js`, out of the test's import path) — but nothing says this is deliberate, and it doesn't protect `cache.js`/`linksRepo.js`/`queue.js`'s own connection timing once routes actually touch them. This is a likely-to-be-hit landmine, not a hypothetical one, for a requirement the spine explicitly claims to cover.

### H2 — Redirect status code (301 vs 302) never decided or deferred

`addendum.md` flags this explicitly: `[ASSUMPTION] HTTP 302 (Found) rather than 301... A production version aiming for SEO/permanence might prefer 301; flag if that matters here` — and asks that all such assumptions be "confirmed or overridden before architecture/build." The spine's Consistency Conventions table fixes the error envelope and status codes for failure paths (400, 404) but never mentions the success-path redirect status at all, and it's absent from Deferred too. It simply isn't addressed.

Actual divergence risk is lower than it looks — Express's `res.redirect()` defaults to 302, which happens to match the addendum's assumption, and this logic lives in exactly one file (`redirectService.js`), so there's little room for two units to disagree internally. But the spine's job includes explicitly ratifying or deferring addendum items flagged this way, and this one fell through without either.

### H3 — Success response envelopes never fixed, despite the error envelope being fixed

`addendum.md` flags both: `[ASSUMPTION] Shorten endpoint:... exact contract left to implementation` and `[ASSUMPTION] Count endpoint:... exact contract left to implementation`. The spine's Consistency Conventions row for "Data & formats (ids, dates, error shapes, envelopes)" fixes the Redis key format, the RabbitMQ message body, and the error JSON shape — but says nothing about what the shorten endpoint returns (`shortUrl`? `code`? both?) or what the count endpoint returns (`clicks`? `count`? `click_count`?).

Unlike H2, this isn't confined to one file's internal logic — it's a contract two different capability areas (Shorten, Click count query) and any end-to-end test spanning "shorten → extract code/URL → hit redirect and count" must agree on independently. The PRD's success metrics explicitly call for that round-trip to work; without a fixed envelope, the story that builds the round-trip test has to guess at (or reverse-engineer) a shape the shorten story never committed to. This is exactly a "level below diverges" risk the spine should have closed given the error envelope was already treated as spine-owned.

### H4 — `rabbitmq:3-management` restated as a committed choice without flagging its EOL status

Per `reviews/review-versions.md` (already on file, produced during spine authoring): RabbitMQ 3.x reached community EOL 2025-07-31; `3-management` gets no further free security patches. This is very likely a carried-forward brownfield fact rather than a new spine decision (the pin already existed in `docker-compose.yml`), which is why it isn't a contradiction of brownfield reality — but the spine's Stack table restates it as ratified, current tech without any flag, and the "named tech is verified-current" bar applies to the spine's own Stack table regardless of origin. At minimum this needs to be an acknowledged, accepted trade-off ("carried forward from existing brownfield pin; EOL known, acceptable at hobby scope") rather than silent carry-forward presented as a clean choice. See that review file for the accompanying medium-severity notes on Redis 7's license shift and Postgres 16-vs-18 currency, which don't rise to a finding here but are worth the user's awareness.

---

## Medium

### M1 — Short-code format (charset, length) left fully unstated

`addendum.md`'s assumption — base62, ~7 characters — is never surfaced anywhere in the spine, not even as a convention row or a Deferred bullet. The PRD's own Open Questions section explicitly demotes "exact short-code format/length" to an implementation-level decision (not a hard product requirement), which makes this more defensible than H2/H3 — the PRD itself says the spine doesn't have to rule on it. But the spine's ERD leaves `varchar code UK` with no length, and nothing states whether that's a deliberate "format is unconstrained by design" choice or simply unaddressed. A one-line convention ("code: base62, fixed length, generated in `shortenService.js`; column left unconstrained since format isn't a spine concern per PRD") would have closed this cleanly; as written it reads as an oversight rather than a decision.

### M2 — AD-2 couples HTTP server availability to RabbitMQ readiness at boot, with no startup-retry decided

AD-2 mandates the consumer starts in the same process as the Express server, at boot (`index.js` boots both). The Deferred section addresses reconnect-on-drop ("RabbitMQ connection resiliency... not addressed; acceptable gap at this hobby scope") but that's a different failure mode from the initial connect-at-boot race: `docker-compose.yml`'s `depends_on: [postgres, redis, rabbitmq]` has no `condition: service_healthy` gate, so on a cold `docker compose up`, `api` can start before RabbitMQ is actually accepting connections. If `amqplib.connect()` at boot isn't retried, this doesn't just degrade click-counting — it can crash the whole process AD-2 deliberately coupled to the HTTP server, taking the redirect/shorten paths down too. This directly risks the PRD's primary success metric and is a natural side effect of AD-2's own design choice, so it deserved at least an explicit Deferred/open-question line distinguishing "reconnect on drop: deferred" from "connect-at-boot ordering: deferred/unaddressed."

---

## Low

### L1 — NFR2 (eventual consistency) bound in frontmatter but never cited by name in the body

`binds:` lists NFR2, but no AD, Rule, Convention, or Deferred entry mentions it explicitly. It's substantively satisfied by the combination of AD-2 (async consumer) + AD-3 (single counter) + AD-4 (redirect never writes count) — the design as a whole delivers eventual consistency by construction — so this is a traceability nit, not a substantive gap.

### L2 — `pino` is a net-new dependency, not yet installed

Not a defect — architecture is allowed to introduce new stack choices — just noting `pino` appears in the Stack table and the logging convention but isn't yet in `package.json`/`node_modules`. Purely an FYI for whoever picks up the first story touching logging.

---

## Checklist coverage notes (items that passed cleanly)

- **AD Rule enforceability:** all five ADs (AD-1 through AD-5) have clear, checkable Rules that map directly to their stated "Prevents" — no vague or unenforceable language found.
- **Deferred section:** every entry (collision handling, retry/DLQ, auth/rate-limiting/expiration, Redis TTL, RabbitMQ reconnect-on-drop, consumer concurrency) resolves to one consistent "don't do this" default across the codebase — none of them create a plausible two-units-diverge scenario.
- **Brownfield ratification:** Stack table versions cross-checked against `package.json` (Express ^5.2.1, pg ^8.23.0, redis ^6.2.1, amqplib ^2.0.1, Jest ^30.5.1, Supertest ^7.2.2) — all match exactly. `.env` vars cross-checked against the Consistency Conventions claim (`DATABASE_URL`, `REDIS_URL`, `RABBITMQ_URL`, `BASE_URL`, `PORT`) — all present and matching. `docker-compose.yml`/`Dockerfile`/`nginx.conf` topology matches the Structural Seed diagram exactly. No contradiction found anywhere between the spine and the existing scaffold.
- **Parent spine inheritance:** no parent/product-level spine exists in this repo (`companions: []`, and no other architecture artifact found under `_bmad-output/`) — this checklist item is not applicable.
- **npm package currency:** independently re-verified via `npm view` for pino, express, pg, redis, amqplib, jest, supertest, nodemon — all pinned versions match the current published version on the registry.

# Addendum: URL Shortener MVP

Technical-how notes and implementation-leaning assumptions that don't belong in the PRD's capability-level narrative. All flagged `[ASSUMPTION]` — confirm or override before architecture/build.

## Short Code

- `[ASSUMPTION]` Format: random base62 string (`[A-Za-z0-9]`), ~7 characters — plenty of keyspace for MVP scale, no collision handling per FR2/PRD Out of Scope.

## Redirect

- `[ASSUMPTION]` HTTP 302 (Found) rather than 301 (Moved Permanently) — keeps redirects from being aggressively cached by browsers/CDNs while this is still an MVP under active change. A production version aiming for SEO/permanence might prefer 301; flag if that matters here.
- `[ASSUMPTION]` Unknown short code → 404, no redirect (FR5).

## Cache-Aside (Redis)

- `[ASSUMPTION]` Key: short code → long URL. No explicit TTL specified in the brief; default to no expiry (or a generous TTL) since there's no update/delete path that would make cached entries go stale.

## Async Click Counting (RabbitMQ)

- `[ASSUMPTION]` Single queue (e.g. `click-events`), one consumer incrementing a counter keyed by short code in the system of record (Postgres, per existing `pg` dependency and docker-compose service).
- No retry/DLQ per PRD Out of Scope (FR8) — a message lost on consumer failure is an accepted gap, not a bug to fix in this MVP.

## Response Shapes

- `[ASSUMPTION]` Shorten endpoint: JSON body in, JSON body out (`{ "shortUrl": "..." }` or similar) — exact contract left to implementation.
- `[ASSUMPTION]` Count endpoint: JSON `{ "code": "...", "clicks": N }` or similar.

## Storage

- `[ASSUMPTION]` Postgres is the system of record for the short-code → URL mapping and the click count, consistent with the `pg` dependency and `postgres` service already in `docker-compose.yml`.

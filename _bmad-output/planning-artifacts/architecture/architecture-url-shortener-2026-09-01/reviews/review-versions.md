---
review: stack-version-verification
target: ../ARCHITECTURE-SPINE.md
section: Stack
date: 2026-09-01
---

# Version/Reality-Check Review — Stack Table

**Verdict:** The npm-package pins all check out against the live registry (nothing abandoned or version-mismatched), but the spine carries one clearly out-of-date infrastructure pin (RabbitMQ 3.x, community-EOL since mid-2025) and one inaccurate compatibility claim on its single genuinely new choice (pino's stated Node floor), plus two undocumented licensing/currency gaps (Redis image license, Postgres image not on latest major) that show no evidence of having been checked.

## Critical

None.

## High

1. **`RabbitMQ (image) | 3-management`** — RabbitMQ 3.x reached end of community support on 2025-07-31; a `3-management` broker receives no further free security patches (commercial license required from Broadcom/VMware for continued fixes). Current stable major is 4.3.5, available as `rabbitmq:4-management`. Neither the spine nor `.memlog.md` shows this was checked — the memlog entry just says the image was "ratified from existing docker-compose.yml," i.e. carried forward, not verified against current RabbitMQ support status. Given `docker-compose.yml` already pins `rabbitmq:3-management`, this may be an existing brownfield fact rather than a new spine decision, but the spine restates it in the Stack table as a committed choice without flagging the EOL — that gap should at minimum be called out for the user to accept or fix.

## Medium

2. **`pino | ^10.3.1`** — this is the one genuinely new pick, and `.memlog.md` records it as "web-verified current, Node >=18, fits node:20-alpine base." That "Node >=18" claim is wrong: pino v10.0.0's own release notes state "the only breaking change is dropping support for Node 18," meaning Node 18 is no longer supported and the real floor is effectively Node 20 (pino's package.json carries no hard `engines` gate, but the sibling `thread-stream` dependency pins `"node": ">=20"`). Node 20 (the project's pinned runtime) still satisfies this, so there is no actual incompatibility — but the recorded verification is factually inaccurate, which undercuts confidence that this was genuinely reality-checked rather than half-remembered. Version number itself (10.3.1) is confirmed current on npm.

3. **`Redis (image) | 7`** — since Redis 7.4, the official Docker image switched from 3-Clause BSD to a dual RSALv2/SSPLv1 license (not OSI-approved open source); Redis 8 is now GA (as of 2026) under a choice of RSALv2, SSPLv1, or AGPLv3. The floating `redis:7` tag will resolve to whatever the newest 7.x patch is, almost certainly a post-7.4 build under the restrictive license. Neither the Stack table nor the memlog notes this licensing shift or gives a rationale for staying on the `7` line versus `8`. Likely a non-issue for a hobby MVP, but it's an unresearched/unflagged consideration, not a confirmed one.

4. **`Postgres (image) | 16`** — not the current major: PostgreSQL 18 is the current stable release (18.6, Aug 2026) with 19 imminent. PG16 remains supported until Nov 2028, so this isn't urgent, but no rationale is recorded for pinning 16 over a newer major — nothing in the spine or memlog indicates a currency check was done, only that it was carried forward from the existing `docker-compose.yml`.

## Low

5. **`amqplib | ^2.0.1` vs. the RabbitMQ image pin** — amqplib 2.0.0's changelog notes it now defaults `frame_max` to 131072 "for RabbitMQ 4.1.0 compatibility," meaning the client library's own maintainers are already tuning defaults around a 4.x broker while the spine pins a 3.x broker image (see High #1). Worth reconciling as one decision rather than two independent ones; amqplib itself remains fine on Node 20 (requires >=18).

6. **`Supertest | ^7.2.2` paired with `Express | ^5.2.1`** — no explicit statement of Supertest-7-with-Express-5 compatibility was found; circumstantial evidence (Express's own test suite reportedly uses Supertest) is reassuring but not a direct confirmation, and the spine records no independent check of this specific pairing.

7. **Node 20 cross-compatibility (confirmatory, not a defect)** — checked pino ^10.3.1 (needs Node 20 per finding #2), amqplib ^2.0.1 (needs >=18), Express ^5.2.1, pg ^8.23.0, redis ^6.2.1, Jest ^30.5.1 against Node 20: all compatible. No incompatibilities found among the pinned npm packages themselves.

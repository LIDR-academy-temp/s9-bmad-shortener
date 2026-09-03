# url-shortener

URL shortener API built with Node 20, Express 5, and CommonJS. Requests are cached in Redis, click events flow through RabbitMQ, and short codes/click counts persist in Postgres.

## API

| Method | Path            | Description                                  |
|--------|-----------------|-----------------------------------------------|
| POST   | `/shorten`      | Shorten a long URL, returns `{ shortUrl, code }` |
| GET    | `/:code`        | Redirect (302) to the original URL, or 404    |
| GET    | `/:code/clicks` | Return `{ code, clicks }` for a short code    |
| GET    | `/health`       | Liveness check                                |

## Running the app

The app needs Postgres, Redis, and RabbitMQ. Run everything via Docker Compose:

```bash
docker compose up --build
```

This starts `postgres`, `redis`, `rabbitmq`, the `api` service, and an `nginx` reverse proxy (port 80). `.env` points at the compose service hostnames (`postgres`, `redis`, `rabbitmq`), so they only resolve inside the compose network — `npm run dev` will not be able to reach them unless you override `.env` with `localhost` addresses for the ports exposed above (5432, 6379, 5672).

## Testing the code

```bash
npm install
npm test
```

`npm test` runs the Jest/Supertest suite in `src/__tests__/`. These tests exercise the app and services directly with mocked repos/queues, so no Docker services need to be running.

Test files, by area:

- `index.test.js`, `health.test.js`, `app.js` wiring — server bootstrap and health check
- `shorten.test.js`, `redirect.test.js`, `clicks.test.js` — the three HTTP routes
- `linksRepo.test.js`, `db.test.js`, `cache.test.js`, `queue.test.js` — the Postgres/Redis/RabbitMQ repo layer
- `clickPublisher.test.js`, `clickConsumer.test.js`, `statsService.test.js` — click-event publish/consume and stats logic

To manually exercise the full stack end-to-end, bring the stack up with `docker compose up --build` and hit the endpoints, e.g.:

```bash
curl -X POST http://localhost/shorten -H 'Content-Type: application/json' -d '{"url":"https://example.com"}'
curl -i http://localhost/<code>
curl http://localhost/<code>/clicks
```

## Checking the BMad artifacts

This project was planned and built with BMad (BMAD-METHOD). Planning and implementation artifacts live under `_bmad-output/`:

```
_bmad-output/
├── planning-artifacts/
│   ├── briefs/brief-url-shortener-2026-09-01/brief.md          # Product brief
│   ├── prds/prd-url-shortener-2026-09-01/prd.md                # PRD (+ addendum.md)
│   ├── architecture/architecture-url-shortener-2026-09-01/
│   │   └── ARCHITECTURE-SPINE.md                                # Architecture decisions
│   └── epics.md                                                 # Epic/story breakdown, FRs & NFRs
└── implementation-artifacts/
    ├── epic-1-context.md, epic-2-context.md                     # Per-epic implementation context
    ├── spec-*.md                                                # Per-story specs (one per story)
    └── bmad-build-auto-result-*.md                              # Build-run logs/results
```

Read them in this order to understand what was planned vs. built:

1. **Brief** (`briefs/.../brief.md`) — the original product idea and scope.
2. **PRD** (`prds/.../prd.md` + `addendum.md`) — functional requirements (FR1–FR10) and non-functional requirements (NFR1–…), e.g. cache-aside lookups, out-of-band click counting, eventual consistency.
3. **Architecture** (`architecture/.../ARCHITECTURE-SPINE.md`) — the technical decisions behind the FRs (Postgres/Redis/RabbitMQ roles, service boundaries).
4. **Epics** (`epics.md`) — how the PRD/architecture were broken into epics and stories.
5. **Spec files** (`implementation-artifacts/spec-<epic>-<story>-*.md`) — the concrete spec each story was implemented against; compare against the corresponding `src/` files and git history (`git log --oneline`) to see what shipped for each story.

`_bmad/` holds the BMad tooling/config itself (agents, skills, workflows) rather than project artifacts — you generally don't need to open it to understand this project's requirements or design.

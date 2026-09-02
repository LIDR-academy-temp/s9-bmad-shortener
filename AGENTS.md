<!-- bmad:context -->
<!-- Verified 2026-09-01 against 52f50d3. Managed by bmad-project-context; edits inside this block are replaced on refresh. Keep anything you want preserved outside the markers. -->

## url-shortener

URL shortener API. Node 20, CommonJS, Express 5. Greenfield — `src/app.js` currently holds only a `/health` route; `pg`, `redis`, and `amqplib` are installed dependencies but no code uses them yet. Docker Compose declares `postgres`, `redis`, `rabbitmq`, `api`, and `nginx` services for when that lands. No BMad planning artifacts exist yet.

## Running and verifying

- `npm test` runs the Jest/Supertest suite against `src/app.js` directly — no services need to be running.
- `.env` targets Docker Compose service hostnames (`postgres`, `redis`, `rabbitmq`), which only resolve inside the compose network. `npm run dev` runs the app on the host via nodemon, so any code that starts using those services will need `docker compose up --build`, not `npm run dev`, to reach them.

<!-- /bmad:context -->

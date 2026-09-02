---
title: PRD - MVP URL Shortener
status: draft
created: 2026-09-01
updated: 2026-09-01
---

# PRD: URL Shortener MVP

Source: `brief-url-shortener-2026-09-01/brief.md`

## Overview

A minimal bit.ly-style service: shorten a URL, redirect through it, and see how many times it's been used. Built as a hands-on exercise in two specific patterns — a Redis cache-aside read path, and RabbitMQ decoupling a side effect (click counting) from the request that triggers it — not as a competitive product. Scope is deliberately narrow; see Out of Scope.

## Goals

- Prove out a cache-aside redirect path: reads go to Redis first, fall back to the system of record on miss, and populate the cache.
- Prove out an async side-effect path: the redirect response does not wait on the click count being written.
- Ship it with automated test coverage, running the existing repo's `docker compose` services (api, postgres, redis, rabbitmq, nginx).

## Users

- **Primary — the builder.** Practicing the cache-aside + async-fanout pattern and the BMad brief → PRD → build flow. The "user" whose success criteria matter most here.
- **Secondary — link creator / link visitor.** Whoever shortens a URL expects it to redirect correctly and wants to know how many times it's been visited; whoever clicks it expects a fast, correct redirect. Modeled lightly — no dedicated persona section, hobby-scale product.

## Functional Requirements

### Shortening

- **FR1**: The system accepts a long URL via an HTTP endpoint and returns a short code / short URL. No custom alias input is accepted.
- **FR2**: The system generates the short code itself (auto-generated); code collisions are explicitly not handled in this MVP. `[ASSUMPTION]`

### Redirect

- **FR3**: The system resolves a short code to its original URL and issues an HTTP redirect to the client.
- **FR4**: On resolving a short code, the system checks Redis first (cache hit → serve from cache). On a cache miss, it falls back to the persistent store and populates Redis with the result before responding.
- **FR5**: An unknown short code returns a not-found response rather than a redirect. `[ASSUMPTION]`

### Click Tracking

- **FR6**: On every successful redirect, the system publishes a click event to RabbitMQ. The redirect response is returned without waiting for this event to be consumed or the count to be updated.
- **FR7**: A consumer process reads click events from RabbitMQ and increments the click count for the corresponding short code.
- **FR8**: A message that fails to process is an accepted loss for this MVP — no retry, no dead-letter queue.

### Click Count Query

- **FR9**: The system exposes an endpoint that returns the current click count for a given short code.
- **FR10**: The click count is per short code; there is no endpoint aggregating counts across all short codes.

## Non-Functional Requirements

- **NFR1 — Redirect latency isolation.** Click-count processing must not add latency to the redirect response; it happens fully out of band via the queue.
- **NFR2 — Eventual consistency.** The click count is eventually consistent with actual redirects, not strongly consistent — a small, bounded lag between a redirect and the count reflecting it is acceptable.
- **NFR3 — Test isolation.** The automated test suite runs without any live external services (matching the existing Jest/Supertest suite convention in this repo), while the full stack is separately verifiable via `docker compose up` (api, postgres, redis, rabbitmq, nginx).
- **NFR4 — No auth, no rate limiting.** Explicitly out of scope; endpoints are unauthenticated and unthrottled for this MVP.

## Success Metrics

- Shorten → redirect → count round-trip works correctly end to end under `docker compose up`.
- Cache-aside behavior is observable and correct in tests: a resolved short code is served from Redis on subsequent lookups, and a miss correctly falls back and repopulates the cache.
- Automated tests (shorten, redirect cache-hit, redirect cache-miss, count) pass with no live services running.
- **Counter-metric**: cache-aside correctness is not achieved by sacrificing accuracy — a cached entry must never diverge from the persistent store's mapping for the same short code.

## Out of Scope

- Custom aliases / vanity short codes.
- Updating or deleting an existing short URL.
- Retry logic or a dead-letter queue for click-count processing.
- Short-code collision handling.
- Auth, rate limiting, link expiration, per-link analytics beyond a raw count, any UI/frontend.
- A global click count across all URLs.

## Open Questions

- Exact short-code format/length, redirect status code (301 vs 302), and RabbitMQ topology (queue/exchange naming) are implementation-level decisions — see `addendum.md`. Flag if any of these should instead be a hard product requirement rather than an implementation choice.

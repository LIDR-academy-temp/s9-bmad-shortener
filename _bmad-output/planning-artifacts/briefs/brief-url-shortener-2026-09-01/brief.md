---
title: Product Brief - MVP URL Shortener
status: draft
created: 2026-09-01
updated: 2026-09-01
---

# Product Brief: URL Shortener MVP

## Executive Summary

A minimal, bit.ly-style URL shortener: submit a long URL, get back a short code; visiting the short link redirects to the original destination and the visit is counted. The scope is deliberately narrow — no aliases, no editing, no delete, no retry/DLQ machinery — so the project stays focused on getting one thing right: a fast, cache-backed redirect path with click tracking that doesn't sit in the critical path of the redirect itself.

This is a hands-on exercise, not a market play. The point is to build and test a small, realistic service end to end — API in, Redis cache-aside on the read path, RabbitMQ decoupling the write side (click counting) from the request/response cycle — using the BMad planning workflow itself as the other thing under test.

## The Problem

Long URLs are unwieldy to share, and once shared, the person who shared them has no visibility into whether anyone clicked. URL shorteners solve both: a short, shareable code, and (in the fuller version of the product) insight into engagement. This MVP takes the smallest honest slice of that problem — shorten and redirect, plus a count of how many times a given link was used — and leaves everything else (custom branding, link management, retry-safe delivery) for later.

## The Solution

A small HTTP API with three operations:

- **Shorten**: accept a long URL, generate a short code server-side, persist the mapping, return the short URL.
- **Redirect**: given a short code, resolve it to the original URL and redirect the client, reading through Redis first (cache-aside) and falling back to the system of record on a miss.
- **Count**: given a short code, return how many times it has been visited.

Click counting is asynchronous: the redirect responds as soon as the destination is resolved, and a message is published to RabbitMQ so the increment happens off the request path. A consumer processes that message and updates the count. This is the core pattern under test — the redirect's latency shouldn't depend on the click-counting write.

## What Makes This Different

Nothing — and that's fine, since differentiation isn't the point here. This is a scoped-down clone of an extremely well-understood product category, built to practice a specific architecture (cache-aside reads + async event-driven side effects) rather than to compete with anything. `[ASSUMPTION]` No positioning, branding, or growth strategy is in scope for this brief.

## Who This Serves

- **Primary: the builder (you).** A developer using this project to practice and validate a cache-aside + message-queue pattern in a realistic, if small, service — and to test-drive the BMad brief → PRD → build workflow itself.
- **Secondary: the hypothetical end user of the shortened links.** Someone who shortens a URL to share it, and whoever clicks that link expects a fast, correct redirect. Their needs are simple: the link works, and it's fast.

## Success Criteria

- Shortening a URL returns a working short code; visiting it redirects to the original URL.
- Redirect reads are served from Redis on cache hit, with correct fallback and cache population on miss (cache-aside behaves as designed, observable via cache hit/miss in testing).
- A click is eventually reflected in the count endpoint after redirect, without the redirect response waiting on that update.
- Automated tests cover shorten, redirect (cache hit and miss), and count, and pass without any external services running `[ASSUMPTION: consistent with the existing Jest/Supertest suite in this repo, which runs against the app directly with no live services]`.
- The three endpoints and the async click path run correctly end to end under `docker compose up` (api, postgres, redis, rabbitmq, nginx).

## Scope

**In (MVP):**
- `POST` shorten endpoint — accepts a long URL, returns an auto-generated short code/URL. No custom aliases.
- `GET` redirect endpoint — resolves short code to long URL via Redis cache-aside (check cache, fall back to persistent store, populate cache on miss), issues an HTTP redirect.
- Async click counting — redirect publishes an event to RabbitMQ; a consumer increments the click count for that short code.
- `GET` click count endpoint — returns the total click count for a given short code.
- Automated tests covering the above.

**Out (explicitly, for this MVP):**
- Custom aliases / vanity short codes.
- Updating or deleting an existing short URL.
- Retry logic or a dead-letter queue for the click-counting consumer — a dropped or failed message is an accepted loss for this scope.
- Short-code collision handling — not addressed as a brief-level concern for this pass.
- Auth, rate limiting, link expiration, per-link analytics beyond a raw count, and any UI/frontend.
- A global click count across all URLs — count is per short URL only.

## Vision

If this holds up as an exercise, the same skeleton — API, cache-aside read path, async fan-out via queue — is reusable for the next thing that needs the pattern, and the collision-handling, retry/DLQ, and alias features that were cut here become natural follow-on scope rather than a redesign. No roadmap commitment beyond that; this brief covers the MVP only.

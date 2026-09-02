---
title: 'Query the click count for a short code'
type: 'feature'
created: '2026-09-02'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
deferred:
  - summary: >-
      The short-code format regex (`^[A-Za-z0-9]{7}$` / its length and
      alphabet) is now duplicated across `services/redirectService.js`,
      `services/statsService.js`, and `services/shortenService.js`'s
      generation constants, with no shared source of truth.
    evidence: |-
      statsService.js defines its own local CODE_FORMAT constant, mirroring
      (by design, per this story's spec) redirectService.js's pre-existing
      identical local constant. shortenService.js separately encodes the
      same 7-character base62 shape via its own generation constants. A
      future change to code length/alphabet would need to be applied in
      three places with nothing to catch a missed one. Pre-existing pattern
      (redirectService's copy predates this story) reinforced, not
      introduced, by this change.
    location: >-
      src/services/statsService.js, src/services/redirectService.js,
      src/services/shortenService.js
    severity: low
  - summary: >-
      No test exercises the DB-error path where
      linksRepo.findClickCount/pool.query rejects for GET /:code/clicks,
      so the route's next(err)/500 behavior on a DB failure is untested.
    evidence: |-
      clicks.test.js and statsService.test.js only exercise found/not-found
      branches; neither mocks a rejecting linksRepo.findClickCount or
      pool.query to assert the error propagates to next(err). This mirrors
      an identical pre-existing gap on GET /:code's own DB-error path
      (redirect.test.js has no such test for linksRepo.findByCode either),
      not a new problem introduced by this story's design.
    location: >-
      src/routes/links.js (GET /:code/clicks), src/services/statsService.js
    severity: low
baseline_revision: '76987ea5cfad40d11c3783326718feb7d5bf628e'
---

<intent-contract>

## Intent

**Problem:** `links.click_count` increments correctly (Story 2.2), but nothing exposes it over HTTP — link creators have no way to see how many times their short code was visited.

**Approach:** Add `GET /:code/clicks` at root level, backed by a new thin pass-through `services/statsService.js` that validates the code format and reads the count via a new `linksRepo` lookup, returning `200 { "code": "<code>", "clicks": <n> }` or `404 { "error": "short code not found" }`.

## Boundaries & Constraints

**Always:**
- `GET /:code/clicks` sits at root in `src/routes/links.js` (not nested under `/shorten`), matching `GET /:code`'s existing placement.
- `routes/links.js` calls only `services/statsService.js`, never `repos/linksRepo.js` directly (AD-1 layering: routes → services → repos).
- `statsService.js` is a thin pass-through: validates the code shape, then delegates the DB read to `linksRepo` — no business logic beyond that.
- A malformed code (fails the existing `^[A-Za-z0-9]{7}$` shape, mirroring `redirectService.js`'s `CODE_FORMAT`) and an unknown code both return the identical `404 { "error": "short code not found" }` — no distinct treatment (per epics.md AC and ARCHITECTURE-SPINE.md's route table note).
- The new repo read (`click_count` by code) is a plain `SELECT`, added alongside `findByCode` in `linksRepo.js` — it does not touch or reuse `incrementClickCount` (that stays consumer-only per AD-4, unaffected by this story).
- Response body's `clicks` is a number (the raw `click_count` integer column value, no formatting).

**Block If:** None identified — the ACs and architecture spine fully determine behavior.

**Never:**
- Never add an endpoint that aggregates click counts across all short codes (FR10) — only the single-code query.
- Never return the internal Postgres `id` in the response.
- Never call `linksRepo.incrementClickCount` from this path.
- Never introduce a logging library other than `pino` (none is needed for this story's happy/error paths, but if added, must be `pino`).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Existing code | `GET /abc1234/clicks`, row exists with `click_count = 42` | `200 { "code": "abc1234", "clicks": 42 }` | No error expected |
| Existing code, zero clicks | `GET /def5678/clicks`, row exists with `click_count = 0` | `200 { "code": "def5678", "clicks": 0 }` | No error expected |
| Unknown code | `GET /nowhere1/clicks`, well-formed but no matching row | `404 { "error": "short code not found" }` | Handled in route, no throw |
| Malformed code | `GET /short/clicks` (too short) or `GET /abc-123/clicks` (non-base62) | `404 { "error": "short code not found" }`, no DB query issued | Rejected by format check before repo call |

</intent-contract>

## Code Map

- `src/routes/links.js` -- add `router.get('/:code/clicks', ...)` after the existing `router.get('/:code', ...)` handler, calling `statsService.getClickCount(req.params.code)` and mapping `{ found: false }` → 404, `{ found: true, clicks }` → `200 { code: req.params.code, clicks }`. Import `statsService` alongside the existing `shortenService`/`redirectService` imports. Express matches this two-segment path independently of the one-segment `/:code` route, so handler order relative to `/:code` doesn't matter, but placing it directly after `/:code` groups the two read paths together for readability.
- `src/services/statsService.js` (new) -- mirrors `redirectService.js`'s shape: a local `CODE_FORMAT = /^[A-Za-z0-9]{7}$/` constant, and `async function getClickCount(code)` that returns `{ found: false }` when the format check fails (no repo call), otherwise calls `linksRepo.findClickCount(code)` and returns `{ found: false }` when it resolves `undefined`, else `{ found: true, clicks }`. Export `{ getClickCount }`.
- `src/repos/linksRepo.js` -- add `findClickCount(code)` mirroring `findByCode`'s exact shape: `SELECT click_count FROM links WHERE code = $1`, `[code]`, returning `result.rows[0] ? result.rows[0].click_count : undefined`. Add to `module.exports` alongside the existing three functions.
- `src/services/redirectService.js` -- read only, reference for the `CODE_FORMAT` regex and the `{ found, ... }` shaped return convention this story mirrors; no changes.
- `src/__tests__/linksRepo.test.js` -- extend with `findClickCount` tests: correct SQL/binding, returns the count when a row matches, returns `undefined` when no row matches (mirrors the existing `findByCode` test pair).
- `src/__tests__/statsService.test.js` (new) -- unit tests: malformed code short-circuits to `{ found: false }` without calling `linksRepo.findClickCount`; well-formed code with a matching row returns `{ found: true, clicks: n }`; well-formed code with no matching row returns `{ found: false }`.
- `src/__tests__/redirect.test.js` -- reference only for the existing `supertest`/`jest.mock('../repos/linksRepo')`/`jest.mock('../repos/db', ...)` HTTP-route-test pattern this story's new route test file follows; no changes.
- `src/__tests__/clicks.test.js` (new) -- HTTP-level tests for `GET /:code/clicks` via `supertest`, mocking `services/statsService` (matching the layering: route tests mock the service, not the repo, keeping consistency with how `shorten.test.js`/`redirect.test.js` mock at the boundary the route itself calls): 200 with the current count on an existing code, 404 on an unknown code, 404 on a malformed code.

## Tasks & Acceptance

**Execution:**
- `src/repos/linksRepo.js` -- add `findClickCount(code)` reading `click_count` by code -- supports FR9/FR10 per AD-1 layering.
- `src/services/statsService.js` (new) -- add `getClickCount(code)` validating format then delegating to `linksRepo.findClickCount` -- implements the thin pass-through role from ARCHITECTURE-SPINE.md's Capability → Architecture Map (`Click count query (FR9, FR10)` → `statsService.js` → AD-1, AD-3).
- `src/routes/links.js` -- add `GET /:code/clicks` calling `statsService.getClickCount` and mapping to the `200`/`404` response shapes -- implements FR9/FR10.
- `src/__tests__/linksRepo.test.js` -- extend with `findClickCount` coverage.
- `src/__tests__/statsService.test.js` (new) -- cover all three I/O matrix service-level branches (malformed short-circuit, found, not found).
- `src/__tests__/clicks.test.js` (new) -- cover the route's HTTP-level 200/404/404 behavior per the I/O matrix.

**Acceptance Criteria:**
- Given an existing short code, when `GET /:code/clicks` is called, then the response is `200 { "code": "<code>", "clicks": <n> }` reflecting the current `click_count` (eventually consistent with recent redirects per NFR2).
- Given an unknown or malformed short code, when `GET /:code/clicks` is called, then the response is `404 { "error": "short code not found" }`.
- Given the full set of routes in `src/routes/links.js`, when reviewed, then no route aggregates click counts across all short codes — only the single-code `GET /:code/clicks` query exists (FR10).

## Spec Change Log

## Review Triage Log

### 2026-09-02 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 2 (low 2)
- reject: 11 (high 0, medium 0, low 11)
- addressed_findings:
  - none

Rejected findings (all out of scope for this story's intent, already correct by design, or matching pre-existing codebase convention this story did not introduce): no auth/rate limiting on `GET /:code/clicks` (explicitly excluded by NFR4 per ARCHITECTURE-SPINE.md); no eventual-consistency marker (`asOf`/`updatedAt`) in the response body (the response shape is fixed by ARCHITECTURE-SPINE.md's route table — `{ "code": "<code>", "clicks": <n> }` only); no full route→service→repo integration test (matches the existing layered-mock test convention already used by `redirect.test.js`/`shorten.test.js`); `findClickCount` structurally mirroring `findByCode` with no shared helper (explicitly directed by this story's spec Code Map, mirroring the established per-function repo convention); no test asserting `clicks`'s JS type against a hypothetical future `BIGINT` column (speculative, `click_count` is `INTEGER` today); `/clicks` reading Postgres directly instead of through the Redis cache used by the redirect path (deliberate — `statsService` is a thin pass-through per AD-1/AD-3, no cache tier was specified or needed for this story); malformed/unknown 404 collapsing being "undocumented" (it is documented, in ARCHITECTURE-SPINE.md's route-table note); no README/API doc update (no such doc exists or was required by any prior story in this codebase); `result.rows[0]` truthiness check being "fragile" (identical pre-existing pattern in `findByCode`, unchanged by this story); no case-sensitivity test for the code param (mirrors `GET /:code`'s own untested case-sensitivity, pre-existing parity); format validation living in `statsService` rather than the route (matches `redirectService`'s identical pre-existing convention, not a new choice).

## Design Notes

`statsService.getClickCount` mirrors `redirectService.resolveCode`'s `{ found, ... }` return convention so `routes/links.js` maps both the same way:

```js
// statsService.js
async function getClickCount(code) {
  if (!CODE_FORMAT.test(code)) {
    return { found: false };
  }
  const clicks = await linksRepo.findClickCount(code);
  if (clicks === undefined) {
    return { found: false };
  }
  return { found: true, clicks };
}
```

## Verification

**Commands:**
- `npm test` -- expected: all existing and new tests pass, including the new `statsService.test.js` and `clicks.test.js` and the extended `linksRepo.test.js`; no live Postgres connection required (NFR3).

## Auto Run Result

**Summary:** `GET /:code/clicks` is implemented as the single per-code click-count query endpoint. `src/repos/linksRepo.js` gained `findClickCount(code)`, a plain `SELECT click_count FROM links WHERE code = $1` mirroring `findByCode`'s shape, returning the count or `undefined`. `src/services/statsService.js` (new) is a thin pass-through: it validates the code against the same `^[A-Za-z0-9]{7}$` shape `redirectService.js` uses, short-circuiting to `{ found: false }` on malformed input without a repo call, and otherwise maps `undefined` to `{ found: false }` and any real value (including `0`) to `{ found: true, clicks }`. `src/routes/links.js` adds `router.get('/:code/clicks', ...)` at root level (not nested under `/shorten`), calling only `statsService.getClickCount` and mapping to `200 { code, clicks }` / `404 { error: "short code not found" }`. No aggregate-across-codes endpoint exists (FR10). This closes out Epic 2 and completes MVP scope (FR1-FR10).

**Files changed:**
- `src/repos/linksRepo.js` -- added `findClickCount(code)`, exported alongside the existing three functions.
- `src/services/statsService.js` (new) -- `getClickCount(code)`, format validation + thin pass-through to `linksRepo.findClickCount`.
- `src/routes/links.js` -- added `GET /:code/clicks`, importing and calling only `statsService`.
- `src/__tests__/linksRepo.test.js` -- extended with `findClickCount` SQL/binding and no-row-match tests.
- `src/__tests__/statsService.test.js` (new) -- covers malformed short-circuit (no repo call), found, not-found, and zero-clicks branches.
- `src/__tests__/clicks.test.js` (new) -- HTTP-level tests via `supertest`, mocking `services/statsService`: 200 on an existing code, 200 with `clicks: 0`, 404 on an unknown code, 404 on a malformed code.

**Review findings breakdown:** 0 patches applied, 2 deferred (both low severity: `CODE_FORMAT`/code-shape duplication across three service files with no shared source of truth; no test for the DB-error path on `GET /:code/clicks`), 11 rejected (all out-of-scope-by-design per NFR4/architecture spine, or matching pre-existing codebase convention this story did not introduce — see Review Triage Log above).

**Follow-up review recommendation:** `false`. No findings were triaged `patch` in this pass (patched-finding score: 0), so the threshold is not met.

**Verification performed:**
- `npm test` -- `Test Suites: 12 passed, 12 total`, `Tests: 63 passed, 63 total`, run at the end of implementation and again after the Matrix Test Audit added the zero-clicks coverage, with identical pass results both times.
- I/O & Edge-Case Matrix audit: all four rows (existing code, existing code with zero clicks, unknown code, malformed code) are each covered by a passing test in `statsService.test.js` and/or `clicks.test.js` -- the zero-clicks row's tests were added during the Matrix Test Audit step after the initial implementation pass had only exercised a nonzero count.
- Four independent review layers (blind-hunter, edge-case-hunter, verification-gap, intent-alignment) ran against the diff; edge-case-hunter and verification-gap found nothing; blind-hunter's 13 findings triaged to 2 low-severity defers and 11 rejects; intent-alignment found the diff implements the spec's chosen reading (format check in the service layer, matching `redirectService`'s existing precedent) with no actionable divergence.
- AD-1 layering check: confirmed by direct read of `src/routes/links.js` -- it imports and calls only `statsService`, never `linksRepo`, directly.
- FR10 check: confirmed by direct read of `src/routes/links.js` -- no route aggregates click counts across all short codes; only the single-code `GET /:code/clicks` exists.

**Residual risks:**
- The short-code format regex/length is duplicated across `redirectService.js`, `statsService.js`, and `shortenService.js`'s generation constants with no shared source of truth -- a future format change would need to touch all three with nothing to catch a missed one. Recorded as a deferred finding (low severity).
- No test exercises the DB-error path where `linksRepo.findClickCount`/`pool.query` rejects for `GET /:code/clicks` -- the route's `next(err)` fallback is exercised by no test, mirroring an identical pre-existing gap on `GET /:code`'s own DB-error path. Recorded as a deferred finding (low severity).
- The click count is only as fresh as `clickConsumer.js`'s asynchronous processing of the `click-events` queue (Story 2.2) -- this is the intended eventually-consistent behavior per NFR2, not a defect, but a caller polling immediately after a redirect may see a stale count.

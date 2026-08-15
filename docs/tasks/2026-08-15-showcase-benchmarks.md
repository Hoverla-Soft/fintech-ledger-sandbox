# Task: Showcase performance benchmarks

Part of the client-facing showcase program (docs/showcase/). The only code-touching deliverable: a reproducible benchmark harness plus a published results page.

## Goal

A prospective client can read `docs/showcase/benchmarks.md` and see real, honestly-framed numbers for this ledger — read throughput under load, write latency within the deliberate rate-limit budget, idempotent-replay latency, and the 429 contract demonstrated — and can reproduce every number with one command.

## Status

Human Review

## Scope (allowed paths)

- `scripts/bench/**`
- `package.json`
- `pnpm-lock.yaml`
- `docs/showcase/benchmarks.md`
- `docs/development/tech-stack.md`
- `docs/tasks/2026-08-15-showcase-benchmarks.md`

## Out of scope

- Any change to server/api/db/core code — the harness measures what exists; it must not "optimize" anything.
- Raising or bypassing the write rate limits (ADR 0007) to make numbers look better. The limiter is part of the design and is benchmarked as such.
- CI integration of the bench run (a bench in CI shares runners and lies; local reproducible runs only).

## Related docs

- `docs/adr/0007-rate-limiting.md` — why writes are capped (30/min/user, 60/min/org) and why the bench reports write *latency*, not throughput
- `docs/adr/0004-idempotency.md` — the replay path the bench exercises
- `docs/backend/api-flow.md`

## External sources

- Task/issue: N/A: local showcase program, no external tracker entry
- Product documentation: N/A: all sources local
- Design: N/A: not a UI task

## Acceptance criteria

- `node scripts/bench/run.mjs` performs full setup itself (sign-up, org, seed) against a locally running server and needs no manual fixtures.
- Reads benchmarked under concurrent load (autocannon): req/s + latency percentiles for health baseline, accounts list, transactions list, dashboard summary.
- Writes benchmarked within the rate budget: fresh-post latency and idempotent-replay latency, with the script asserting `replayed: false/true` respectively so the numbers provably measure what they claim.
- The 429 path demonstrated: the conforming error body (`data.reason`, retry-after) captured in the report.
- `docs/showcase/benchmarks.md` publishes methodology (hardware, dataset size, commands) alongside results — no number without provenance.

## Verification

```bash
pnpm lint
pnpm check-types
pnpm test
pnpm build
```

## Retention

Move to `docs/tasks/archive/2026/` when Done.

## Spec completeness checklist

### Common
- [x] Actor(s) defined — a developer running the bench locally
- [x] Entry point defined — `node scripts/bench/run.mjs`
- [x] Preconditions described — Docker Postgres up, migrations applied, server running on the bench port
- [x] Happy path described — setup → read load runs → write latency runs → report
- [x] Error paths described — script aborts on failed setup step; 429 path is an *expected* measured outcome
- [x] Permissions considered — bench user is org owner (admin role) created by the script itself
- [x] Acceptance criteria written
- [x] Tests defined — script self-asserts replay flags and 429 body shape; repo test suite unaffected
- [x] Out of scope stated explicitly

### Backend
- [ ] API endpoints defined — N/A: no endpoint changes; harness consumes existing OpenAPI surface
- [ ] Validation described — N/A: no schema changes
- [ ] Error responses defined — N/A: no contract changes
- [x] Side effects listed — bench writes land in a throwaway bench org in the local sandbox DB

### Frontend
- [ ] Loading state defined — N/A: no UI
- [ ] Empty state defined — N/A: no UI
- [ ] Error state defined — N/A: no UI
- [ ] Navigation after each action defined — N/A: no UI
- [ ] Feedback (toast/inline/modal) defined — N/A: no UI

---

*Started 2026-08-15.*

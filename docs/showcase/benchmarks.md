# Performance benchmarks

Real numbers from a reproducible harness — not claims. Every figure below was produced by [`scripts/bench/run.mjs`](../../scripts/bench/run.mjs), which sets up its own throwaway user, organization, and seeded ledger, then measures the running API over HTTP. Anyone can reproduce the run in about three minutes; commands are at the bottom.

Two framing decisions, made deliberately:

- **Writes are reported as latency, not throughput.** This ledger rate-limits its write surface on purpose — 30 writes/min per user, 60/min per organization ([ADR 0007](../adr/0007-rate-limiting.md)) — because a write takes row locks on the org's accounts and an uncapped burst converts directly into pool exhaustion. Benchmarking "transfers per second" against our own limiter would be theater. The honest write numbers are: how fast is one transfer, and how fast is its idempotent replay.
- **The 429 is demonstrated, not hidden.** The harness deliberately exhausts the budget and asserts the error contract clients are promised.

## Environment

| | |
|---|---|
| Commit | `c516b39` |
| Date | 2026-08-15 |
| Hardware | Apple M3, 8 cores, 16 GB |
| Runtime | Node v26.1.0, Darwin 25.5.0 |
| Database | postgres:18 (Docker, [`packages/db/docker-compose.yml`](../../packages/db/docker-compose.yml)) |
| Topology | client, API, and Postgres on one machine over loopback |
| Dataset | seeded demo ledger ([`sandbox.seed`](../../packages/api/src/sandbox/scenarios.ts): 6 accounts + demo scenarios) plus the transfers the run itself posts |

## Reads under concurrent load

10-second [autocannon](https://github.com/mcollina/autocannon) runs, 20-request warm-up per target. Every request in the three authenticated rows carries a real session cookie and pays the full request cost: Better-Auth session lookup, membership verification against the `member` table ([ADR 0005](../adr/0005-tenant-isolation.md) — tenancy is checked per request, never cached away), input validation, the org-scoped query itself, and Zod-validated output. Zero non-2xx responses in every run — asserted by the harness, not eyeballed.

| Endpoint | Connections | Req/s | p50 | p97.5 | p99 |
|---|---|---|---|---|---|
| Health baseline (no session, no DB) | 10 | 21 207 | 0 ms | 1 ms | 1 ms |
| Health baseline (no session, no DB) | 50 | 21 831 | 2 ms | 3 ms | 4 ms |
| `accounts.list` (limit 50) | 10 | 3 085 | 3 ms | 4 ms | 4 ms |
| `accounts.list` (limit 50) | 50 | 2 885 | 16 ms | 21 ms | 24 ms |
| `transactions.list` (limit 20, joined postings) | 10 | 1 288 | 7 ms | 10 ms | 13 ms |
| `transactions.list` (limit 20, joined postings) | 50 | 1 241 | 39 ms | 51 ms | 67 ms |
| `dashboard.summary` (cross-account aggregation) | 10 | 1 869 | 5 ms | 7 ms | 9 ms |
| `dashboard.summary` (cross-account aggregation) | 50 | 1 753 | 27 ms | 43 ms | 56 ms |

Reading the table: the gap between the 21k req/s baseline and the ~3k req/s authenticated rows is the price of doing tenancy honestly — session + membership verification on every request. Throughput holds essentially flat from 10 to 50 connections (the work is database-bound, so added concurrency buys queueing, not speed); latency degrades predictably and stays double-digit milliseconds at p99.

## Writes: fresh post vs idempotent replay

Sequential single-client requests to `transactions.create` (a balanced two-leg transfer), measured wall-clock in the harness. A fresh post runs the full pipeline: domain validation in [`packages/core`](../../packages/core), ordered row locks, funds check, balanced-postings insert, audit record, and a re-read so the response is byte-identical to `transactions.get` ([ADR 0006](../adr/0006-write-endpoint-contract.md)). A replay — same idempotency key, same payload — must skip the posting and return the original result ([ADR 0004](../adr/0004-idempotency.md)).

| Operation | n | p50 | p95 | max |
|---|---|---|---|---|
| Fresh transfer post | 29 | 4.91 ms | 12.32 ms | 17.95 ms |
| Idempotent replay (same key + payload) | 28 | 2.87 ms | 4.55 ms | 4.94 ms |

The harness asserts `replayed: false` on every fresh post and `replayed: true` on every replay — the numbers provably measure the path they claim to. The replay path being ~40% faster and tightly bounded (max 4.94 ms) is the idempotency design visible in the latency profile: a replay is a lookup, not a posting.

## The 429, demonstrated

After the per-user budget is spent, the next write returns the documented contract ([`packages/api/src/rate-limit.ts`](../../packages/api/src/rate-limit.ts)) — a machine-readable `data.reason`, never a string to parse out of `message`:

```json
{
  "code": "TOO_MANY_REQUESTS",
  "status": 429,
  "message": "Too many write requests. Retry shortly.",
  "data": {
    "reason": "rate_limited",
    "scope": "user",
    "limit": 30,
    "retryAfterSeconds": 60
  }
}
```

The per-user limit trips before the per-org limit by design — one admin cannot burn a whole organization's budget ([the middleware ordering is commented in `procedures.ts`](../../packages/api/src/procedures.ts)).

## Honest caveats

- **Loopback topology.** No network between client, API, and DB. These numbers measure the application, not a deployment; add your infrastructure's RTT.
- **Small dataset.** A seeded demo ledger, not millions of rows. Read queries are indexed and cursor-paginated ([`contracts/cursor.ts`](../../packages/api/src/contracts/cursor.ts)), but large-table behavior is not demonstrated here.
- **Small write sample.** n≈29 per class — the rate budget bounds how many writes one honest run may make. Percentiles at this n are indicative, not statistical.
- **In-process rate limiter.** Correct for this single-process sandbox; a multi-replica deployment would swap the store (recorded in ADR 0007).

## Reproduce

```bash
pnpm install && pnpm db:start && pnpm db:migrate

# terminal 1 — API on a dedicated port
cd apps/server && PORT=3010 BETTER_AUTH_URL=http://127.0.0.1:3010 \
  CORS_ORIGIN=http://127.0.0.1:3011 pnpm exec tsx src/index.ts

# terminal 2 — full run (~3 min), report JSON on stdout, tables on stderr
node scripts/bench/run.mjs
```

The harness aborts loudly on any setup failure, any non-2xx during load, or any broken assertion — a partially-valid run cannot silently produce a table.

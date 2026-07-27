# Architecture Decision Records

Load-bearing decisions for the fintech-ledger-sandbox, recorded so the *why* survives the code. Each ADR is immutable once accepted; a later decision that reverses it gets a new ADR that supersedes the old one (never edit history).

Format: numbered `NNNN-kebab-title.md`, with **Context / Decision / Consequences / Status**. Keep them short — a screenful. Per the HoverlaSoft standard, an ADR lands within 5 working days of the decision.

## Index

| # | Decision | Status |
|---|---|---|
| [0001](0001-internal-package-src-exports.md) | Internal packages export TypeScript source, not `dist` | Accepted |
| [0002](0002-money-representation.md) | Money representation: integer minor units as `bigint`, known-exponent currency allowlist | Accepted |
| [0003](0003-balance-and-concurrency.md) | Balance & concurrency: materialized balances + ordered `SELECT … FOR UPDATE` + trigger-enforced immutability, reconciliation as a continuously-asserted invariant | Accepted |
| [0004](0004-idempotency.md) | Idempotency: client-supplied keys, DB-uniqueness-enforced via a blocking plain `INSERT` (not `ON CONFLICT DO NOTHING`) | Accepted |

## Planned (the remaining load-bearing ledger decisions)

These are drafted as their phases land, so the reasoning is captured at decision time:

- **0005 — Tenant isolation**: the schema foundation (org-scoped tables, composite FKs, `org_id`-filtered reads) landed in Phase 3 (see ADR 0003); this ADR captures the remaining piece — API-level enforcement (auth/session middleware deriving the acting org, no endpoint accepting a caller-supplied `org_id`) — due with Phase 4.

# Architecture Decision Records

Load-bearing decisions for the fintech-ledger-sandbox, recorded so the *why* survives the code. Each ADR is immutable once accepted; a later decision that reverses it gets a new ADR that supersedes the old one (never edit history).

Format: numbered `NNNN-kebab-title.md`, with **Context / Decision / Consequences / Status**. Keep them short — a screenful. Per the HoverlaSoft standard, an ADR lands within 5 working days of the decision.

## Index

| # | Decision | Status |
|---|---|---|
| [0001](0001-internal-package-src-exports.md) | Internal packages export TypeScript source, not `dist` | Accepted |
| [0002](0002-money-representation.md) | Money representation: integer minor units as `bigint`, known-exponent currency allowlist | Accepted |

## Planned (the remaining load-bearing ledger decisions)

These are drafted as their phases land, so the reasoning is captured at decision time:

- **0003 — Balance & concurrency strategy**: materialized balances + immutable postings + `SELECT … FOR UPDATE`, reconciliation as an invariant (Phase 3).
- **0004 — Idempotency**: client-supplied idempotency keys, DB-uniqueness-enforced (Phase 3/4).
- **0005 — Tenant isolation**: Better Auth organization plugin, org-scoped everything, no cross-tenant reads (Phase 4).

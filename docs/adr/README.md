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
| [0005](0005-tenant-isolation.md) | Tenant isolation at the API boundary: the acting org is derived from a verified `member` row, never accepted as input; category-based `403`/`404` so neither orgs nor resources are enumerable | Accepted |
| [0006](0006-write-endpoint-contract.md) | Write endpoint contract: raw N-leg postings over a transfer shape, body-carried idempotency key, request hash over sorted canonical legs, every pre-persistence rejection audited | Accepted |
| [0007](0007-rate-limiting.md) | Rate limiting on `adminProcedure` (the write set by construction), keyed by the verified `orgId` with a secondary per-user limit, wrapped so the `429` carries `data.reason` | Accepted |
| [0008](0008-sandbox-reset.md) | Sandbox seed/reset: reset is a balance-compensating entry (never a deletion, never a per-transaction reversal), bounded and resumable; both procedures are `adminProcedure` endpoints, so ADR 0005's direct-caller hole is never opened | Accepted |
| [0009](0009-console-session-and-tenant-model.md) | Console session & tenancy: the active org is Better Auth session state changed only through `setActive`; the role is derived client-side as an affordance hint with an agreement test against the server's mapping; the query cache is cleared on org switch and sign-out | Accepted |
| [0010](0010-cross-currency-exchange.md) | Cross-currency exchange is **two linked single-currency transactions** committed together, not one multi-currency transaction: every existing invariant survives untouched, and the FX position sits openly on a pair of auto-opened `external` bridge accounts. The caller states the rate and the converted amount; the server verifies the conversion and refuses a mismatch | Accepted |

## Planned (the remaining load-bearing ledger decisions)

These are drafted as their phases land, so the reasoning is captured at decision time:

- *(none outstanding. Phase 7c's cross-currency model landed as ADR 0010. The anticipated "how the transfer screen composes an N-leg transaction" ADR was never needed — 5d's choices have not had to be revisited. The likeliest next candidate is FX gain/loss recognition, if anyone asks the bridge accounts' accumulated positions to mean something in a P&L.)*

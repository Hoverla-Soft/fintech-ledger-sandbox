# 0002 — Money representation: integer minor units as `bigint`

**Status:** Accepted (Phase 2)

## Context

Money must be exact, forever. Every transaction's postings must net to exactly zero and every account balance must reconcile with its posting history for the life of the sandbox — there is no tolerance budget to round into.

`number` (IEEE-754 double) is disqualified for amounts. Doubles cannot represent most decimal fractions exactly (`0.1` has no exact binary representation), so `0.1 + 0.2 !== 0.3` in JavaScript. That error is small per operation but accumulates across a long posting history that must reconcile exactly, not approximately — a ledger is exactly the workload floating point is wrong for.

Scaling to integer minor units does not rescue `number` either. `Number.MAX_SAFE_INTEGER` is `9_007_199_254_740_991` — about 90 trillion at a 2-decimal exponent (i.e. roughly $90 trillion expressed in cents). That is a real ceiling for an aggregate ledger summing balances and net deltas across every account and every posting in history, not a theoretical one.

A decimal arithmetic library (e.g. `decimal.js`, `big.js`) was considered and rejected. `packages/core` is deliberately kept a pure, dependency-light domain core (ADR 0001, `docs/development/architecture.md`) so `packages/api` and `packages/db` can trust its arithmetic without auditing a third-party numeric implementation. `bigint` is a native ECMAScript primitive — arbitrary-precision integer arithmetic with no package to install, version, or trust.

## Decision

Represent every monetary amount as integer **minor units** stored in a native `bigint`, paired with an ISO-4217 `Currency` whose minor-unit exponent is *known* ahead of time. `Money.ofMinorUnits` runtime-guards `typeof minorUnits === "bigint"` so a `number` (including an integral one), `NaN`, or a float coerced across an untyped boundary is rejected with a typed `InvalidAmount`, never silently accepted.

**Known-exponent currency allowlist** (decided 2026-07-27): a currency code is usable in the domain only when its ISO-4217 minor-unit exponent is on an explicit allowlist in `packages/core/src/money/currency.ts`. An unrecognized code is rejected with a typed `UnsupportedCurrency` — it is never defaulted to exponent 2, because formatting or parsing an amount at a guessed scale is a silent 100× error (e.g. treating a 3-decimal currency as 2-decimal). The allowlist currently covers all three real-world exponent scales: exponent 0 — whole units (JPY, ISK), exponent 2 — hundredths (USD, EUR, GBP, UAH, CHF, PLN), and exponent 3 — thousandths (BHD, KWD). A currency must be added here, with its exponent verified, before the domain can construct a `Money` in it.

`Money.parse` converts a decimal string to minor units using the currency's exponent and **rejects excess precision** rather than rounding or truncating: a string carrying more fraction digits than the currency's exponent permits fails with a typed `InvalidAmount` (`"excess-precision"`). Silent rounding is how money quietly goes missing; the domain forces the caller to resolve precision loss consciously rather than making that choice for them.

## Consequences

- **Pro:** arithmetic is exact by construction — `bigint` addition/subtraction/negation never loses precision, so a posting history can reconcile exactly no matter how long it grows.
- **Pro:** no external numeric dependency to trust for the domain's core arithmetic; `bigint` is a language primitive.
- **Pro:** an unrepresentable-scale currency or an over-precise decimal string fails loudly at construction (`UnsupportedCurrency` / `InvalidAmount`) instead of being silently misformatted or rounded — the two most common ways a ledger quietly loses money.
- **Con:** `bigint` does not serialize to JSON natively — `JSON.stringify` throws on a `bigint` value. This is a real downstream obligation for **Phase 4**: the `packages/api` boundary must encode `Money.minorUnits` as a string (not a raw JSON number) in every request/response payload, and decode it back through `Money.ofMinorUnits`/`Money.parse` rather than `JSON.parse`'s native number coercion.
- **Con:** a currency cannot be used anywhere in the domain until it is added to the known-exponent allowlist — onboarding a new currency is a deliberate code change (with a verified exponent), not a config toggle.
- **Con:** `bigint` arithmetic is measurably slower than `number` arithmetic in V8. Irrelevant at this sandbox's scale (a handful of postings per transaction, not a high-frequency workload), but a real cost if this domain were ever repurposed for a throughput-sensitive use case.

# 0004 — Idempotency

**Status:** Accepted (Phase 3)

## Context

`docs/product/requirements/ledger.md` invariant #4 requires that one client-supplied idempotency key yield exactly one transaction, even under concurrent retries — the standard "network timed out, was my transfer actually posted?" problem a payments-style API must answer safely. A naive check-then-insert ("does this key already exist? if not, insert") is a textbook race: two concurrent requests can both pass the check before either commits its insert, and both post.

Postgres offers two ways to turn a unique-constraint violation into application logic: let a plain `INSERT` fail and catch the violation, or use `INSERT ... ON CONFLICT DO NOTHING` and inspect whether a row came back. They behave differently under concurrency in a way that matters here.

## Decision

**Reserve the idempotency key with a plain `INSERT`, deliberately not `ON CONFLICT DO NOTHING`.** `reserveIdempotencyKey` (`packages/db/src/posting/reserve-key.ts`) inserts into `ledger_idempotency_key`, which carries `UNIQUE (org_id, key)` — that constraint *is* invariant #4's enforcement point, not just a data-integrity nicety.

The ordering choice is the subtlest thing in this phase, so it is worth spelling out why the two options are not interchangeable:

- **Plain `INSERT`:** when two concurrent transactions attempt the same `(org_id, key)`, the second one to reach the unique index **blocks**, waiting for the first to commit or roll back. Once the first committer resolves, the second either sees a `23505` unique-violation error (first committed) or succeeds (first rolled back, e.g. it was itself rejected before writing the key — although in practice a reservation failure here is treated as a real error, not a normal path). The blocking is exactly what makes the outcome deterministic: the loser cannot proceed until it *knows* who won.
- **`ON CONFLICT DO NOTHING`:** returns zero rows immediately, without blocking, the instant it detects a conflict is possible. Under Postgres's default `READ COMMITTED` isolation, an uncommitted row from a concurrent transaction is invisible to any other transaction. So if two callers race with `ON CONFLICT DO NOTHING`, both can see "no committed conflicting row yet," both get zero rows back with no error, and **both proceed to post** — precisely the double-post invariant #4 exists to prevent. `DO NOTHING` optimizes for never blocking, at the cost of not knowing whether it just lost a race it can't yet see.

A plain `INSERT` trades a short block (bounded by the winner's transaction, which is already short — one posting routine) for a correctness guarantee `DO NOTHING` cannot provide under concurrency. This project takes that trade deliberately.

**The reservation runs inside a `SAVEPOINT`, via a nested Drizzle transaction.** `reserveIdempotencyKey` wraps its `INSERT` in `tx.transaction(...)`, which drizzle-orm implements as a Postgres `SAVEPOINT` when called on an already-open transaction. Postgres marks an entire transaction as aborted after *any* error unless the failing statement ran inside a savepoint — without one, catching the `23505` in application code would not be enough to keep using the outer, caller-supplied transaction for the read that follows. The savepoint scopes the rollback to just the reservation attempt, leaving the rest of `postTransaction`'s transaction usable.

**`request_hash` distinguishes a replay from a conflict.** On a unique violation, `reserveIdempotencyKey` re-reads the existing `(org_id, key)` row and compares its stored `request_hash` against the caller's:

- **Same hash → replay.** The caller is retrying the identical request (same key, same payload). `postTransaction` returns the original result — `loadPostedTransaction` reconstructs it from `ledger_transaction`/`ledger_posting`/`ledger_account` — and posts nothing new.
- **Different hash → `IdempotencyConflict`.** The caller reused a key with a different payload, which is a client error, not a retry. `ledger.md` requires this to surface distinctly rather than silently replaying the wrong thing or silently posting a second transaction.

`transaction_id` on `ledger_idempotency_key` starts `NULL` at reservation time — the key is reserved *before* the transaction it will back exists — and is backfilled once `postTransaction` inserts the `ledger_transaction` row, in the same outer transaction. A rejected attempt (insufficient funds, unknown account, currency mismatch) rolls the reservation back with everything else, so a rejected key never persists at all and can be retried under the same key.

## Implementation gotcha worth recording

drizzle-orm 0.45 (the pinned version) wraps every driver error in its own `DrizzleQueryError`, whose `.cause` holds the raw `pg` `DatabaseError` — the object that actually carries `.code`. A naive `"code" in error && error.code === "23505"` check against the error `reserveIdempotencyKey`'s `catch` receives never matches, because `code` lives one level deeper than the error drizzle-orm hands back. `getPostgresErrorCode` (`packages/db/src/posting/reserve-key.ts`) walks the `cause` chain (depth-bounded, to guard against an unexpected circular chain) instead of reading `.code` off the top-level error.

This was a real bug caught during implementation, not a hypothetical one: without walking the `cause` chain, every unique-violation from a concurrent duplicate would have been mis-detected as an unhandled infrastructure error rather than converted into a replay or a conflict — silently breaking idempotency under exactly the concurrent-retry scenario invariant #4 exists to handle.

## Consequences

- **Pro:** invariant #4 holds under real concurrency because the database's unique index — not application-level timing — is the single source of truth for "who won."
- **Pro:** a client can always safely retry a request with the same key; the worst case is a replayed result, never a duplicate posting.
- **Pro:** a reused key with a different payload is caught and reported distinctly (`IdempotencyConflict`), rather than silently replaying stale results for a materially different request.
- **Con:** a losing concurrent caller blocks for the duration of the winner's entire posting transaction (lock acquisition, delta application, inserts, balance updates) before it can be told replay-or-conflict. This is a deliberate latency-for-correctness trade, not a defect, but it means idempotency-key contention is not free under high concurrency on the same key.
- **Con:** the `DrizzleQueryError`/`.cause` unwrapping in `getPostgresErrorCode` is coupled to drizzle-orm's current error-wrapping behavior. A drizzle-orm upgrade that changes how driver errors are wrapped could silently break unique-violation detection again unless this function (and its test coverage) is revisited alongside any future drizzle-orm version bump.

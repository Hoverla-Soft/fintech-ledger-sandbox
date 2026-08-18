import { createHash } from "node:crypto";

import type { Transaction } from "@fintech-ledger-sandbox/core";

/**
 * The idempotency request fingerprint.
 *
 * `postTransaction` stores this alongside the client's idempotency key, and
 * `reserve-key.ts` compares it on a retry to decide between two very different
 * outcomes: **same key + same hash → replay the original result**, and **same
 * key + different hash → `409 IdempotencyConflict`** (ADR 0004). Getting the
 * derivation wrong therefore breaks idempotency *silently* — a hash that is
 * too sensitive turns honest retries into false conflicts, and one that is too
 * loose replays a result for a request that was not actually the same.
 *
 * ### What goes in
 *
 * The **validated domain payload**, not the raw request body:
 *
 * - **Legs, sorted** by `(accountId, direction, amount)`. This is the
 *   load-bearing choice. `Transaction.deltas()` nets postings by account
 *   before anything is persisted, so two orderings of the same legs produce a
 *   byte-identical ledger effect — hashing the caller's arbitrary order would
 *   manufacture a `409` for two requests that *are* the same request. A client
 *   retrying with its legs serialized in a different order (a different JSON
 *   library, a map iteration, a reordered form) must replay, not conflict.
 * - **Amounts as decimal strings** via `Money.format()`. `bigint` throws in
 *   `JSON.stringify`, and a JSON number reintroduces exactly the IEEE-754
 *   error ADR 0002 exists to prevent.
 * - **`reversesTransactionId`**, so reversing transaction A and reversing
 *   transaction B are never the same request.
 *
 * ### What stays out
 *
 * - **`idempotencyKey`** — it is the lookup key, so including it would make
 *   every hash trivially unique and defeat the comparison entirely.
 * - **`orgId`** — the key is already unique per org at the database level
 *   (`UNIQUE (org_id, key)`), so it cannot collide across tenants regardless.
 * - **`actorId`** — ADR 0004 speaks of "the same payload", and who submitted a
 *   request is not part of the payload. The consequence is deliberate and
 *   worth stating: two admins in the same org submitting the identical
 *   transaction with the same key will replay one result rather than conflict.
 *   Both are already `adminProcedure`-authorized within that tenant, so this
 *   grants no access neither of them had.
 */

interface HashableLeg {
  readonly accountId: string;
  readonly direction: string;
  /** Decimal string — never a `bigint`, never a JSON number. */
  readonly amount: string;
  readonly currency: string;
}

/**
 * Canonical JSON: keys emitted in a fixed order, no incidental whitespace.
 *
 * Hand-built rather than `JSON.stringify`'d over an object literal, because
 * `JSON.stringify` preserves *insertion* order — so a future refactor that
 * reordered two properties in the object literal below would silently change
 * every hash and invalidate every idempotency key already stored in the
 * database. Building the string explicitly makes that ordering a decision
 * rather than an accident.
 */
function canonicalize(legs: readonly HashableLeg[], reversesTransactionId: string | null): string {
  const parts = legs.map(
    (leg) =>
      `{"accountId":${JSON.stringify(leg.accountId)},` +
      `"amount":${JSON.stringify(leg.amount)},` +
      `"currency":${JSON.stringify(leg.currency)},` +
      `"direction":${JSON.stringify(leg.direction)}}`,
  );

  return `{"legs":[${parts.join(",")}],"reverses":${JSON.stringify(reversesTransactionId)}}`;
}

/** Total order over legs. Deterministic and total — no two distinct legs compare equal on all three fields without being identical. */
function compareLegs(a: HashableLeg, b: HashableLeg): number {
  return (
    a.accountId.localeCompare(b.accountId) ||
    a.direction.localeCompare(b.direction) ||
    a.amount.localeCompare(b.amount) ||
    a.currency.localeCompare(b.currency)
  );
}

/**
 * Computes the request hash for a validated `Transaction`.
 *
 * Takes the domain object, not the request body, so the hash is derived from
 * what the ledger will actually do rather than from how the caller happened to
 * phrase it.
 */
export function computeRequestHash(
  transaction: Transaction,
  reversesTransactionId: string | null = null,
): string {
  return createHash("sha256")
    .update(canonicalize(hashableLegs(transaction), reversesTransactionId), "utf8")
    .digest("hex");
}

function hashableLegs(transaction: Transaction): HashableLeg[] {
  return transaction.postings
    .map((posting) => ({
      accountId: posting.accountId,
      direction: posting.direction,
      amount: posting.amount.format(),
      currency: posting.amount.currency,
    }))
    .sort(compareLegs);
}

/**
 * The fingerprint for a cross-currency exchange, or for the pair of reversals
 * that unwinds one.
 *
 * Covers **both legs and the rate**. All three matter: retrying the identical
 * exchange must replay, while changing the rate — even with the same two
 * amounts, which a rounding band allows — is a different request and must
 * conflict rather than silently replay the earlier rate.
 *
 * Each leg's own legs are sorted by `canonicalize`'s rule, but the two *legs*
 * are kept in source-then-target order rather than sorted against each other:
 * the direction of an exchange is part of its identity, and USD→EUR must never
 * hash the same as EUR→USD.
 *
 * ### `reverses`
 *
 * Set to `[sourceId, targetId]` when the two transactions being posted are the
 * mirrors that unwind an existing exchange, which is what `transactions.reverse`
 * sends for an FX leg. It is not decoration: two *identical* exchanges — same
 * accounts, same amounts, same rate, posted twice — produce byte-identical
 * mirror legs, so without the ids in the payload, reversing pair A and then
 * reusing that key against pair B would hash the same, replay A's reversal, and
 * leave B un-reversed while the caller was told it succeeded. That is the same
 * failure `reversesTransactionId` is in the single-transaction hash to prevent
 * (ADR 0006); it simply could not arise here until an exchange could itself be
 * a reversal.
 *
 * **Omitted from the payload entirely when absent, never emitted as `null`.**
 * `request_hash` is persisted in `ledger_idempotency_key` and compared on every
 * retry, so adding a key to this object would re-derive every exchange hash
 * already in the database and turn honest retries against pre-existing keys
 * into false `409`s — the un-versioned canonical format ADR 0006 records as a
 * standing hazard. Plain exchanges must keep hashing to exactly what they
 * hashed to before this parameter existed.
 */
export function computeExchangeRequestHash(
  source: Transaction,
  target: Transaction,
  rate: string,
  reverses: readonly [string, string] | null = null,
): string {
  const payload = JSON.stringify({
    exchange: {
      source: hashableLegs(source),
      target: hashableLegs(target),
      rate,
      ...(reverses === null ? {} : { reverses }),
    },
  });

  return createHash("sha256").update(payload, "utf8").digest("hex");
}

import {
  err,
  Money,
  type InvalidAmount,
  type Result,
  type UnsupportedCurrency,
} from "@fintech-ledger-sandbox/core";
import { z } from "zod";

/**
 * How money crosses the API boundary.
 *
 * ADR 0002 chose `bigint` minor units for the domain precisely because
 * floating point cannot represent money exactly. That choice carries one
 * downstream obligation, recorded in the ADR's own Consequences: **`bigint`
 * does not serialize to JSON** — `JSON.stringify` throws on it. So the wire
 * format is a decimal *string* plus an explicit currency, never a JSON
 * number. A JSON number would reintroduce the exact IEEE-754 imprecision the
 * domain was designed to avoid, silently, at the last hop.
 *
 * `Money.format()` and `Money.parse()` are documented inverses in
 * `packages/core` ("`Money.parse(money.format(), currency)` round-trips"), so
 * this module is a thin adapter over them rather than a second formatting
 * implementation. Restating how a currency's exponent maps to decimal places
 * here would be exactly the drift ADR 0002 rejected.
 */

/**
 * Upper bound on an inbound decimal amount string.
 *
 * Closes a deferral recorded in Phase 2: `Money.parse` puts no length cap on
 * the string it hands to `BigInt(...)`, and `BigInt` parsing is superlinear
 * in digit count — a multi-megabyte numeric string is a cheap way to burn
 * server CPU. That was correctly *not* fixed in `packages/core`, which has no
 * notion of an untrusted request; it belongs here, at the boundary that does.
 * 30 characters comfortably exceeds any real amount (a 3-exponent currency
 * still leaves 26 integer digits, far past the sandbox's largest plausible
 * balance) while making the attack useless.
 */
export const MAX_DECIMAL_AMOUNT_LENGTH = 30;

/** The response shape for any monetary value. */
export const moneySchema = z.object({
  amount: z.string().describe("Decimal string, exact. Never a JSON number."),
  currency: z.string().describe("ISO-4217 code, e.g. \"USD\"."),
});

export type WireMoney = z.infer<typeof moneySchema>;

/**
 * The request-side schema for a decimal amount.
 *
 * Length-capped before `Money.parse` (and therefore before `BigInt`) ever
 * sees the value. Shape validation stays in `packages/core` — this
 * deliberately does not re-implement the decimal grammar, only bounds the
 * input's size so the domain's parser cannot be used as a CPU sink.
 *
 * Unused by Phase 4a's read-only surface; the write endpoints in 4b are its
 * first consumer. It ships here because this module is where the money
 * contract lives and the Phase 2 deferral is discharged by defining it.
 */
export const decimalAmountSchema = z
  .string()
  .min(1)
  .max(MAX_DECIMAL_AMOUNT_LENGTH, `Amount must be at most ${MAX_DECIMAL_AMOUNT_LENGTH} characters.`);

/**
 * The largest magnitude a minor-unit value can take and still be storable.
 *
 * `ledger_account.balance` and `ledger_posting.amount` are Postgres `bigint`
 * (int8), whose range is ±(2^63 − 1). `Money` itself is backed by a JavaScript
 * `bigint` and is happily unbounded, so `MAX_DECIMAL_AMOUNT_LENGTH` alone does
 * not protect the columns: a perfectly well-formed 30-character amount like
 * `"9".repeat(30)` parses into a 32-digit minor-unit value that no `int8`
 * column can hold. Postgres would reject the insert with `22003`
 * (numeric_value_out_of_range) — a raw driver error, so the caller would get an
 * unaudited 500 rather than a typed 422.
 *
 * The two bounds guard different things and both are needed: the length cap
 * bounds *parsing cost* before `BigInt` sees the string, this bounds
 * *storability* after it.
 */
export const MAX_MINOR_UNITS = 9_223_372_036_854_775_807n;

/**
 * Parses a decimal amount and rejects anything the ledger's columns cannot
 * store, as a typed error rather than a database fault.
 *
 * The out-of-range case is reported as `InvalidAmount` with reason
 * `"malformed-decimal"`. That reason is an imperfect fit — `packages/core`'s
 * `InvalidAmountReason` has no "out of range" member, and adding one is a
 * change to the domain package, which this phase deliberately does not touch.
 * The distinction is not client-visible: every `InvalidAmount` maps to the same
 * public `422 invalid_amount`.
 */
export function parseBoundedAmount(
  decimal: string,
  currency: string,
): Result<Money, UnsupportedCurrency | InvalidAmount> {
  const parsed = Money.parse(decimal, currency);
  if (!parsed.ok) {
    return parsed;
  }

  const magnitude = parsed.value.minorUnits < 0n ? -parsed.value.minorUnits : parsed.value.minorUnits;
  if (magnitude > MAX_MINOR_UNITS) {
    return err({ kind: "InvalidAmount", reason: "malformed-decimal", input: decimal });
  }

  return parsed;
}

/** Encodes a domain `Money` for transport. */
export function toWireMoney(money: Money): WireMoney {
  return { amount: money.format(), currency: money.currency };
}

/**
 * Encodes a raw persisted balance for transport.
 *
 * `packages/db`'s `LedgerAccountRow` exposes `balance` as a bare `bigint`
 * plus a separate `currency` string, while `LedgerPostingRow` exposes an
 * already-built `Money`. That inconsistency lives in the repository layer and
 * is out of scope to fix here (changing a repository return type is a
 * `packages/db` decision), so this absorbs it.
 *
 * Throws rather than returning a `Result`: the value came from a column the
 * domain already validated on the way in, so a failure means the row is
 * corrupt or was written outside the sanctioned write path. That is an
 * infrastructure bug, not a domain error a caller can act on — the same trust
 * boundary `packages/db/src/internal/money.ts` draws for the identical reason.
 */
export function toWireMoneyFromMinorUnits(minorUnits: bigint, currency: string): WireMoney {
  const result = Money.ofMinorUnits(minorUnits, currency);
  if (!result.ok) {
    throw new Error(`persisted balance ${minorUnits} in "${currency}" is not a representable amount`);
  }
  return toWireMoney(result.value);
}

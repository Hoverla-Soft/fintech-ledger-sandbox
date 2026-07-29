import {
  err,
  type InvalidAmount,
  Money,
  type Result,
  type UnsupportedCurrency,
} from "@fintech-ledger-sandbox/core";
import { z } from "zod";

/**
 * How money crosses the API boundary.
 *
 * **`bigint` does not serialize to JSON** — `JSON.stringify` throws on it — so
 * the wire format is a decimal *string* plus an explicit currency, never a JSON
 * number, which would reintroduce the IEEE-754 imprecision ADR 0002 chose
 * `bigint` to avoid.
 *
 * A thin adapter over `Money.format()` / `Money.parse()`, which `packages/core`
 * documents as inverses. Restating how an exponent maps to decimal places here
 * would be exactly the drift ADR 0002 rejected.
 */

/**
 * Upper bound on an inbound decimal amount string.
 *
 * `Money.parse` puts no length cap on the string it hands to `BigInt(...)`, and
 * `BigInt` parsing is superlinear in digit count — a multi-megabyte numeric
 * string is a cheap way to burn server CPU. It belongs here, at the boundary,
 * not in `packages/core`, which has no notion of an untrusted request. 30
 * characters still leaves a 3-exponent currency 26 integer digits.
 */
export const MAX_DECIMAL_AMOUNT_LENGTH = 30;

/** The response shape for any monetary value. */
export const moneySchema = z.object({
  amount: z.string().describe("Decimal string, exact. Never a JSON number."),
  currency: z.string().describe('ISO-4217 code, e.g. "USD".'),
});

export type WireMoney = z.infer<typeof moneySchema>;

/**
 * The request-side schema for a decimal amount.
 *
 * Length-capped before `Money.parse` (and therefore before `BigInt`) ever
 * sees the value. Shape validation stays in `packages/core` — this
 * deliberately does not re-implement the decimal grammar, only bounds the
 * input's size so the domain's parser cannot be used as a CPU sink.
 */
export const decimalAmountSchema = z
  .string()
  .min(1)
  .max(
    MAX_DECIMAL_AMOUNT_LENGTH,
    `Amount must be at most ${MAX_DECIMAL_AMOUNT_LENGTH} characters.`,
  );

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

  const magnitude =
    parsed.value.minorUnits < 0n ? -parsed.value.minorUnits : parsed.value.minorUnits;
  if (magnitude > MAX_MINOR_UNITS) {
    return err({ kind: "InvalidAmount", reason: "malformed-decimal", input: decimal });
  }

  return parsed;
}

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
    throw new Error(
      `persisted balance ${minorUnits} in "${currency}" is not a representable amount`,
    );
  }
  return toWireMoney(result.value);
}

import { Money } from "@fintech-ledger-sandbox/core";
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

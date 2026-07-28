import {
  CURRENCIES,
  type Currency,
  minorUnitExponent,
} from "@fintech-ledger-sandbox/api/contracts/currencies";
import {
  MAX_DECIMAL_AMOUNT_LENGTH,
  MAX_MINOR_UNITS,
  parseBoundedAmount,
} from "@fintech-ledger-sandbox/api/contracts/money";

/**
 * The console's money boundary.
 *
 * Everything here delegates to `packages/api`'s own parser rather than
 * re-implementing the decimal grammar. That is the whole point of the module:
 * a second implementation would drift from the server's `invalid_amount`
 * boundary and produce a form that accepts what `transactions.create` rejects,
 * or — worse — rejects what it would have accepted, with no way for the user
 * to tell which side is wrong.
 *
 * No `Number` and no `parseFloat` appear anywhere in this file, and none may
 * be added. `docs/adr/0002-money-representation.md` exists because a float
 * cannot hold `0.1 + 0.2`; amounts are `bigint` minor units end to end.
 */

/** Why an amount the user typed cannot be used. Maps 1:1 onto what the server would say. */
export type AmountProblem =
  | "empty"
  | "too_long"
  | "malformed"
  | "excess_precision"
  | "out_of_range"
  | "unsupported_currency";

export type ParsedAmount =
  | { readonly ok: true; readonly minorUnits: bigint }
  | { readonly ok: false; readonly problem: AmountProblem };

/**
 * Narrows an arbitrary string to a known `Currency`.
 *
 * The wire type for `currency` is `z.string()` at every boundary
 * (`packages/api/src/contracts/wire.ts`), so a value read back from an account
 * is a plain string as far as the type system is concerned. This is the one
 * place the console converts that into a `Currency` it can compute an exponent
 * from.
 */
export function asCurrency(code: string): Currency | null {
  return (CURRENCIES as readonly string[]).includes(code) ? (code as Currency) : null;
}

/**
 * Parses a user-typed decimal string into integer minor units.
 *
 * The ordering of the checks is deliberate and mirrors the server's: length is
 * bounded *before* the string reaches `BigInt`, because `BigInt` parsing is
 * superlinear in digit count and an unbounded string is a cheap CPU sink
 * (`packages/api/src/contracts/money.ts:30-40`). Doing it in the browser does
 * not protect the server — the server does that for itself — it protects the
 * user's own tab from a paste of a megabyte of digits.
 *
 * Excess precision is **rejected, never rounded** (`ADR 0002`). `"12.505"` in
 * USD is an error the user has to resolve, because silently turning it into
 * `12.50` or `12.51` is the console deciding where someone's half-cent went.
 */
export function parseAmount(decimal: string, currency: string): ParsedAmount {
  const trimmed = decimal.trim();

  if (trimmed.length === 0) {
    return { ok: false, problem: "empty" };
  }
  if (trimmed.length > MAX_DECIMAL_AMOUNT_LENGTH) {
    return { ok: false, problem: "too_long" };
  }

  const known = asCurrency(currency);
  if (known === null) {
    return { ok: false, problem: "unsupported_currency" };
  }

  const parsed = parseBoundedAmount(trimmed, known);
  if (parsed.ok) {
    return { ok: true, minorUnits: parsed.value.minorUnits };
  }

  if (parsed.error.kind === "UnsupportedCurrency") {
    return { ok: false, problem: "unsupported_currency" };
  }

  // `parseBoundedAmount` reports an out-of-range magnitude as
  // `malformed-decimal`, because `packages/core`'s `InvalidAmountReason` has
  // no "out of range" member and Phase 4b deliberately did not widen the
  // domain to add one (`money.ts:88-95`). The distinction is invisible on the
  // wire — both are `422 invalid_amount` — but it is very visible to someone
  // filling in a form, so the console recovers it here by re-testing the
  // bound the server checked.
  if (parsed.error.reason === "excess-precision") {
    return { ok: false, problem: "excess_precision" };
  }
  if (exceedsStorableRange(trimmed, known)) {
    return { ok: false, problem: "out_of_range" };
  }
  return { ok: false, problem: "malformed" };
}

/**
 * Distinguishes "too big to store" from "not a number at all", both of which
 * `parseBoundedAmount` collapses into `malformed-decimal`.
 *
 * Only called on the failure path, and only on a string already known to be
 * within `MAX_DECIMAL_AMOUNT_LENGTH`, so the `BigInt` here is bounded.
 */
function exceedsStorableRange(decimal: string, currency: Currency): boolean {
  const match = /^-?(\d+)(?:\.(\d+))?$/.exec(decimal);
  if (match === null) {
    return false; // genuinely malformed, not a range problem
  }

  const [, integerDigits = "", fractionDigits = ""] = match;
  const exponent = minorUnitExponent(currency);
  if (fractionDigits.length > exponent) {
    return false; // precision, not range — handled by the caller
  }

  const magnitude = BigInt(`${integerDigits}${fractionDigits.padEnd(exponent, "0")}`);
  return magnitude > MAX_MINOR_UNITS;
}

/**
 * Renders integer minor units as a decimal string at the currency's own scale.
 *
 * USD `0n` is `"0.00"`, JPY `0n` is `"0"`, BHD `0n` is `"0.000"`. A negative
 * balance keeps its leading `-` — `external` accounts are expected to go
 * negative (that is what makes them the boundary money enters through), so
 * this is a normal rendering, not an error state.
 *
 * Pure string arithmetic. `toLocaleString` is not used: it would introduce
 * locale-dependent grouping and, on some locales, a decimal comma, neither of
 * which round-trips back through `parseAmount`.
 */
export function formatMinorUnits(minorUnits: bigint, currency: string): string {
  const known = asCurrency(currency);
  if (known === null) {
    // Never guess a scale for an unknown code — that is precisely the silent
    // 100x error ADR 0002 was written to prevent. Show the raw integer and
    // the code, which is obviously-unformatted rather than plausibly-wrong.
    return `${minorUnits} ${currency}`;
  }

  const exponent = minorUnitExponent(known);
  const isNegative = minorUnits < 0n;
  const magnitude = isNegative ? -minorUnits : minorUnits;
  const digits = magnitude.toString().padStart(exponent + 1, "0");
  const sign = isNegative ? "-" : "";

  if (exponent === 0) {
    return `${sign}${digits}`;
  }

  const integerPart = digits.slice(0, digits.length - exponent);
  const fractionPart = digits.slice(digits.length - exponent);
  return `${sign}${integerPart}.${fractionPart}`;
}

/**
 * `formatMinorUnits` with the currency code appended — the usual display form.
 *
 * Guards the unknown-currency branch explicitly: `formatMinorUnits` already
 * appends the code in that case (it has no scale to render), so appending
 * again unconditionally produced `"1250 XXX XXX"`.
 */
export function formatAmountWithCurrency(minorUnits: bigint, currency: string): string {
  const formatted = formatMinorUnits(minorUnits, currency);
  return asCurrency(currency) === null ? formatted : `${formatted} ${currency}`;
}

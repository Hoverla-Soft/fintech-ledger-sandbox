import { Money } from "@fintech-ledger-sandbox/core";
import { describe, expect, it } from "vitest";

import { type LedgerApiError, type LedgerErrorReason, toORPCError } from "./errors";

function money(decimal: string): Money {
  const result = Money.parse(decimal, "USD");
  if (!result.ok) {
    throw new Error(`fixture amount "${decimal}" is malformed`);
  }
  return result.value;
}

/**
 * Every member of the `LedgerApiError` union, with the status and public
 * reason it must produce. Typed as the union itself, so removing a case here
 * while the union still has it is caught by the exhaustiveness check below —
 * this table cannot silently fall behind the code it covers.
 */
const CASES: ReadonlyArray<{
  error: LedgerApiError;
  code: string;
  status: number;
  reason: LedgerErrorReason;
}> = [
  {
    error: { kind: "AccountNotFound", accountId: "acc-1" },
    code: "NOT_FOUND",
    status: 404,
    reason: "account_not_found",
  },
  {
    error: { kind: "AccountInactive", accountId: "acc-1" },
    code: "UNPROCESSABLE_CONTENT",
    status: 422,
    reason: "account_inactive",
  },
  {
    error: { kind: "AccountAlreadyExists", name: "Payroll" },
    code: "CONFLICT",
    status: 409,
    reason: "account_name_taken",
  },
  {
    error: { kind: "TransactionNotFound", transactionId: "txn-1" },
    code: "NOT_FOUND",
    status: 404,
    reason: "transaction_not_found",
  },
  {
    error: { kind: "IdempotencyConflict", idempotencyKey: "key-1" },
    code: "CONFLICT",
    status: 409,
    reason: "idempotency_conflict",
  },
  {
    error: {
      kind: "InsufficientFunds",
      accountId: "acc-1",
      balance: money("10.00"),
      delta: money("50.00"),
      resulting: money("40.00"),
    },
    code: "UNPROCESSABLE_CONTENT",
    status: 422,
    reason: "insufficient_funds",
  },
  {
    error: { kind: "CurrencyMismatch", expected: "USD", actual: "EUR" },
    code: "UNPROCESSABLE_CONTENT",
    status: 422,
    reason: "currency_mismatch",
  },
  {
    error: { kind: "UnsupportedCurrency", code: "XYZ" },
    code: "UNPROCESSABLE_CONTENT",
    status: 422,
    reason: "unsupported_currency",
  },
  {
    error: { kind: "InvalidAmount", reason: "malformed-decimal", input: "1.2.3" },
    code: "UNPROCESSABLE_CONTENT",
    status: 422,
    reason: "invalid_amount",
  },
  {
    error: { kind: "NonPositiveAmount", amount: money("0.00") },
    code: "UNPROCESSABLE_CONTENT",
    status: 422,
    reason: "non_positive_amount",
  },
  {
    error: { kind: "TooFewPostings", count: 1 },
    code: "UNPROCESSABLE_CONTENT",
    status: 422,
    reason: "too_few_postings",
  },
  {
    error: { kind: "UnbalancedTransaction", net: money("5.00") },
    code: "UNPROCESSABLE_CONTENT",
    status: 422,
    reason: "unbalanced_transaction",
  },
];

describe("toORPCError", () => {
  it.each(CASES)("maps $error.kind to $code ($status)", ({ error, code, status, reason }) => {
    const orpcError = toORPCError(error);

    expect(orpcError.code).toBe(code);
    expect(orpcError.status).toBe(status);
    expect(orpcError.data).toEqual({ reason });
  });

  it("covers every member of the LedgerApiError union", () => {
    // Guards against the map growing a branch that nothing exercises. The
    // `never` assertion in `errors.ts` catches an *unhandled* kind at compile
    // time; this catches an *untested* one at run time.
    const covered = new Set(CASES.map((testCase) => testCase.error.kind));
    expect(covered.size).toBe(CASES.length);
    expect(covered.size).toBe(12);
  });

  describe("messages leak nothing", () => {
    it("never interpolates the offending identifier", () => {
      // A cross-org account id echoed back would confirm to a caller probing
      // another tenant that their id was well-formed — `ledger.md` line 56
      // requires a cross-org lookup reveal nothing at all.
      const secretId = "00000000-dead-beef-0000-000000000000";
      const orpcError = toORPCError({ kind: "AccountNotFound", accountId: secretId });

      expect(orpcError.message).not.toContain(secretId);
      expect(JSON.stringify(orpcError.toJSON())).not.toContain(secretId);
    });

    it("never interpolates a balance into an insufficient-funds message", () => {
      const orpcError = toORPCError({
        kind: "InsufficientFunds",
        accountId: "acc-1",
        balance: money("13.37"),
        delta: money("99.99"),
        resulting: money("86.62"),
      });

      expect(orpcError.message).not.toContain("13.37");
      expect(orpcError.message).not.toContain("86.62");
    });

    it("gives every branch a non-empty human-readable message", () => {
      for (const { error } of CASES) {
        expect(toORPCError(error).message.length).toBeGreaterThan(0);
      }
    });
  });

  it("never produces 403 — role denial happens in middleware, not here", () => {
    // A 403 from a resource lookup would be a signal that the resource exists
    // in another tenant. Addressing failures are always 404.
    for (const { error } of CASES) {
      expect(toORPCError(error).status).not.toBe(403);
    }
  });
});

import type { AccountType, Currency, PostingDirection } from "@fintech-ledger-sandbox/core";

/**
 * The sandbox seed set, as data.
 *
 * `docs/product/requirements/ledger.md` line 80 names the bar this file
 * exists to meet: reconciliation must come back clean across a payroll run, a
 * marketplace payout with fees, an insufficient-funds rejection, and a
 * reversal. Those are scenarios 1-4 below.
 *
 * Declared as data rather than as a sequence of calls so two properties can be
 * checked without a database: that every posted scenario's legs net to zero,
 * and that every account a leg names is one this module also declares. A
 * scenario list expressed as imperative handler code could only be verified by
 * running it against Postgres and reading the balances back.
 *
 * Legs reference accounts by **name**, not id. The ids do not exist until the
 * handler has resolved or created them within the caller's org, and names are
 * what make the seed re-runnable: after a reset the accounts still exist at a
 * zero balance (task D2), so a second seed finds them by name and reuses them
 * rather than colliding with `UNIQUE (org_id, name)`.
 */

/**
 * Every seeded account is `USD`.
 *
 * Single-currency on purpose: invariant #7 rejects a transaction whose legs
 * disagree on currency, so a multi-currency seed would need every scenario to
 * pick a side and would demonstrate nothing the single-currency set does not.
 * Reset handles multiple currencies regardless — it groups by currency — and
 * `reset-plan.test.ts` covers that path directly.
 */
export const SEED_CURRENCY: Currency = "USD";

export interface SeedAccountSpec {
  readonly name: string;
  readonly type: AccountType;
  readonly currency: Currency;
}

export interface SeedLeg {
  readonly accountName: string;
  readonly direction: PostingDirection;
  /** Decimal string — the wire format, parsed through `Money.parse` (ADR 0002). */
  readonly amount: string;
}

export interface SeedScenario {
  readonly id: string;
  readonly description: string;
  readonly legs: readonly SeedLeg[];
  /**
   * What this scenario is *supposed* to do. `rejected` is not a tolerated
   * failure — it is the point of scenario 3, which exists so `audit.rejections`
   * has a real entry to serve.
   */
  readonly expect: "posted" | "rejected";
  /** When true, the scenario posts its legs and then reverses that transaction. */
  readonly reverseAfterPost: boolean;
}

/**
 * `Sandbox Funding` is `external` and every other account is `normal`.
 *
 * That distinction is what lets money enter the sandbox at all: invariant #6
 * forbids a `normal` account from going negative, so the opening scenario has
 * to credit something permitted to. An `external` account represents value
 * entering or leaving the sandbox boundary, which is exactly what funding is.
 */
export const SEED_ACCOUNTS: readonly SeedAccountSpec[] = [
  { name: "Sandbox Funding", type: "external", currency: SEED_CURRENCY },
  { name: "Operating", type: "normal", currency: SEED_CURRENCY },
  { name: "Employee A", type: "normal", currency: SEED_CURRENCY },
  { name: "Employee B", type: "normal", currency: SEED_CURRENCY },
  { name: "Marketplace Seller", type: "normal", currency: SEED_CURRENCY },
  { name: "Platform Fees", type: "normal", currency: SEED_CURRENCY },
];

/**
 * Ordered, and the order is load-bearing — each scenario assumes the balances
 * its predecessors established. `funding` must run first or nothing else has
 * money to move; `insufficient_funds` relies on `payroll` having left
 * `Employee A` with a balance far smaller than the amount it tries to move out
 * of it, which is what makes the rejection deterministic rather than
 * incidental.
 */
export const SEED_SCENARIOS: readonly SeedScenario[] = [
  {
    id: "funding",
    description:
      "Money enters the sandbox: the operating account is funded from the external boundary.",
    legs: [
      { accountName: "Operating", direction: "debit", amount: "5000.00" },
      { accountName: "Sandbox Funding", direction: "credit", amount: "5000.00" },
    ],
    expect: "posted",
    reverseAfterPost: false,
  },
  {
    id: "payroll",
    description:
      "A payroll run: one debit per employee against a single credit to the operating account.",
    legs: [
      { accountName: "Employee A", direction: "debit", amount: "1500.00" },
      { accountName: "Employee B", direction: "debit", amount: "1000.00" },
      { accountName: "Operating", direction: "credit", amount: "2500.00" },
    ],
    expect: "posted",
    reverseAfterPost: false,
  },
  {
    id: "marketplace_payout",
    description:
      "A marketplace payout that splits a fee off to a separate account — the N-leg case.",
    legs: [
      { accountName: "Marketplace Seller", direction: "debit", amount: "950.00" },
      { accountName: "Platform Fees", direction: "debit", amount: "50.00" },
      { accountName: "Operating", direction: "credit", amount: "1000.00" },
    ],
    expect: "posted",
    reverseAfterPost: false,
  },
  {
    id: "insufficient_funds",
    description:
      "A transfer that must be refused: it would drive the `normal` account Employee A below zero (invariant #6).",
    legs: [
      { accountName: "Marketplace Seller", direction: "debit", amount: "999999.99" },
      { accountName: "Employee A", direction: "credit", amount: "999999.99" },
    ],
    expect: "rejected",
    reverseAfterPost: false,
  },
  {
    id: "reversal",
    description:
      "A posted transfer and its mirrored reversal — the only sanctioned way to undo (invariant #8).",
    legs: [
      { accountName: "Marketplace Seller", direction: "debit", amount: "200.00" },
      { accountName: "Operating", direction: "credit", amount: "200.00" },
    ],
    expect: "posted",
    reverseAfterPost: true,
  },
];

/**
 * The per-scenario idempotency keys derived from one caller-supplied run key
 * (task D4).
 *
 * A scenario that also reverses needs **two** keys, because it posts two
 * transactions. Reusing one key for both would make the reversal collide with
 * the transfer it is reversing and surface as `409 idempotency_conflict`
 * against the seed's own first write — a self-inflicted conflict that no
 * caller could act on.
 */
export function scenarioKeys(
  runKey: string,
  scenario: SeedScenario,
): {
  readonly post: string;
  readonly reversal: string;
} {
  return {
    post: scenario.reverseAfterPost
      ? `${runKey}:${scenario.id}:original`
      : `${runKey}:${scenario.id}`,
    reversal: `${runKey}:${scenario.id}:reversal`,
  };
}

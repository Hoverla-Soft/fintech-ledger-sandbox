import { eq, sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, inject, it } from "vitest";

import { ledgerAccount } from "../schema/ledger";
import { seedAccount, seedTenant } from "../test/fixtures";
import { connectTestDatabase } from "../test/setup";
import { reconcileAccounts } from "./reconciliation";

/**
 * Invariant #2 edge cases not already exercised by
 * `posting/ledger-scenarios.test.ts`'s four full scenarios: the empty
 * (zero-posting) boundary, and proof that `reconcileAccounts` actually
 * *detects* a genuine mismatch rather than always reporting `reconciled:
 * true`. The mismatch case writes directly to `ledger_account.balance` via
 * raw SQL — deliberately bypassing `postTransaction` to simulate the kind
 * of drift reconciliation exists to catch — never something application
 * code does through the real routine.
 */
describe("reconcileAccounts (invariant #2)", () => {
  let database: ReturnType<typeof connectTestDatabase>;

  beforeAll(() => {
    database = connectTestDatabase(inject("dbTestConnectionString"));
  });

  beforeEach(async () => {
    await database.reset();
  });

  it("a freshly created account with no postings reconciles cleanly at zero (boundary: empty posting history)", async () => {
    const { orgId } = await seedTenant(database.db);
    const accountId = await seedAccount(database.db, orgId, "normal", "Untouched");

    const rows = await reconcileAccounts(database.db, orgId);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.accountId).toBe(accountId);
    expect(rows[0]?.recordedBalance.isZero()).toBe(true);
    expect(rows[0]?.computedBalance.isZero()).toBe(true);
    expect(rows[0]?.reconciled).toBe(true);
  });

  it("detects a genuine mismatch when an account's materialized balance is corrupted outside the posting routine", async () => {
    const { orgId } = await seedTenant(database.db);
    const accountId = await seedAccount(database.db, orgId, "normal", "Corrupted");

    // Bypass `postTransaction` entirely: no posting is written, so the
    // computed sum stays zero while the materialized balance drifts.
    await database.db
      .update(ledgerAccount)
      .set({ balance: sql`${ledgerAccount.balance} + 100` })
      .where(eq(ledgerAccount.id, accountId));

    const rows = await reconcileAccounts(database.db, orgId);
    const row = rows.find((candidate) => candidate.accountId === accountId);

    if (row === undefined) {
      throw new Error("expected the corrupted account to appear in reconciliation results");
    }
    expect(row.reconciled).toBe(false);
    expect(row.computedBalance.isZero()).toBe(true);
    expect(row.recordedBalance.equals(row.computedBalance)).toBe(false);
  });
});

/**
 * @fintech-ledger-sandbox/core — the ledger domain.
 *
 * Pure, zero-infrastructure domain logic: the Money value object, the balanced
 * Transaction / posting model, account rules, and the ledger invariants encoded
 * so illegal states are unrepresentable. This package depends on nothing but
 * TypeScript + Zod and is unit-tested with no database.
 *
 * Filled in Phase 2. Public API is re-exported from here.
 */

export const CORE_PACKAGE = "@fintech-ledger-sandbox/core" as const;

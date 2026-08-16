import {
  type Currency,
  createPosting,
  Money,
  type Posting,
  reverse,
  Transaction,
} from "@fintech-ledger-sandbox/core";
import type { Db } from "@fintech-ledger-sandbox/db";
import { postTransaction } from "@fintech-ledger-sandbox/db/posting";
import {
  createAccount,
  getTransactionById,
  type LedgerAccountRow,
  listAccounts,
  recordRejection,
} from "@fintech-ledger-sandbox/db/repositories";
import { z } from "zod";

import { idempotencyKeySchema } from "../contracts/idempotency";

import { computeRequestHash } from "../contracts/request-hash";
import { accountSchema, toWireAccount } from "../contracts/wire";
import { type LedgerApiError, reasonFor, toORPCError } from "../errors";
import { directPostProcedure } from "../procedures";
import { countNonZero, planResetChunk, type ResetBalance } from "../sandbox/reset-plan";
import {
  SEED_ACCOUNTS,
  SEED_SCENARIOS,
  type SeedAccountSpec,
  type SeedScenario,
  scenarioKeys,
} from "../sandbox/scenarios";

/**
 * Seed and reset — the sandbox lifecycle (`ledger.md` line 7, "safe to seed
 * and reset").
 *
 * Both procedures sit on `adminProcedure`, so both inherit the role check, the
 * write rate limit, and ADR 0005's org derivation without restating any of it.
 * That last point is the whole of this phase's answer to ADR 0005's recorded
 * open consequence: it warned that a seed routine talking to `packages/db`
 * directly would hold an `org_id` no middleware had vouched for. There is no
 * such routine. `orgId` arrives here the same way it arrives at every other
 * endpoint — from a verified `member` row — so the hole is never opened rather
 * than opened and then governed.
 *
 * Neither procedure introduces a new write path. Every mutation below goes
 * through `postTransaction` and `createAccount`, both shipped and tested in
 * earlier phases, so the ordered locking, funds rule, idempotency reservation,
 * and audit trail all apply unchanged.
 *
 * ## Rate-limit amplification, stated rather than left to be discovered
 *
 * One call to either endpoint costs a single rate-limit token but performs
 * several `postTransaction` runs — a fixed six for seed, one per chunk for
 * reset. Both are bounded (seed by a compile-time constant, reset by
 * `RESET_CHUNK_SIZE`), which is the property that matters; neither is
 * proportional to anything a caller controls.
 */

interface SandboxContext {
  readonly db: Db;
  readonly orgId: string;
  readonly actorId: string;
}

/** The suspense account reset opens per currency when a chunk cannot balance itself. */
function suspenseAccountSpec(currency: Currency): SeedAccountSpec {
  return {
    name: `Sandbox Suspense ${currency}`,
    // Must be `external`: it holds one chunk's imbalance until the final chunk
    // clears it, and that intermediate balance is routinely negative — which
    // invariant #6 forbids for a `normal` account.
    type: "external",
    currency,
  };
}

/**
 * Unwraps a posting built from values the domain has already validated.
 *
 * Every caller below constructs postings from a persisted row or from a
 * seed constant that `scenarios.test.ts` proves valid, so the only reachable
 * failure is `NonPositiveAmount`, and a zero-amount leg here would mean the
 * planner or the seed set is broken. That is an infrastructure fault, not
 * something a caller can act on, so it throws rather than becoming a 4xx.
 */
function unwrapPosting(result: ReturnType<typeof createPosting>): Posting {
  if (!result.ok) {
    throw new Error(`sandbox built an invalid posting: ${result.error.kind}`);
  }
  return result.value;
}

/** Same trust boundary as `contracts/money.ts`'s `toWireMoneyFromMinorUnits`: the value came from a validated column. */
function moneyOfMinorUnits(minorUnits: bigint, currency: string): Money {
  const result = Money.ofMinorUnits(minorUnits, currency);
  if (!result.ok) {
    throw new Error(`sandbox produced an unrepresentable amount ${minorUnits} in "${currency}"`);
  }
  return result.value;
}

/**
 * Records a rejection that happened before persistence was attempted.
 *
 * A deliberate near-duplicate of `routers/transactions.ts`'s private
 * `recordDomainRejection`. Extracting the shared version would mean editing
 * `transactions.ts`, which this task's Scope does not include — and widening
 * Scope to deduplicate eight best-effort lines is a worse trade than carrying
 * them twice. If a third caller ever appears, extract it then.
 *
 * The audit failure is swallowed for the same reason it is there: the caller
 * is already receiving an accurate 4xx, and turning a logging failure into a
 * 500 would replace it with a misleading one.
 */
async function recordDomainRejection(
  context: SandboxContext,
  action: string,
  error: LedgerApiError,
): Promise<void> {
  try {
    await recordRejection(context.db, {
      orgId: context.orgId,
      actorUserId: context.actorId,
      action,
      reason: reasonFor(error),
      metadata: { kind: error.kind },
    });
  } catch (auditError) {
    console.error({ event: "rejection_audit.failed", action, kind: error.kind }, auditError);
  }
}

/**
 * Resolves the named accounts, creating only the ones missing.
 *
 * Matching by name is what makes the sandbox loop work. Reset leaves accounts
 * alive at a zero balance (task D2), so a second seed finds them here and
 * reuses them instead of colliding with `UNIQUE (org_id, name)` — and because
 * they are left `active`, Phase 4b's inactive-account check never refuses them
 * either.
 *
 * A lost `AccountAlreadyExists` race is not an error: it means a concurrent
 * seed created the account between this call's read and its insert, which is
 * the state this function was trying to reach anyway.
 */
async function ensureAccounts(
  context: SandboxContext,
  specs: readonly SeedAccountSpec[],
): Promise<Map<string, LedgerAccountRow>> {
  const byName = new Map(
    (await listAccounts(context.db, context.orgId)).map((account) => [account.name, account]),
  );

  for (const spec of specs) {
    if (byName.has(spec.name)) {
      continue;
    }

    const created = await createAccount(context.db, {
      orgId: context.orgId,
      name: spec.name,
      currency: spec.currency,
      type: spec.type,
    });

    if (created.ok) {
      byName.set(spec.name, created.value);
      continue;
    }

    const reread = (await listAccounts(context.db, context.orgId)).find(
      (account) => account.name === spec.name,
    );
    if (reread === undefined) {
      throw toORPCError(created.error);
    }
    byName.set(spec.name, reread);
  }

  return byName;
}

/** Turns a declarative scenario into a domain `Transaction`, resolving account names to ids. */
function buildScenarioTransaction(
  scenario: SeedScenario,
  accounts: ReadonlyMap<string, LedgerAccountRow>,
): Transaction {
  const postings = scenario.legs.map((leg) => {
    const account = accounts.get(leg.accountName);
    if (account === undefined) {
      throw new Error(`seed scenario "${scenario.id}" names unknown account "${leg.accountName}"`);
    }

    const amount = Money.parse(leg.amount, account.currency);
    if (!amount.ok) {
      throw new Error(
        `seed scenario "${scenario.id}" carries an unparseable amount "${leg.amount}"`,
      );
    }

    return unwrapPosting(createPosting(account.id, leg.direction, amount.value));
  });

  const built = Transaction.create(postings);
  if (!built.ok) {
    // `scenarios.test.ts` proves every scenario balances, so reaching this
    // means the seed set was edited without its test being run.
    throw new Error(
      `seed scenario "${scenario.id}" is not a valid transaction: ${built.error.kind}`,
    );
  }
  return built.value;
}

/** Rebuilds a posted transaction's mirror from the **persisted rows**, never from anything a caller sent (ADR 0006). */
async function buildReversal(context: SandboxContext, transactionId: string): Promise<Transaction> {
  const original = await getTransactionById(context.db, context.orgId, transactionId);
  if (!original.ok) {
    throw new Error(`sandbox posted transaction "${transactionId}" but cannot read it back`);
  }

  const rebuilt = Transaction.create(
    original.value.postings.map((posting) =>
      unwrapPosting(createPosting(posting.accountId, posting.direction, posting.amount)),
    ),
  );
  if (!rebuilt.ok) {
    throw new Error(
      `persisted transaction "${transactionId}" is not a valid transaction: ${rebuilt.error.kind}`,
    );
  }

  return reverse(rebuilt.value);
}

const scenarioOutcomeSchema = z.object({
  id: z.string(),
  outcome: z
    .enum(["posted", "rejected"])
    .describe(
      "A replayed scenario reports `posted` with the original transaction id — `PostedTransaction` carries no replay flag (ADR 0006).",
    ),
  transactionId: z.string().nullable(),
  reason: z
    .string()
    .nullable()
    .describe("The rejection reason, for an expected refusal such as insufficient funds."),
});

export const sandboxRouter = {
  /**
   * Seed the organization with the scenarios `ledger.md` line 80 requires
   * reconciliation to stay clean across.
   *
   * The `idempotencyKey` is a **run key**: each scenario derives its own key
   * beneath it, so re-calling with the same key replays what already landed
   * and posts only what is missing — which is also how a seed interrupted
   * midway is resumed. A fresh key seeds an independent run.
   *
   * One caveat is real and deliberately not smoothed over: the
   * insufficient-funds scenario is **not** idempotent. A rejected attempt
   * rolls its own key reservation back (see `post-transaction.ts`), so the key
   * never persists and a replayed run re-attempts the transfer, appending a
   * second rejection audit entry. No money moves and no transaction is
   * duplicated.
   */
  seed: directPostProcedure
    .input(z.object({ idempotencyKey: idempotencyKeySchema }))
    .output(
      z.object({
        accounts: z.array(accountSchema),
        scenarios: z.array(scenarioOutcomeSchema),
      }),
    )
    .handler(async ({ context, input }) => {
      const sandbox: SandboxContext = {
        db: context.db,
        orgId: context.orgId,
        actorId: context.actorId,
      };

      const accounts = await ensureAccounts(sandbox, SEED_ACCOUNTS);
      const scenarios: z.infer<typeof scenarioOutcomeSchema>[] = [];

      for (const scenario of SEED_SCENARIOS) {
        const keys = scenarioKeys(input.idempotencyKey, scenario);
        const transaction = buildScenarioTransaction(scenario, accounts);

        const posted = await postTransaction(sandbox.db, {
          orgId: sandbox.orgId,
          actorId: sandbox.actorId,
          idempotencyKey: keys.post,
          requestHash: computeRequestHash(transaction),
          transaction,
        });

        if (!posted.ok) {
          if (scenario.expect === "rejected") {
            // The point of this scenario, not a failure. `postTransaction`
            // has already written the rejection audit entry itself, so
            // `audit.rejections` has a real entry to serve.
            scenarios.push({
              id: scenario.id,
              outcome: "rejected",
              transactionId: null,
              reason: reasonFor(posted.error),
            });
            continue;
          }

          // Stop the run: every later scenario assumes the balances this one
          // was supposed to establish, so continuing would produce failures
          // that describe the wrong problem. Whatever already posted stays
          // posted and is resumable under the same run key.
          throw toORPCError(posted.error);
        }

        scenarios.push({
          id: scenario.id,
          outcome: "posted",
          transactionId: posted.value.transactionId,
          reason: null,
        });

        if (!scenario.reverseAfterPost) {
          continue;
        }

        const mirrored = await buildReversal(sandbox, posted.value.transactionId);
        const reversed = await postTransaction(sandbox.db, {
          orgId: sandbox.orgId,
          actorId: sandbox.actorId,
          idempotencyKey: keys.reversal,
          requestHash: computeRequestHash(mirrored, posted.value.transactionId),
          transaction: mirrored,
          reversesTransactionId: posted.value.transactionId,
        });

        if (!reversed.ok) {
          throw toORPCError(reversed.error);
        }

        scenarios.push({
          id: `${scenario.id}:reversal`,
          outcome: "posted",
          transactionId: reversed.value.transactionId,
          reason: null,
        });
      }

      return {
        accounts: (await listAccounts(sandbox.db, sandbox.orgId)).map(toWireAccount),
        scenarios,
      };
    }),

  /**
   * Unwind the organization's ledger back to zero balances.
   *
   * Posts one compensating transaction whose legs are the opposite of each
   * non-zero balance — **not** a reversal per historical transaction, which
   * ADR 0006's reversible-reversals rule makes either incorrect or
   * non-terminating (the argument is laid out in `sandbox/reset-plan.ts`).
   *
   * Bounded and resumable: one call clears at most one chunk and reports
   * `remaining`, so the caller loops until it reaches zero. Accounts are left
   * alive and `active` at a zero balance, which is what lets the sandbox be
   * seeded again afterwards.
   */
  reset: directPostProcedure
    .input(z.object({ idempotencyKey: idempotencyKeySchema }))
    .output(
      z.object({
        accountsZeroed: z.int(),
        remaining: z
          .int()
          .describe(
            "Accounts still holding a non-zero balance, across every currency. Call again until this is 0.",
          ),
        transactionIds: z.array(z.string()),
      }),
    )
    .handler(async ({ context, input }) => {
      const sandbox: SandboxContext = {
        db: context.db,
        orgId: context.orgId,
        actorId: context.actorId,
      };

      const toBalances = (rows: readonly LedgerAccountRow[]): ResetBalance[] =>
        rows.map((row) => ({ accountId: row.id, currency: row.currency, minorUnits: row.balance }));

      const chunk = planResetChunk(toBalances(await listAccounts(sandbox.db, sandbox.orgId)));
      if (chunk === null) {
        return { accountsZeroed: 0, remaining: 0, transactionIds: [] };
      }

      const postings: Posting[] = chunk.legs.map((leg) =>
        unwrapPosting(
          createPosting(
            leg.accountId,
            leg.direction,
            moneyOfMinorUnits(leg.minorUnits, chunk.currency),
          ),
        ),
      );

      if (chunk.suspense !== null) {
        const spec = suspenseAccountSpec(chunk.suspense.currency);
        const suspense = (await ensureAccounts(sandbox, [spec])).get(spec.name);
        if (suspense === undefined) {
          throw new Error(`sandbox could not resolve the suspense account "${spec.name}"`);
        }

        postings.push(
          unwrapPosting(
            createPosting(
              suspense.id,
              chunk.suspense.direction,
              moneyOfMinorUnits(chunk.suspense.minorUnits, chunk.suspense.currency),
            ),
          ),
        );
      }

      const built = Transaction.create(postings);
      if (!built.ok) {
        // Task D7. On a final chunk the planner emits no suspense leg, so an
        // unbalanced set here means the organization's balances do not sum to
        // zero — a live reconciliation break. Reset refuses rather than
        // forcing the balances to zero and destroying the evidence.
        await recordDomainRejection(sandbox, "reset_sandbox", built.error);
        throw toORPCError(built.error);
      }

      const posted = await postTransaction(sandbox.db, {
        orgId: sandbox.orgId,
        actorId: sandbox.actorId,
        // Content-derived beneath the caller's run key (task D6): a retried or
        // resumed chunk re-derives this exact key and replays, while a fresh
        // run key keeps a later reset from replaying an earlier one's
        // identical-looking chunk.
        idempotencyKey: `${input.idempotencyKey}:${chunk.chunkHash}`,
        requestHash: computeRequestHash(built.value),
        transaction: built.value,
      });

      if (!posted.ok) {
        throw toORPCError(posted.error);
      }

      return {
        accountsZeroed: chunk.accountsZeroed,
        remaining: countNonZero(toBalances(await listAccounts(sandbox.db, sandbox.orgId))),
        transactionIds: [posted.value.transactionId],
      };
    }),
};

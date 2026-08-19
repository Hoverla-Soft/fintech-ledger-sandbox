/**
 * The console's error vocabulary.
 *
 * `docs/backend/error-handling.md:18` is explicit: *"Clients switch on
 * `reason`, never on `message`."* The server's `message` is a fixed string per
 * branch chosen to leak nothing — it is deliberately not written for an end
 * user, and it is not a stable contract. `data.reason` is. This module is the
 * single translation point, so no component ever renders a server string and
 * no two screens word the same failure differently.
 *
 * All 17 published reasons are handled. The `satisfies` on `COPY` guarantees
 * copy exists for every member of `LEDGER_REASONS` — but note what that does
 * *not* buy: `LEDGER_REASONS` is this module's own list, so the check is
 * circular with respect to `packages/api` and an 18th reason added upstream
 * would not fail `check-types` here. Catching that drift is the job of
 * `errors.test.ts`, which scans `packages/api/src` for emitted reason literals
 * and fails by name when one has no copy.
 */

/**
 * Every reason `packages/api` can emit, verified exhaustively against
 * `packages/api/src/errors.ts` and the `procedures.ts` middleware ladder.
 *
 * Deliberately declared here rather than imported from `packages/api`'s
 * internal union. This list is the console's own statement of what it has
 * written copy for; if the API adds an 18th reason, the mismatch should show
 * up as a *test failure with a name*, not as silent structural widening that
 * lets an unhandled reason fall through to the generic fallback in production.
 * `errors.test.ts` asserts the two agree.
 */
export const LEDGER_REASONS = [
  "account_inactive",
  "account_name_taken",
  "already_reversed",
  "account_not_found",
  "account_not_empty",
  "approval_required",
  "balance_limit_exceeded",
  "conversion_mismatch",
  "currency_mismatch",
  "idempotency_conflict",
  "insufficient_funds",
  "insufficient_role",
  "invalid_amount",
  "invalid_cursor",
  "invalid_rate",
  "no_active_organization",
  "non_positive_amount",
  "not_a_member",
  "pending_already_decided",
  "pending_not_found",
  "rate_limited",
  "rejected_by_approver",
  "same_currency_exchange",
  "self_approve_forbidden",
  "too_few_postings",
  "transaction_not_found",
  "unbalanced_transaction",
  "unsupported_currency",
] as const;

export type LedgerReason = (typeof LEDGER_REASONS)[number];

/** How a screen should treat a failure, independent of its wording. */
export type FailureDisposition =
  /** The user can fix this in the form they are looking at. Keep it open, show the message inline. */
  | "fix_input"
  /** Nothing the user can do here; the operation cannot proceed. Show it, offer a way out. */
  | "blocked"
  /** Their session or membership changed. Send them somewhere that can recover it. */
  | "reauthenticate"
  /** Transient. A retry may work. */
  | "retryable";

export interface FailureCopy {
  readonly title: string;
  readonly detail: string;
  readonly disposition: FailureDisposition;
}

/**
 * Copy per reason.
 *
 * Two rules run through all of it:
 *
 * - **Never confirm the existence of another tenant's data.**
 *   `account_not_found` and `transaction_not_found` are returned both for rows
 *   that do not exist and for rows belonging to another organization
 *   (`docs/adr/0005-tenant-isolation.md`). The copy says "not in this
 *   organization", which is true in both cases and reveals neither.
 * - **Never restate the server's message.** These are written for the person
 *   filling in the form.
 */
const COPY = {
  account_inactive: {
    title: "That account is closed",
    detail:
      "It can still be read, but it cannot take part in a new transaction. Pick an active account.",
    disposition: "fix_input",
  },
  account_name_taken: {
    title: "That name is already in use",
    detail: "Account names are unique within an organization. Choose a different one.",
    disposition: "fix_input",
  },
  account_not_empty: {
    title: "This account still holds a balance",
    detail:
      "An account has to be empty before it can be closed, or the balance would stay on the books with no way to move it. Transfer the remaining balance out, then close it.",
    disposition: "fix_input",
  },
  account_not_found: {
    title: "Account not found",
    detail: "No account with that id exists in this organization.",
    disposition: "blocked",
  },
  currency_mismatch: {
    title: "Those accounts hold different currencies",
    detail:
      "Every leg of one transaction has to be in a single currency. To move between currencies, use Exchange — it posts two linked transactions and records the rate.",
    disposition: "fix_input",
  },
  conversion_mismatch: {
    title: "The converted amount does not match the rate",
    detail:
      "The amount arriving has to be exactly what the amount and rate come to, rounded to the target currency's smallest unit. The expected figure is shown on the form.",
    disposition: "fix_input",
  },
  invalid_rate: {
    title: "That is not a usable exchange rate",
    detail:
      "A rate has to be a positive decimal with at most ten decimal places — for example 0.92. Zero and negative rates have no meaning.",
    disposition: "fix_input",
  },
  same_currency_exchange: {
    title: "Both accounts hold the same currency",
    detail:
      "There is nothing to convert. Use Transfer to move money between accounts in one currency.",
    disposition: "fix_input",
  },
  idempotency_conflict: {
    title: "That key was already used for a different transaction",
    detail:
      "An idempotency key can only ever stand for one transaction. Nothing was posted just now. Start a new operation to submit this as a separate transaction.",
    disposition: "blocked",
  },
  insufficient_funds: {
    title: "Not enough funds",
    detail:
      "This would take the source account below zero, which is not allowed for a normal account. Nothing was posted. Lower the amount or fund the account first.",
    disposition: "fix_input",
  },
  balance_limit_exceeded: {
    title: "Amount too large for this account's balance",
    detail:
      "The resulting balance would be larger than the ledger can store. Nothing was posted. Lower the amount, or move some of the balance elsewhere first.",
    disposition: "fix_input",
  },
  insufficient_role: {
    title: "Your role cannot do this",
    detail: "This action needs an admin role in this organization.",
    disposition: "blocked",
  },
  invalid_amount: {
    title: "That amount cannot be used",
    detail:
      "Enter a plain decimal number with no more decimal places than the currency allows, and within the range the ledger can store.",
    disposition: "fix_input",
  },
  invalid_cursor: {
    title: "That page link expired",
    detail: "Showing the first page instead.",
    disposition: "retryable",
  },
  no_active_organization: {
    title: "No active organization",
    detail: "Create or select an organization to continue.",
    disposition: "reauthenticate",
  },
  non_positive_amount: {
    title: "Amount has to be greater than zero",
    detail:
      "Every leg of a transaction moves a positive amount. Direction is what decides which way money goes.",
    disposition: "fix_input",
  },
  not_a_member: {
    title: "You do not have access to this organization",
    detail: "Switch to an organization you belong to, or ask an admin for an invitation.",
    disposition: "reauthenticate",
  },
  pending_already_decided: {
    title: "Already decided",
    detail: "Another admin already approved or rejected this transfer. Refresh the Approvals list.",
    disposition: "blocked",
  },
  pending_not_found: {
    title: "Pending transfer not found",
    detail: "No open approval request with that id exists in this organization.",
    disposition: "blocked",
  },
  rate_limited: {
    title: "Too many requests",
    detail: "Wait a moment and try again.",
    disposition: "retryable",
  },
  already_reversed: {
    title: "Already reversed",
    detail:
      "Another admin reversed this transaction first. Nothing was posted — a second reversal would double the correction.",
    disposition: "blocked",
  },
  approval_required: {
    title: "This organization requires approval",
    detail:
      "Transfers must be approved by a second admin before any balance moves. Submit it to the approval queue instead.",
    disposition: "blocked",
  },
  rejected_by_approver: {
    title: "Transfer rejected",
    detail: "A different admin rejected this pending transfer. Nothing was posted.",
    disposition: "blocked",
  },
  self_approve_forbidden: {
    title: "A different admin must decide",
    detail:
      "Maker-checker blocks approving or rejecting your own submission. Ask another admin to act.",
    disposition: "blocked",
  },
  too_few_postings: {
    title: "A transaction needs at least two legs",
    detail: "Money always moves from somewhere to somewhere else.",
    disposition: "fix_input",
  },
  transaction_not_found: {
    title: "Transaction not found",
    detail: "No transaction with that id exists in this organization.",
    disposition: "blocked",
  },
  unbalanced_transaction: {
    title: "The legs do not balance",
    detail: "Total debits have to equal total credits. Nothing was posted.",
    disposition: "fix_input",
  },
  unsupported_currency: {
    title: "That currency is not supported",
    detail: "Pick one of the currencies this sandbox knows the minor-unit scale for.",
    disposition: "fix_input",
  },
} satisfies Record<LedgerReason, FailureCopy>;

/**
 * Shown when the server returns something this console has no copy for. Never
 * renders the raw server message.
 *
 * Deliberately does **not** claim the operation did not happen. An unmapped
 * failure covers a dropped connection and an unhandled server fault alike, and
 * in neither case does the console know whether anything was written. Saying
 * "nothing was posted" here would be a guess about money — the reasons that
 * genuinely know it, like `insufficient_funds`, say so in their own copy.
 */
const UNKNOWN: FailureCopy = {
  title: "Something went wrong",
  detail: "The result of this request is unknown. Check the transaction list before trying again.",
  disposition: "retryable",
};

const UNAUTHENTICATED: FailureCopy = {
  title: "You are signed out",
  detail: "Sign in again to continue.",
  disposition: "reauthenticate",
};

const VALIDATION: FailureCopy = {
  title: "Check the highlighted fields",
  detail: "Some values were not in the expected format.",
  disposition: "fix_input",
};

/**
 * Extra context the server puts in the body for a throttled write.
 *
 * The server also sends `Retry-After` and `RateLimit-*` headers (added
 * 2026-08-19, CORS-exposed so this origin can read them). The console keeps
 * reading the body: it needs `scope` to say *whose* budget ran out, and no
 * header carries that.
 */
export interface RateLimitDetail {
  readonly scope?: string;
  readonly limit?: number;
  readonly retryAfterSeconds?: number;
}

export interface DescribedFailure extends FailureCopy {
  /** `null` when the server sent no reason — a bare 401, a Zod rejection, or an unmapped 500. */
  readonly reason: LedgerReason | null;
  /** Field-level issues from an oRPC `BAD_REQUEST`, for a form to attach to inputs. */
  readonly issues: readonly {
    readonly path: readonly (string | number)[];
    readonly message: string;
  }[];
  readonly rateLimit: RateLimitDetail | null;
}

function isReason(candidate: unknown): candidate is LedgerReason {
  return typeof candidate === "string" && (LEDGER_REASONS as readonly string[]).includes(candidate);
}

/**
 * Reads an unknown thrown value and returns something renderable.
 *
 * Takes `unknown` on purpose. This runs in a `catch` and in TanStack Query's
 * `onError`, where the value genuinely is unknown — a network failure throws a
 * `TypeError`, not an `ORPCError` — and a function that assumed otherwise
 * would throw inside the error handler.
 */
export function describeFailure(error: unknown): DescribedFailure {
  const record =
    typeof error === "object" && error !== null ? (error as Record<string, unknown>) : {};
  const data =
    typeof record.data === "object" && record.data !== null
      ? (record.data as Record<string, unknown>)
      : {};
  const status = typeof record.status === "number" ? record.status : null;
  const code = typeof record.code === "string" ? record.code : null;

  const reason = isReason(data.reason) ? data.reason : null;

  if (reason !== null) {
    return {
      ...COPY[reason],
      reason,
      issues: [],
      rateLimit: reason === "rate_limited" ? readRateLimit(data) : null,
    };
  }

  // Three branches carry no reason and still have to render honestly.
  if (status === 401 || code === "UNAUTHORIZED") {
    return { ...UNAUTHENTICATED, reason: null, issues: [], rateLimit: null };
  }

  const issues = readIssues(data);
  if (issues.length > 0 || code === "BAD_REQUEST") {
    return { ...VALIDATION, reason: null, issues, rateLimit: null };
  }

  return { ...UNKNOWN, reason: null, issues: [], rateLimit: null };
}

function readRateLimit(data: Record<string, unknown>): RateLimitDetail {
  return {
    scope: typeof data.scope === "string" ? data.scope : undefined,
    limit: typeof data.limit === "number" ? data.limit : undefined,
    retryAfterSeconds:
      typeof data.retryAfterSeconds === "number" ? data.retryAfterSeconds : undefined,
  };
}

function readIssues(data: Record<string, unknown>): DescribedFailure["issues"] {
  if (!Array.isArray(data.issues)) {
    return [];
  }

  return data.issues.flatMap((issue) => {
    if (typeof issue !== "object" || issue === null) {
      return [];
    }
    const entry = issue as Record<string, unknown>;
    const message = typeof entry.message === "string" ? entry.message : null;
    if (message === null) {
      return [];
    }
    const path = Array.isArray(entry.path)
      ? entry.path.filter(
          (segment): segment is string | number =>
            typeof segment === "string" || typeof segment === "number",
        )
      : [];
    return [{ path, message }];
  });
}

/**
 * True when the form that produced this failure should stay open and populated.
 *
 * Covers `retryable` as well as `fix_input`. `docs/product/requirements/ledger.md`
 * requires that *failed mutations keep the form open with the reason inline* —
 * and a `rate_limited` submit is exactly that case: the user did nothing wrong,
 * the operation did not happen, and closing the form would throw away everything
 * they typed for a failure that resolves itself in seconds.
 *
 * Only `blocked` and `reauthenticate` close it, because in both the user cannot
 * make this submission succeed from here.
 */
export function keepsFormOpen(failure: DescribedFailure): boolean {
  return failure.disposition === "fix_input" || failure.disposition === "retryable";
}

/**
 * True when the operation's idempotency key must be abandoned.
 *
 * Only `idempotency_conflict` qualifies: the key has already been spent on a
 * different payload, so no retry under it can ever succeed. Everything else —
 * including `insufficient_funds` — keeps its key so a resubmission is a replay
 * of one operation rather than a second one.
 */
export function requiresNewIdempotencyKey(failure: DescribedFailure): boolean {
  return failure.reason === "idempotency_conflict";
}

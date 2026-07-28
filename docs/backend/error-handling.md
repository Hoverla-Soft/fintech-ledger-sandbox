# Error handling conventions

## Error response shape

oRPC's own envelope, unmodified:

```json
{
  "code": "NOT_FOUND",
  "status": 404,
  "message": "Account not found.",
  "data": { "reason": "account_not_found" }
}
```

- `code` is oRPC's error code; `status` is the HTTP status it maps to. The mapping is oRPC's built-in `COMMON_ERROR_STATUS_MAP` — this API overrides no status.
- `message` is a **fixed string per branch**, never interpolated with the offending value. An echoed-back account id would confirm to a caller probing another tenant that their id was well-formed, and an interpolated driver message would leak internals.
- `data.reason` is the stable, machine-readable contract. Clients switch on `reason`, never on `message`. A value may be added but not renamed without a corresponding client change.

## Error codes

Produced by `toORPCError` (`packages/api/src/errors.ts`), the single translation point from typed domain and persistence errors to HTTP.

| `data.reason` | Origin | oRPC `code` | HTTP status |
|---|---|---|---|
| `account_not_found` | `AccountNotFound` (`packages/db`) | `NOT_FOUND` | 404 |
| `account_inactive` | `AccountInactive` (`packages/db`) | `UNPROCESSABLE_CONTENT` | 422 |
| `account_name_taken` | `AccountAlreadyExists` (`packages/db`) | `CONFLICT` | 409 |
| `transaction_not_found` | `TransactionNotFound` (`packages/db`) | `NOT_FOUND` | 404 |
| `idempotency_conflict` | `IdempotencyConflict` (`packages/db`) | `CONFLICT` | 409 |
| `insufficient_funds` | `InsufficientFunds` (`packages/core`) | `UNPROCESSABLE_CONTENT` | 422 |
| `currency_mismatch` | `CurrencyMismatch` (`packages/core`) | `UNPROCESSABLE_CONTENT` | 422 |
| `unsupported_currency` | `UnsupportedCurrency` (`packages/core`) | `UNPROCESSABLE_CONTENT` | 422 |
| `invalid_amount` | `InvalidAmount` (`packages/core`) | `UNPROCESSABLE_CONTENT` | 422 |
| `non_positive_amount` | `NonPositiveAmount` (`packages/core`) | `UNPROCESSABLE_CONTENT` | 422 |
| `too_few_postings` | `TooFewPostings` (`packages/core`) | `UNPROCESSABLE_CONTENT` | 422 |
| `unbalanced_transaction` | `UnbalancedTransaction` (`packages/core`) | `UNPROCESSABLE_CONTENT` | 422 |

Emitted by middleware rather than by the error map (see ADR 0005 for the tenancy and role reasons, ADR 0007 for `rate_limited`):

| `data.reason` | Meaning | oRPC `code` | HTTP status |
|---|---|---|---|
| — | No session | `UNAUTHORIZED` | 401 |
| `no_active_organization` | Signed in, but the session names no organization | `FORBIDDEN` | 403 |
| `not_a_member` | The session names an organization the user has no `member` row for — **or one that does not exist** | `FORBIDDEN` | 403 |
| `insufficient_role` | Ledger role is `viewer`, action requires `admin` | `FORBIDDEN` | 403 |
| `invalid_cursor` | Malformed pagination cursor | `BAD_REQUEST` | 400 |
| `rate_limited` | The write rate limit for this organization or user is exhausted | `TOO_MANY_REQUESTS` | 429 |

`rate_limited` is the one reason whose `data` carries more than `reason`. `enforceLimit` (`packages/api/src/rate-limit.ts`) adds `scope` (`"organization" | "user"` — which of the two limits tripped), `limit` (that limit's ceiling), and `retryAfterSeconds` (floored at 1, since a client told to wait zero seconds retries immediately and trips the limit again). The extra fields are additive; a client that switches only on `reason` keeps working.

Zod contract-validation failures produce oRPC's standard `BAD_REQUEST` (400) with its own issue details.

## Status codes are assigned by category, never per endpoint

This is a correctness rule, not a style preference. If "exists but forbidden" were distinguishable from "does not exist", the API would be an enumeration oracle for other tenants.

- **404** — any resource that is missing *or* belongs to another organization. The two are byte-identical in code, message, and body. `packages/db` collapses them into one error type on purpose; handlers forward it without branching.
- **403** — you may not act in this organization, or your role is insufficient. Never a signal that a resource exists. Naming a nonexistent organization also returns 403, with the same body as naming a real one you do not belong to.
- **401** — no session at all.
- **422** — the request was understood and authorized, but violates a ledger invariant.
- **409** — a conflict with state that already exists: an idempotency key reused with a different payload, or an account name already taken in this organization.
- **429** — the caller's write budget is exhausted. Applied only to `adminProcedure` and only *after* the role check, so a rejected `viewer` cannot spend an organization's quota.

**Why `account_inactive` is 422 and not 404.** The no-enumeration rule above is aimed at *cross-tenant* existence leaks. An inactive account belongs to the caller's own organization, where there is nothing to hide — `accountSchema` already exposes `active` on the read surface, so a 404 here would contradict what `accounts.list` just told the same caller. Order of checks is what keeps the rule intact: `lockAccounts` tests every id for existence before it tests any id for activity, so another org's id always produces `account_not_found` and never `account_inactive`.

## Conventions

- Raw provider/database errors are never returned to the client as-is. Normalize them first (see the provider-abstraction sections in `db-architecture-guard` and `backend-architecture-guard`).
- Expected client/domain errors use the correct status and stable public error code. Unexpected errors return a generic message; stack traces, queries, provider payloads, and internal exception messages stay server-side.
- A global HTTP/RPC error boundary and an equivalent worker/job boundary must handle every uncaught failure. Process-level `uncaughtException` and `unhandledRejection` handlers log at `fatal`, trigger monitoring, and start graceful shutdown; they are not recovery mechanisms.
- Timeouts, cancellations, and dependency failures must remain distinguishable. Preserve the original error as `cause` when translating it into an application error.

## Logging policy

Use the structured logger declared in `docs/development/tech-stack.md`. Logs are diagnostic events, not a transcript of every function call.

### Levels

| Level | Use for | Examples |
|---|---|---|
| `debug` | Detailed development diagnostics, disabled in production by default | branch decisions, sanitized query timing, cache diagnostics |
| `info` | Meaningful lifecycle or business events with operational value | service started, job completed, integration state changed |
| `warn` | An abnormal but handled condition that may need attention | retry scheduled, deprecated input, fallback used, rate limit approached |
| `error` | A failed request/job/operation requiring investigation | unexpected exception, retries exhausted, dependency operation failed |
| `fatal` | The process cannot safely continue | bootstrap failure, corrupted required configuration, uncaught process error |

Do not use `error` for normal validation failures, authentication rejection, not-found responses, or other expected 4xx outcomes unless their rate or nature indicates abuse or a system defect. If such events are useful for audit/security, record a dedicated sanitized event at the appropriate level.

### Required context

Every request/job failure log should include, where applicable:

- stable event name and human-readable message;
- environment, service name, version/release, and timestamp (normally logger-wide fields);
- request/correlation ID, route or operation name, HTTP method and status code;
- actor/account/tenant identifiers only when permitted and necessary, preferably opaque IDs;
- job ID, provider/integration name, retry attempt, and duration;
- normalized error code/type plus the error object with stack and `cause` serialized by the logger.

Do not log entire request/response bodies by default. Use an allowlist for metadata. Logger-level redaction must cover authorization/cookie headers, credentials, tokens, passwords, secrets, sensitive query parameters, and regulated personal/payment data.

### Development

- Default threshold: `debug` (or `info` when debug output is too noisy); make it configurable with an environment variable.
- Human-readable pretty output and stack traces are allowed locally. Keep correlation IDs and structured fields visible so local behavior resembles production.
- Debug logging must be temporary or purposeful. Do not log on every render, loop iteration, health check, successful database query, or routine request merely to prove that code ran.
- Never relax secret/PII redaction in development: local logs are often copied into issues and chat.

### Production

- Default threshold: `info`; use structured JSON or the deployment platform's equivalent structured format. `debug` is off unless temporarily enabled for a scoped incident.
- Write to stdout/stderr or the configured collector. Application code must not manage local rotating log files inside ephemeral/container/serverless runtimes.
- Sample or suppress high-volume successful access logs and exclude routine health/readiness probes. Never sample `error` or `fatal` events blindly; deduplicate them in the monitoring pipeline if necessary.
- Send unexpected `error`/`fatal` events to the selected error-monitoring service and alert on actionable symptoms (error rate, exhausted retries, job failures), not on every individual warning.
- Logging failure must not crash a request path. Use a safe fallback for fatal/bootstrap diagnostics and ensure buffered logs are flushed during graceful shutdown when the selected logger supports it.

### One failure, one owner

The outermost boundary that knows the final outcome logs the failure once. Services, repositories, and provider adapters should normally throw/return a normalized error with `cause` and useful fields; they should not each emit the same stack trace. A lower layer may log only when it handles a separate event that would otherwise be lost, such as scheduling a retry or switching to a fallback.

```ts
// Boundary-level pseudocode; adapt it to the selected framework/logger.
try {
  return await handleRequest(request);
} catch (error) {
  const normalized = normalizeError(error);
  logger.error({
    event: "request.failed",
    requestId,
    route,
    errorCode: normalized.code,
    err: normalized,
  }, "Request failed");
  return toSafeErrorResponse(normalized, requestId);
}
```

## Verification checklist

Status as of Phase 4a. Items still open name what would close them rather than being left blank.

- [x] Expected errors return a stable public code and do not leak internals — the `reason` table above; `packages/api/src/errors.test.ts` asserts no branch interpolates an id or a balance into its message.
- [x] Unexpected request/job failures are logged exactly once with correlation context and stack trace — logged once at the outermost boundary (`logUnexpectedError` in `apps/server`), and expected 4xx are deliberately *not* logged. Correlation IDs are not yet emitted; they arrive with the structured logger below.
- [x] No empty catches, floating promises, or log-and-continue behavior hide failures — the two `catch` blocks in `packages/api` (`decodeCursor`) return a typed `null` that the router converts into a `400`.
- [ ] Secret and sensitive-data redaction has an automated test — **open.** No structured logger exists yet, so there is no redaction layer to test. Due with pino (see `tech-stack.md`).
- [ ] Dev and production log thresholds/formats are configured — **open.** The sandbox logs via Hono's `logger()` and `console.error`; thresholds and JSON output arrive with pino.
- [ ] Monitoring captures unexpected errors, and graceful shutdown covers fatal process failures — **open, and partly by design.** `tech-stack.md` declares error monitoring explicitly `none` for this sandbox. Graceful shutdown and `uncaughtException`/`unhandledRejection` handlers are genuinely missing from `apps/server` and are not in Phase 4a's scope; they belong with the API hardening work.

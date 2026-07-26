---
name: backend-reliability-security-guard
description: Backend reliability and security reviewer. Use when a task touches API routes, server configuration, middleware, startup/shutdown, external provider integrations, the database, background jobs, or deployment configuration. Covers graceful shutdown, health/readiness, request validation, auth, CORS/CSRF, security headers, rate limiting, uploads, timeouts, retries, idempotency, transactions, provider/webhook security, error handling, logging, secrets, and observability — the operational half of "is this backend production-ready," distinct from backend-architecture-guard's structural/SOLID review.
---

# Backend Reliability and Security Guard

Apply these checks whenever the task touches backend routes, middleware, server startup, database connections, external providers, queues, authentication, or deployment configuration. This skill owns the operational/reliability/security surface; hand structural boundary and SOLID concerns to `backend-architecture-guard`, schema/query/tenant-isolation detail to `db-architecture-guard`, and provider documentation completeness to `integration-spec-guard` — reference them rather than re-deriving their checks here.

## Minimum baseline

If nothing else gets checked, check these — they're the ones most likely to be silently missing on a new backend surface:

- Security headers set
- CORS allowlist (not a reflected wildcard)
- Request body size limits
- Strict schema validation on every input (per the validation library in `docs/development/tech-stack.md`)
- Authentication enforced
- Backend-side permission checks (not just hidden UI)
- Tenant scoping (`organization_id` or equivalent) on every tenant-owned query
- Request ID generated and propagated
- Consistent API error shape
- Structured logging, with a defined sensitive-fields denylist
- Timeouts on every provider call
- Idempotency on operations with side effects that can duplicate
- Webhook signature verification
- Rate limiting on abuse-prone routes
- Health and readiness endpoints, distinct from each other
- Graceful shutdown
- Database pool cleanup on shutdown
- Unhandled rejection / uncaught exception handling

## Graceful shutdown

Verify that the application handles termination signals correctly.

- Handle `SIGTERM` and `SIGINT`.
- Stop accepting new HTTP requests.
- Allow active requests to finish within a defined timeout.
- Close the HTTP server.
- Close database connections and connection pools.
- Stop queue consumers and background workers.
- Close cache/broker (e.g. Redis) and provider clients when applicable.
- Flush logs and telemetry when supported.
- Prevent shutdown logic from running more than once.
- Force termination after the shutdown timeout if resources do not close.
- Exit with a non-zero code when shutdown fails unexpectedly.

Example lifecycle:

```text
SIGTERM / SIGINT
        ↓
Mark application as shutting down
        ↓
Readiness endpoint returns failure
        ↓
Stop accepting new requests
        ↓
Finish active requests
        ↓
Stop workers and scheduled jobs
        ↓
Close database and external connections
        ↓
Exit process
```

Do not call an immediate process exit before resources have been closed — the shutdown handler's whole job is to close things in order before the process actually terminates.

## Health and readiness checks

If the application is deployed as a service, verify it exposes separate checks — these are two different questions and answering only one of them is a common gap.

**Liveness** (`GET /health`): confirms the process is running. Should not run expensive dependency checks.

**Readiness** (`GET /ready`): confirms the application can receive traffic. May verify database connectivity, required configuration, queue/broker connectivity, and shutdown state.

During graceful shutdown, readiness must fail before the process exits — this is what lets a load balancer stop routing traffic to a terminating instance before it actually goes down.

## Request validation

- Validate path parameters, query parameters, headers, and request bodies.
- Use strict schemas and reject unknown fields where appropriate.
- Validate values again at the domain layer when they represent business rules — frontend/edge validation is not a substitute.
- Do not trust frontend validation.
- Define maximum string, array, file, and numeric sizes.
- Normalize values only when the normalization rules are explicit.
- Do not silently coerce unsafe values.

## Authentication and authorization

- Verify authentication on every protected backend operation.
- Enforce permissions on the backend, not only through hidden UI controls.
- Check tenant ownership and resource ownership separately from role checks (cross-check `db-architecture-guard`'s multi-tenancy section).
- Prevent IDOR by scoping resource lookup to the current user or organization.
- Use deny-by-default permissions.
- Validate session, token, and API key expiration.
- Rotate or revoke credentials when supported.
- Never include secrets or complete tokens in logs.

## Cookie and CSRF protection

If authentication uses cookies:

- use `HttpOnly`;
- use `Secure` in HTTPS environments;
- configure an appropriate `SameSite` policy;
- define the cookie domain and path explicitly;
- protect state-changing requests against CSRF;
- verify `Origin` or use CSRF tokens where appropriate.

Do not assume that CORS prevents CSRF — they protect against different things.

## CORS

- Allow only known frontend origins.
- Do not reflect arbitrary origins.
- Do not combine wildcard origins with credentials.
- Restrict allowed methods and headers.
- Keep development and production origin lists separate.
- Reject unexpected cross-origin requests.

## Security headers

If the application serves HTTP responses:

- Verify that security headers are configured: `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, `Strict-Transport-Security`, frame protection through CSP `frame-ancestors`.
- Use the security headers middleware declared in `docs/development/tech-stack.md`'s Companion libraries table rather than hand-rolling headers. If that row is still `{{...}}`, stop and ask using the options in `docs/development/framework-companions.md` instead of picking one.
- Configure CSP intentionally instead of relying on defaults — a default-permissive or default-empty CSP is not a real policy.
- Enable HSTS only for production HTTPS deployments — it can break local/staging HTTP setups if applied unconditionally.
- Verify that security headers do not break required integrations or embedded flows — check before flagging a missing header as an unconditional fix.

## Rate limiting and abuse protection

Apply rate limits where abuse is possible, especially for: login, password reset, email verification, public forms, quote/rate calculation, provider requests, file upload, webhook replay or manual retry endpoints.

Consider separate limits by IP address, authenticated user, organization, API key, and route. Return a stable error code and retry information when appropriate.

## Request size and upload limits

- Set a maximum request body size.
- Restrict accepted content types.
- Validate uploaded file type, extension, and actual content.
- Limit file count and total size.
- Generate internal file names instead of trusting user-provided names.
- Prevent path traversal.
- Do not store uploads in publicly executable directories.
- Scan files when the risk profile requires it.

## Timeouts and cancellation

Every external operation must have a bounded execution time. Verify timeouts for: incoming HTTP requests, database queries, provider API calls, queues, file processing, background jobs.

- Propagate `AbortSignal` or equivalent cancellation where supported.
- Cancel provider calls when the client request is aborted if safe.
- Do not allow a hung provider request to consume server resources indefinitely.
- Use different timeout values for connection and total request time when possible.

## Retries

Retry only transient failures.

Potentially retryable: connection reset, provider timeout, temporary `5xx`, rate limiting when the provider allows it.
Normally not retryable: validation errors, authentication errors, permission errors, invalid state transitions.

Rules: exponential backoff; add jitter; set a maximum attempt count; respect `Retry-After`; ensure the operation is idempotent before retrying; do not retry inside an open database transaction.

## Idempotency

Require idempotency for operations that can produce duplicate side effects — payment/transfer/quote execution, balance changes, webhook processing, email/notification dispatch, provider synchronization.

Verify: idempotency key source, uniqueness scope, expiration policy, stored request fingerprint, behavior when the same key is used with a different payload, concurrent requests with the same key.

## Transactions and concurrency

- Use transactions when related database changes must succeed atomically.
- Keep transactions short.
- Do not wait for slow provider calls inside transactions unless explicitly required.
- Check race conditions for balances, statuses, quotas, counters, and inventory-like data.
- Use database constraints as the final protection against duplicates.
- Use row locks or optimistic concurrency only where the flow requires them.
- Validate state transitions atomically.

Example:

```text
Read current status
        ↓
Validate transition
        ↓
Update with condition on previous status
        ↓
Verify affected row count
```

Cross-check with `db-architecture-guard`'s query and transaction-boundary sections for the schema/query side of this.

## Provider protection

If the backend calls external providers (see `docs/integrations/`):

- isolate provider-specific DTOs and errors;
- use explicit connect and request timeouts;
- validate provider responses — never trust a success HTTP status without validating the payload;
- map provider errors to internal stable codes;
- redact credentials and sensitive payloads from logs;
- prevent duplicate provider operations;
- track provider request IDs;
- define retry and fallback behavior;
- consider a circuit breaker for unstable providers;
- distinguish sandbox and production credentials;
- verify request and webhook signatures where required.

## Webhook security

- Verify signatures using the raw request body when required.
- Validate timestamps when the provider supplies them.
- Protect against replay through event IDs or timestamp windows.
- Process events idempotently.
- Do not assume event delivery order.
- Store processing status and failure reason.
- Return responses according to the provider retry contract.
- Do not expose signature verification internals to the sender.

## Error handling

- Use one consistent API error format.
- Return stable machine-readable error codes.
- Do not expose stack traces, SQL, secrets, or provider internals.
- Separate operational errors from unexpected programming errors.
- Log unexpected errors with request context.
- Preserve the original error through `cause` or equivalent.
- Ensure async errors reach the global error handler.
- Add handlers for unhandled rejections and uncaught exceptions.

For fatal errors: log the error, start graceful shutdown, exit with a failure code. Do not keep the process running in an unknown corrupted state.

## Logging and sensitive data

Use structured logs. Include where available: request ID, trace ID, route, HTTP method, status code, duration, user ID, organization ID, provider request ID, error code.

Never log: passwords, session cookies, access/refresh tokens, API keys, private keys, full card/bank details, raw authorization headers, sensitive personal data without an explicit reason.

## Request correlation

- Generate or accept a validated request ID.
- Return it in the response.
- Propagate it to services, repositories, provider clients, and logs.
- Do not trust an unbounded or malformed client-provided request ID.
- Include provider correlation IDs when available.

## Database protection

- Use parameterized queries.
- Do not build SQL from untrusted string fragments.
- Validate dynamic sorting and filtering against allowlists.
- Use least-privilege database credentials; separate migration and runtime credentials where practical.
- Set query or statement timeouts.
- Limit connection pool size.
- Verify indexes for frequent filters and joins (cross-check `db-architecture-guard`).
- Avoid returning unrestricted datasets; require pagination for potentially large collections.
- Protect tenant-scoped queries with the tenant key.

## Secrets and configuration

- Read secrets from environment or a secret manager.
- Do not commit secrets to the repository.
- Validate required environment variables during startup.
- Fail fast when critical configuration is missing.
- Keep sandbox, staging, and production secrets separate.
- Do not expose secrets through frontend environment variables.
- Rotate compromised credentials.
- Avoid printing full configuration during startup.

## API response protection

- Return only fields required by the client.
- Do not serialize database models directly by default — use explicit response DTOs.
- Hide internal IDs or provider metadata when the client does not need them.
- Avoid exposing whether a resource exists in another tenant.
- Use pagination limits with a server-controlled maximum.
- Prevent mass assignment by explicitly selecting writable fields.

## Observability

For important operations, verify the availability of: structured logs, request duration metrics, error rate metrics, provider latency and failure metrics, database pool metrics, queue depth and failed jobs, health/readiness status, tracing for multi-service flows.

Alert on meaningful service conditions rather than every individual error.

## Background jobs and queues

If background processing exists:

- make jobs idempotent;
- define retry limits and backoff;
- use dead-letter handling;
- define job timeouts;
- handle worker shutdown gracefully (see Graceful shutdown above — workers need the same treatment as the HTTP server);
- prevent the same job from running concurrently when unsafe;
- store job failure context;
- define manual replay behavior;
- distinguish permanent and transient failures.

## Cache safety

If caching exists:

- define cache key scope, including tenant identifiers where required;
- define TTL and invalidation behavior;
- prevent sensitive data from being shared across users or organizations;
- do not treat cache as the source of truth;
- handle cache unavailability without corrupting state.

## Review output

Always report: validation issues, authentication/authorization risks, missing tenant scoping, error-handling problems, unsafe logging, transaction/concurrency risks, missing timeouts, missing idempotency, resource cleanup problems, graceful shutdown problems.

When applicable, also report: CORS/CSRF risks, rate-limit gaps, webhook verification issues, provider retry risks, unsafe uploads, background job reliability, health/readiness issues, missing observability.

For every issue: severity, location, problem, why it matters, recommended fix. Note what's already handled correctly, not just gaps.

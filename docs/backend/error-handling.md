# Error handling conventions

## Error response shape

```json
{{the actual error envelope this API returns — status code, error code, message, field-level details if applicable}}
```

## Error codes

| Code | Meaning | HTTP status |
|---|---|---|
| {{...}} | {{...}} | {{...}} |

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

- [ ] Expected errors return a stable public code and do not leak internals
- [ ] Unexpected request/job failures are logged exactly once with correlation context and stack trace
- [ ] No empty catches, floating promises, or log-and-continue behavior hide failures
- [ ] Secret and sensitive-data redaction has an automated test
- [ ] Dev and production log thresholds/formats are configured and production logs reach their declared destination
- [ ] Monitoring captures unexpected errors, and graceful shutdown covers fatal process failures

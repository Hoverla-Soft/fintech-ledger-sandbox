# Operations runbook

**Scope note, stated first because it changes how everything below should be read.** This is a
demonstration sandbox holding fake money. There is no paging rotation, no follow-the-sun cover,
and no customer whose Saturday depends on it. The procedures here are real and have been written
against the actual deployment, but the response *posture* is best-effort business hours. Writing
a 15-minute SLA into this file would make it fiction, and a runbook nobody can trust in the small
things is not consulted in the large ones.

## Ownership and escalation

| | |
|---|---|
| Service owner | [@ArtemixArt228](https://github.com/ArtemixArt228) (HoverlaSoft) |
| Infrastructure owner | Same. Railway project and Postgres instance are owned by the same person. |
| Escalation channel | [GitHub issues](https://github.com/Hoverla-Soft/fintech-ledger-sandbox/issues). No pager, no rotation. |
| Security reports | Private advisory, **not** an issue — see [SECURITY.md](../../SECURITY.md). |
| Status page | None. The demo's own health is the status page: [`/`](https://api-fintech-ledger-sandbox.up.railway.app/) for liveness, [`/ready`](https://api-fintech-ledger-sandbox.up.railway.app/ready) for readiness. |
| Expected response | Best effort, business hours. Availability of a fake-money sandbox is not an incident. |

## Environments

| | Web console | API | Database |
|---|---|---|---|
| Production | [fintech-ledger-sandbox.up.railway.app](https://fintech-ledger-sandbox.up.railway.app) | [api-fintech-ledger-sandbox.up.railway.app](https://api-fintech-ledger-sandbox.up.railway.app) | Railway Postgres 18 |
| Local | `:3001` | `:3000` | Docker Compose (`pnpm db:start`) |

There is no staging environment. Changes go from a local verification run to production, which is
an acceptable risk for a sandbox and would not be for anything else.

## Dashboards and alerts

**There are none, and that is a recorded decision rather than an oversight.** `tech-stack.md`
declares error monitoring and metrics as `none` for this project. What exists instead:

| Signal | Where | What it tells you |
|---|---|---|
| Deploy status, restarts, resource use | Railway dashboard, per service | Whether the process is up and why it last restarted |
| Structured logs | Railway logs (pino JSON, one line per event) | Filter `msg="request_completed"` for traffic, `level=50` for unexpected errors. Every line carries a `requestId`. |
| Liveness | `GET /` | Answers without touching anything. A failure here means the process is gone, not the database. |
| Readiness | `GET /ready` | Runs a real query. `503` means Postgres is unreachable. |
| Ledger integrity | Reconciliation screen, or `reconciliation.verify` | Every account's recorded balance against the signed sum of its postings |

No alerting is configured, so nothing here pages anyone. Discovery is by someone looking.

## First response

1. Confirm impact, affected environment and organization, and who is handling it.
2. Check recent deployments, config changes, and migrations, then `/` and `/ready`.
3. Preserve evidence: capture the `requestId` from the failing request and the surrounding log
   lines. Logs are redacted at the logger, so copying a line is safe — but screenshots of the
   console may contain organization data, so treat them as you would the data itself.
4. Mitigate with a documented action from below. Do not improvise destructive SQL against
   production; the ledger's integrity guarantees are the entire point of the project.
5. Record what was done and when, in the issue.

**Before anything else, ask whether the ledger's invariants are intact.** A slow or unavailable
service is an inconvenience. A balance that disagrees with its posting history would be the only
genuinely serious failure this system can have — and it is the one thing that is directly
checkable, via reconciliation.

## Recovery procedures

### Roll back a release

Railway keeps previous deployments. Redeploy the last known-good one from the service's
Deployments tab.

**Check before rolling back: does the previous release predate a migration?** Migrations are
roll-forward only and are not reversed by redeploying older code. If a migration landed with the
release you are rolling back, the old code will meet a newer schema. Additive migrations
(new nullable column, new table, new index) are safe that way. A migration that dropped or
renamed something is not — in that case fix forward instead.

Verify: `/ready` returns 200, the console loads, and reconciliation is clean.

### The API is up but every browser request fails

Almost always CORS, and it produces no server-side error at all — which is the reason it is
listed first.

`CORS_ORIGIN` is compared byte-for-byte against the browser's `Origin` header. A mismatch, a
trailing slash the schema did not strip, or the wrong scheme returns a response with no
`Access-Control-Allow-Origin` header and nothing in the logs. Confirm the configured value equals
the console's origin exactly, then redeploy the **API**.

If instead the console reaches the wrong API entirely: `VITE_SERVER_URL` is inlined into the
bundle at build time. Changing it requires a **rebuild of the web service**, not a restart.

### Database degradation

- **`/ready` returns 503.** The database is unreachable. Check the Railway Postgres service
  first; the API cannot fix this by restarting, and restarting it loses in-flight requests for
  nothing.
- **Requests hang, then fail.** The pool bounds are doing their job: `statement_timeout` at 10s,
  `idle_in_transaction_session_timeout` at 30s, connection timeout at 5s
  ([`packages/db/src/index.ts`](../../packages/db/src/index.ts)). A statement abort rolls back its
  whole transaction, and every write carries an idempotency key, so the caller's retry is safe.
- **Writes fail but reads succeed.** Check for lock contention. Every posting transaction takes
  row locks on the involved accounts in sorted order, so deadlock should be structurally
  impossible; if you see one, that is a real defect and worth an issue.
- **Suspected integrity problem.** Run reconciliation for the affected organization. It compares
  every recorded balance against the signed sum of that account's postings. Do not attempt to
  "correct" a balance with SQL — postings are append-only and the database will refuse
  `UPDATE`/`DELETE`/`TRUNCATE` anyway. The sanctioned correction is a reversing transaction.

### Migration failed part-way

Migrations run through `drizzle-kit migrate` and are recorded in a journal. Applied migrations are
immutable: **do not edit one to fix it.** Write a new migration that corrects forward, and verify
the journal with `node .claude/scripts/migration-integrity-guard.js --check` before deploying.

If a migration failed mid-apply, check which statements committed before writing the corrective
one — Postgres runs each migration in a transaction, but a multi-statement migration split across
breakpoints can leave earlier ones applied.

### Disable a feature safely

- **Stop all direct balance changes:** turn on maker-checker for the organization
  (`settings.setRequireTransferApproval`). Every direct post, reversal, exchange, seed, and reset
  is then refused with `403 approval_required` and audited. The toggle itself is audited too.
- **Stop all writes for everyone:** there is no global kill switch. The nearest equivalent is
  scaling the API service to zero in Railway, which stops reads as well.

### Credential compromise and rotation

Rotate in this order, and expect user-visible effects:

1. **`BETTER_AUTH_SECRET`** — rotating it invalidates every existing session; all users are signed
   out. Must be ≥ 32 characters or the process fails validation at boot rather than at first
   request.
2. **`DATABASE_URL`** — rotate the password in Railway Postgres, update the variable on the API
   service, redeploy. The graceful shutdown path drains in-flight requests before closing the
   pool, so a redeploy does not sever a transaction mid-flight.
3. Confirm no secret reached the logs. Redaction covers cookies, `Authorization`, `DATABASE_URL`,
   `BETTER_AUTH_SECRET`, and a failed query's bound parameters
   ([`apps/server/src/logger.ts`](../../apps/server/src/logger.ts)) — but confirm rather than
   assume, and rotate anything that did appear.

Never commit a secret to fix an outage faster. Every value here is settable in the Railway
dashboard.

### Backup and restore

Backups are whatever the Railway Postgres plan provides; this project configures none of its own,
takes no application-level dumps, and **has never performed a restore drill.** That is the honest
state, and it is the largest operational gap in this document.

For a sandbox the cost of total data loss is a re-seed: sign up, create an organization, run the
sandbox scenarios. Nothing here is irreplaceable. Treat that as the recovery plan, because it is
the only one that has actually been exercised.

## Post-incident

For anything beyond a transient blip, add to the issue: a timeline with timestamps, what was
affected, what actually caused it (not just what fixed it), and corrective actions with owners.

Then ask the question this repository's process exists to force: **what check would have caught
this, and why did it not exist?** If the answer is a test, write it. If it is an unrecorded
decision, write an [ADR](../adr/). A fix without one of those is an invitation to meet the same
incident again.

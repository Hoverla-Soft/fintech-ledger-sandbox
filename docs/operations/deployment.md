# Deployment

Two Railway services from one monorepo, plus a Railway Postgres 18 instance. Each service is
configured by a committed `railway.json` rather than by dashboard clicks, so the build and deploy
commands are reviewable in git.

| Service | Config | Public origin |
|---|---|---|
| `web` (console) | [`apps/web/railway.json`](../../apps/web/railway.json) | fintech-ledger-sandbox.up.railway.app |
| `server` (API) | [`apps/server/railway.json`](../../apps/server/railway.json) | api-fintech-ledger-sandbox.up.railway.app |
| Postgres 18 | Railway-managed | private |

There is no staging environment. Verified locally, then production.

## Release flow

Push to `main` → GitHub Actions runs the verification suite → Railway builds any service whose
watch patterns matched → the API runs migrations → the new version starts and must pass its
health check.

The two services build independently. `watchPatterns` in each `railway.json` decides which one
rebuilds: a change under `apps/web/**` or `packages/ui/**` rebuilds only the console, a change
under `packages/db/**` rebuilds only the API, and a change to `pnpm-lock.yaml` or `turbo.json`
rebuilds both. Each build is `turbo run build --filter=<service>...`, so it builds that service
and its workspace dependencies and nothing else.

> ⚠️ **CI is not a gate.** Railway deploys on push, independently of the GitHub Actions result.
> Nothing blocks a deploy whose checks failed. Compounding this, the account is currently
> billing-locked, so pushes from the affected account never start a run at all — see
> [`docs/showcase/security.md`](../showcase/security.md).

## Verification commands

The same five that a task file's Verification block declares, run by
[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) on Node 24 / pnpm 10.31.0:

```bash
pnpm audit --audit-level=high
pnpm lint
pnpm check-types
pnpm test
pnpm build
node .claude/scripts/migration-integrity-guard.js --check
```

The workflow supplies throwaway env values rather than setting `SKIP_ENV_VALIDATION`, so a
genuinely missing or malformed variable still fails. Postgres is deliberately not a service
container: the integration suites start their own through Testcontainers, so the workflow only
asserts a reachable Docker daemon.

## Pre-deploy checks

- Verification suite green **for the exact commit**, run locally if CI could not.
- Every required variable exists on the target service. `packages/env` validates at import, so a
  missing one is a boot failure, not a runtime surprise.
- If the change includes a migration, confirm it is backward-compatible with the currently running
  code — see the ordering rule below.
- If `VITE_SERVER_URL` changed, remember the console needs a **rebuild**, not a restart.

## Migrations

`preDeployCommand` on the API service runs `db:migrate` **before** the new version starts and
**while the old one is still serving**. That ordering has a consequence worth stating plainly:

> For the duration of the deploy, the old code runs against the new schema.

So a migration must be backward-compatible with the release it is replacing. Add columns as
nullable or with defaults; add tables and indexes freely; do **not** drop or rename anything the
outgoing code still reads in the same deploy. Splitting that into expand → migrate → contract
across two releases is the standard way and the one to use here.

If `preDeployCommand` fails, the deploy stops and the old version keeps serving. That is the
desired behaviour: a failed migration should not be followed by code that assumes it succeeded.

Applied migrations are immutable. Corrections roll forward as new migrations, and the integrity
guard checks the journal against what is on disk.

## Rollout and verification

Health check is `GET /` with a 30-second timeout, one replica, restart on failure up to 10 times.

`/` answers without touching the database, deliberately: it is a liveness probe, and a liveness
check that fails when Postgres is down tells the platform to restart a process that is working
perfectly. The trade-off is that the deploy gate does not prove database connectivity, so verify
that yourself after a release:

1. `GET /ready` returns 200 — this one does query the database.
2. The console loads and an organization's ledger renders.
3. Reconciliation is clean.
4. Logs show no `level=50` entries from the new version.

## Rollback

Redeploy the previous deployment from the Railway service's Deployments tab.

**Untested.** No rollback has ever been performed on this project, so treat the procedure as
plausible rather than proven. The two things that would make it fail are known: a migration that
was not backward-compatible (the old code meets a schema it does not expect), and `VITE_SERVER_URL`
having changed since the older console build was made.

For anything a rollback cannot cleanly undo, fix forward.

## Environment variables

| Service | Variable | Note |
|---|---|---|
| server | `DATABASE_URL` | Railway Postgres connection string |
| server | `BETTER_AUTH_SECRET` | ≥ 32 characters, else the process fails at boot |
| server | `BETTER_AUTH_URL` | The **server's own** public origin |
| server | `CORS_ORIGIN` | The **console's** origin. Byte-matched against `Origin`; trailing slashes are stripped by the schema |
| server | `NODE_ENV` | `production` — this is what turns HSTS on |
| server | `LOG_LEVEL` | Optional; `info` in production |
| web | `VITE_SERVER_URL` | The API's origin, **inlined at build time** |
| both | `PORT` | Injected by Railway |

Two failure modes worth memorising, because neither produces a useful error:

**A wrong `CORS_ORIGIN` produces silence.** The response comes back with no
`Access-Control-Allow-Origin` header at all, the browser blocks it, and the server logs nothing
because nothing went wrong from its side.

**`up.railway.app` is on the Public Suffix List.** The two services are therefore different
*sites*, session cookies are cross-site, and `packages/auth` sets `SameSite=None; Secure` to suit.
Moving to custom domains under one parent domain would change that calculation.

## Shutdown behaviour

On `SIGTERM`, the server stops accepting connections, drains in-flight requests, closes idle
keep-alive sockets, and only then ends the database pool — in that order, because closing the pool
first would fail the very requests the drain exists to protect. There is a 10-second force-exit so
a stuck drain cannot outlive the platform's grace window.

This is what makes a redeploy safe mid-transaction: an aborted transaction rolls back completely,
and every write carries an idempotency key, so the caller's retry cannot double-post.

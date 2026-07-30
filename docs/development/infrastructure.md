# Infrastructure

The source of truth for how this project is provisioned and operated. Fill during `/init-project`. Use `none` or `N/A: <reason>` explicitly instead of assuming cloud, containers, Kubernetes, or IaC.

## Platform

| Concern | Choice / owner |
|---|---|
| Cloud / hosting provider | **Railway** — two services (`server`, `web`) plus a Railway Postgres, all from this repo |
| Accounts / subscriptions / projects | {{dev / staging / production boundaries}} |
| Regions / availability zones | {{...}} |
| Infrastructure as code | **Config-as-code only** — `apps/server/railway.json` and `apps/web/railway.json` (Railway schema). No Terraform/Pulumi; the Postgres, domains, and env vars are provisioned in the Railway dashboard |
| Container build/runtime | **Railpack** (Railway's default buildpack), driven by each app's `railway.json`. No Dockerfile |
| Orchestrator | PaaS — Railway manages the containers |
| Artifact / image registry | {{...}} |
| DNS / TLS owner | {{...}} |
| Secrets manager | {{...}} |

## Environments

| Environment | Purpose | Deployment source | Data policy | Access / approval |
|---|---|---|---|---|
| Local | {{...}} | {{...}} | {{fixtures/sanitized copy/none}} | {{...}} |
| Preview | {{N/A or ...}} | {{...}} | {{...}} | {{...}} |
| Staging | {{...}} | {{...}} | {{...}} | {{...}} |
| Production | {{...}} | {{...}} | {{...}} | {{...}} |

Keep credentials, databases, queues, caches, storage, provider accounts, and encryption keys isolated by environment. Never use production secrets or unsanitized production data for local/preview testing.

## Runtime resources

Document applicable services and ownership: compute, database, queue/broker, cache, object storage/CDN, scheduled jobs, email/provider dependencies, networking/VPC/firewalls, ingress/load balancing, and service identities. For each, record encryption, backup/retention, scaling, quotas, resource limits, and failure behavior.

## CI/CD and supply chain

- CI provider and workflow files: **GitHub Actions — `.github/workflows/ci.yml`** (added Phase 6a). One `verify` job on `ubuntu-latest`, triggered on push to `main` and on every pull request, with `concurrency` cancelling superseded runs on the same ref.
- Required checks and branch protection: the workflow runs the **same five commands** `docs/tasks/TEMPLATE.md` declares in its Verification block — `pnpm lint`, `pnpm check-types`, `pnpm test`, `pnpm build`, `node .claude/scripts/migration-integrity-guard.js --check` — in that order. The task template is the source of truth; if the two diverge, fix the workflow. Branch protection is **not** configured — it is a repository setting, not a file in this repo, and nothing here can assert it. Enabling it on `main` requiring the `verify` check would close that gap.
- Database for tests: **no `services:` block, deliberately.** `packages/db` and `packages/api` use `@testcontainers/postgresql`, which starts and migrates its own `postgres:18` container per suite (`packages/db/src/test/setup.ts`). They need a Docker **daemon**, which `ubuntu-latest` provides natively; a Postgres service container would sit idle next to the real one. The workflow asserts `docker info` succeeds before running any check, so a missing daemon fails loudly instead of letting 260 tests be skipped while the run still reports green.
- Environment variables in CI: `apps/server/.env` and `apps/web/.env` are gitignored, so a CI checkout has neither, and `packages/env` validates at import time with Zod. The workflow sets **schema-satisfying throwaway values** in `env:` rather than setting `SKIP_ENV_VALIDATION`. The skip flag would be shorter but disables validation wholesale, so a genuinely missing or malformed variable would pass unnoticed. These values are not secrets and must never be replaced with real ones.
- Build artifact/image naming, provenance, signing, and retention: **Railway-managed.** Railpack builds an image per service per deploy; naming, retention, and rollback history live in the Railway dashboard. Nothing is signed or pushed to a registry we own. GitHub Actions still builds only to verify compilation and discards the output.
- Deployment configuration: `apps/server/railway.json` and `apps/web/railway.json`. Both services use **repo root as the service root directory** (pnpm workspaces need the whole workspace to install) with the per-app `railway.json` set as the service's config path. `build.watchPatterns` list each app plus the workspace packages it actually consumes, so a `packages/ui` edit redeploys `web` and not `server`. Database migrations run in the server service's `deploy.preDeployCommand` (`drizzle-kit migrate`), once per deploy rather than per replica — which is why `numReplicas` is `1`.
- Required Railway variables: server needs `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `CORS_ORIGIN` (all validated at import by `packages/env`); web needs `VITE_SERVER_URL` **at build time** — Vite inlines it into the bundle, so changing it requires a redeploy, not a restart. `PORT` is injected by Railway and read by both apps.
- Dependency/container/IaC secret and vulnerability scans: **not configured.** No Dependabot, no `pnpm audit` gate, no container scanning. Tracked as a gap; nothing in the sandbox is deployed, so no runtime is exposed by it.
- Deployment approvals and environment protection: **Railway dashboard settings, not files in this repo.** `railway.json` cannot express approvals; nothing here can assert them. Deploys are triggered by pushes matching `build.watchPatterns`.
- Drift detection and policy-as-code: `N/A: no IaC and no managed infrastructure to drift from.`
- Permissions and secrets: the workflow declares `permissions: contents: read` and consumes **no repository secrets**. It only reads code; it never writes to the repo, publishes, or deploys.

Build once and promote the same immutable artifact where the platform permits it. Pin actions/images/modules to reproducible versions. CI receives least-privilege, short-lived credentials; forks and untrusted code must not receive deployment secrets.

## Reliability and recovery

- Availability/SLO target: {{...}}
- Autoscaling and capacity limits: {{...}}
- Backup schedule, retention, encryption, and owner: {{...}}
- Restore test cadence and last verified restore: {{...}}
- RPO / RTO: {{...}}
- Multi-region or disaster-recovery decision: {{...}}
- Cost budgets/alerts and resource ownership: {{...}}

## Status

- [ ] Every applicable infrastructure surface is declared or explicitly `N/A`
- [ ] Environment boundaries and secret ownership are documented
- [ ] CI/CD, rollback, backups/restore, observability, and incident ownership are linked
- [ ] IaC/container/deployment configuration has validation commands

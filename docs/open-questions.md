# Open questions & known limitations

Items that are unclear, partially implemented, not yet confirmed with stakeholders, or need external verification. Check here before assuming — and add here instead of guessing silently when a task surfaces something unconfirmed.

Closed rows are deleted rather than rewritten; the index at the bottom keeps their numbers resolvable and git history keeps the reasoning. Numbers are never reused, so gaps are expected.

---

## API gaps the console works around (opened Phase 5a)

| # | Item | Status | Action needed |
|---|---|---|---|
| 5 | **Rate-limit detail is in the response body, not a `Retry-After` header** (`ADR 0007`) | By design | The console reads `scope`, `limit`, and `retryAfterSeconds` from `data`. Nothing needed unless a non-console client appears, which would have to do the same |

---

## Frontend testing scope (opened Phase 5a)

| # | Item | Status | Action needed |
|---|---|---|---|
| 9 | **e2e coverage has no CI job and no viewer-role coverage.** 6 specs exist as of 2026-08-18 — the auth/tenant gate, the empty state, the sandbox walkthrough, account creation, and transfer + reversal — so the write flows are covered locally | Partially open | **(a)** No e2e job in CI: a job that has never been proven in CI should not be added on the strength of a local pass, and #10 blocks proving it. **(b)** No viewer-role coverage. The Phase 5 manual demo scripts are **not** retired and remain the record for the uncovered flows. Two rules the existing specs paid for: Base UI never unmounts a closed popup — it marks it `data-closed` and leaves it in the DOM — so `[data-slot="select-content"]` accumulates one match per select ever opened and becomes a strict-mode violation from the second picker onward; scope to `[data-open]`, of which at most one exists. And the acceptance bar for a new spec is *passes twice back to back*: creating an account navigates to its detail page, so a list assertion can pass once by beating the router and fail as soon as a second account exists |
| 10 | **There is no *working* CI.** ~~Resolved, Phase 6a~~ — **reopened 2026-08-16.** `.github/workflows/ci.yml` is correct and triggers on every push, but **not one run has ever executed a single check.** `gh run list` returns 15 runs from 2026-07-28 to 2026-08-16, every one `failure` in 3–9 seconds, every one annotated: *"The job was not started because your account is locked due to a billing issue."* | **Reopened 2026-08-16 — blocked externally** | **This row previously read "Resolved", and that is the failure worth recording.** A workflow file was written, committed, and marked done without anyone opening the Actions tab; the phase closed on the *existence* of the file rather than on a green run. Every "CI enforces this" claim written since — including #17 below, which debates whether the check is *required* — has been reasoning about a job that has never started. The five commands still pass locally, so nothing is known to be broken; what is missing is any evidence from a machine that is not this laptop. **Nothing in this repo can fix it:** billing is a GitHub account setting on the `Hoverla-Soft` org. Unblock billing, push once, and confirm a green run *before* re-marking this resolved. Until then treat every green check in this repo as local-only. The workflow itself uses **no Postgres service container** — the db/api suites drive `@testcontainers/postgresql`, which starts its own `postgres:18`, so what they need is a Docker daemon (`ubuntu-latest` has one), and the workflow asserts `docker info` first so a missing daemon fails loudly rather than skipping 260 tests. It also sets throwaway env values explicitly rather than `SKIP_ENV_VALIDATION`, so `packages/env`'s Zod validation stays exercised |

---

## Linting and CI (opened Phase 6a)

| # | Item | Status | Action needed |
|---|---|---|---|
| 17 | **CI runs but is not *required*.** `.github/workflows/ci.yml` executes on every push and PR, but branch protection on `main` is a GitHub repository setting, not a file, so nothing in this repo can enforce that a red run blocks a merge | Known limitation | Enable branch protection on `main` requiring the `verify` check. Until then CI reports, it does not gate. See also `docs/development/infrastructure.md` |
| 18 | **No SAST or secret scanning, and two dev-only advisories hold the `pnpm audit` gate at `high`.** `.github/dependabot.yml` (npm + github-actions) and a `pnpm audit --audit-level=high` step in `ci.yml` are in place; 2 moderate advisories remain | Partially open | Remaining: `esbuild` via drizzle-kit's deprecated `@esbuild-kit` chain, and `uuid@8.3.2` via `autocannon>hyperid`. Both need a major-version override that breaks its consumer, and **both are `devDependencies`** — a migration CLI and a benchmark tool, neither of which ships. Lower the gate to `moderate` once that list is empty. No SAST or secret scanning yet |

---

## Cross-currency exchange (opened Phase 7c)

| # | Item | Status | Action needed |
|---|---|---|---|
| 21 | **Nothing revalues an FX position or books a gain/loss.** The bridge accounts accumulate offsetting balances (`+100.00 USD` / `-92.00 EUR`) and no process ever marks them to a later rate | Not implemented, out of scope | This is real accounting rather than plumbing, and it needs a rate source to revalue *against* — which the sandbox deliberately does not have (see #22). The positions are at least visible rather than hidden, which is the prerequisite for doing it later |
| 22 | **There is no rate source; the caller states the rate.** Every exchange records whatever rate was supplied, and nothing checks it against a market | By design (`ADR 0010`) | Chosen over a hardcoded rate table (fiction that looks authoritative) and over a provider integration (a dependency, a network boundary, and non-deterministic tests in a fake-money sandbox). The ledger's job here is to record what was agreed. A provider would become worth it only if the sandbox needed to demonstrate a live-rate integration specifically |
| 23 | **A same-currency pair is refused rather than falling back to a plain transfer.** `422 same_currency_exchange` | By design | Accepting it would open a bridge pair in one currency and post two transactions where `transactions.create` posts one. The console's picker excludes same-currency destinations, so this is reachable only by calling the API directly |

---

## Database-level tenancy (opened 2026-08-16)

| # | Item | Status | Action needed |
|---|---|---|---|
| 30 | **Tenant isolation is enforced in `packages/api`, not in Postgres.** ADR 0005 governs the API layer: every repository query filters on `org_id`, and composite `(id, org_id)` foreign keys make a structurally cross-org *write* rejectable by the database. But a caller that talks to `packages/db` directly — a future job, a script, a migration helper — derives `org_id` itself, and nothing at the database level stops it *reading* across tenants | **Deliberately deferred**, with the shape written down | **Today this guards a caller that does not exist**: nothing outside `packages/api` uses `packages/db`. So it is defense in depth against a future mistake rather than a live hole, which is why it is recorded instead of built. If it is ever done, the fix is row-level security, and these are the constraints that make it more than a migration: (1) **`FORCE ROW LEVEL SECURITY` is required** — the table owner bypasses RLS otherwise, and the app connects as the owner today; (2) every transaction must `SET LOCAL app.current_org_id`, including inside `postTransaction`, or every query returns nothing; (3) **three paths need an explicit exemption** — Drizzle migrations, the Testcontainers harness (`packages/db/src/test/setup.ts` truncates every table between tests), and `sandbox.reset`, which deliberately reads every account in the org; (4) `listAccounts` stays unbounded for server-side callers (#7), so the policy has to admit it. Worth doing if the showcase wants to demonstrate DB-enforced tenancy rather than middleware-enforced; not worth doing as a bug fix |

---

## Resolved (index only — kept so cross-references still resolve)

Full reasoning for each is in git history; the durable decisions live in the ADRs, `docs/development/architecture.md`, and the docs each row names.

| # | Item | Closed |
|---|---|---|
| 1 | No procedure returns the caller's role | 2026-08-16 — `session.context` on `orgProcedure` |
| 2 | `transactions.list` returns no amounts and no postings | 2026-07-28 — Phase 6b, `transactionWithPostingsSchema` |
| 3 | No reverse lookup for reversals; reversal not deduplicated | 2026-08-16 — `reversedBy` (6b) + unique partial index, migration `0007` |
| 4 | A replayed write is indistinguishable from a fresh one | 2026-08-01 — `replayed: boolean` on posted transactions |
| 6 | `audit.list` has no cursor and caps at 200 entries | 2026-07-29 — Phase 7a, shared `pageAuditTable` |
| 7 | `accounts.list` / `reconciliation.verify` unpaginated | 2026-07-29 — Phase 7a; `listAccounts` stays unbounded server-side |
| 8 | There is no `accounts.deactivate` | 2026-08-18 — `accounts.deactivate` / `reactivate` on `adminProcedure` |
| 11 | `pnpm lint` is documented but does not exist | 2026-07-28 — Biome 2.5.6, one root pass |
| 12 | `docs/development/work-systems.md` is an unfilled template | 2026-08-16 — filled: no external work systems |
| 12b | `docs/development/skills-and-plugins.md` is an unfilled template | 2026-08-17 |
| 13 | `packages/ui` contains unused chat-UI scaffolding | 2026-08-01 |
| 14 | `apps/web` does not extend `packages/config/tsconfig.base.json` | 2026-07-28 — 0 errors, ten-line config edit |
| 15 | `packages/ui` emits utility classes defined nowhere | 2026-08-16 — real platform font stack, dead tokens stripped |
| 16 | `pnpm lint` exits 0 with 26 diagnostics outstanding | 2026-08-16 — `biome check --error-on-warnings .` |
| 19 | `apps/web` suite is timing-sensitive under parallel load | 2026-08-16 — `testTimeout: 15_000`, deliberately not `retry` |
| 20 | Reversing one leg of an exchange leaves the other standing | 2026-08-18 — either leg unwinds the pair through `postExchange`; ADR 0010 amendment |
| 24 | Thin maker-checker for transfers | 2026-08-01 shipped; server-side enforcement 2026-08-16 (#25) |
| 25 | Maker-checker enforced only in the browser | 2026-08-16 — `directPostProcedure` rung, `403 approval_required` |
| 26 | `approvals.approve` can post the same pending transfer twice | 2026-08-16 — idempotency key derived from `pending.id` |
| 27 | A per-amount bound is not a per-balance bound | 2026-08-17 — `applyLeg` → `422 balance_limit_exceeded`; `MAX_MINOR_UNITS` in `db/limits` |
| 28 | Operational hardening absent in `apps/server` | 2026-08-17 — drain/close, `/ready`, 1 MB body limit, three timeouts |
| 29 | `approvals.listPending` truncates at 100 rows with no cursor | 2026-08-17 — ascending cursor on `(created_at, id)` |

---

Add a new `## Domain area` section per area rather than one giant table — makes it scannable, and `integration-spec-guard`/`backend-architecture-guard` reference specific sections when they flag something as "should be logged as an open question" instead of assumed.

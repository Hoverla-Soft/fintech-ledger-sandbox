# Task: Phase 5b — tenant gate, console shell, and the UI-state trio

## Goal

Make every org-scoped call in Phase 5 actually reach the server, and make the boundary failures render as the right thing.

Today `apps/web/src/lib/auth-client.ts:31-35` calls `createAuthClient` with **no `plugins` array at all**, so `organizationClient()` is unwired and `activeOrganizationId` appears **zero times** anywhere under `apps/web`. Every `orgProcedure` therefore returns `403 no_active_organization` (`packages/api/src/procedures.ts:67`) for every browser user. No console screen in 5c–5g can work until this slice lands — it is the single blocker for the rest of the phase.

It also ships the loading/empty/error trio `docs/product/requirements/ledger.md:73-75` requires, rewires the query client off the server's `message` and onto 5a's reason map, and clears the Better-T-Stack scaffolding the later slices would otherwise inherit.

## Status

Human Review

## Scope (allowed paths)

**`apps/web` — session, tenancy, shell:**

- `apps/web/src/lib/auth-client.ts`
- `apps/web/src/lib/org/**`
- `apps/web/src/utils/orpc.ts`
- `apps/web/src/routes/__root.tsx`
- `apps/web/src/routes/index.tsx`
- `apps/web/src/routes/login.tsx`
- `apps/web/src/routes/_auth/route.tsx`
- `apps/web/src/routes/_auth/dashboard.tsx`
- `apps/web/src/routes/_auth/organization.tsx`
- `apps/web/src/routeTree.gen.ts`
- `apps/web/src/components/shell/**`
- `apps/web/src/components/states/**`
- `apps/web/src/components/header.tsx`
- `apps/web/src/components/user-menu.tsx`
- `apps/web/src/components/sign-in-form.tsx`
- `apps/web/src/components/sign-up-form.tsx`
- `apps/web/package.json`
- `apps/web/tsconfig.json`

**Shared UI (just-in-time primitives only):**

- `packages/ui/src/components/alert.tsx`
- `packages/ui/src/components/separator.tsx`
- `packages/ui/src/styles/globals.css`

**Documentation:**

- `docs/adr/0009-console-session-and-tenant-model.md`
- `docs/adr/README.md`
- `docs/frontend/ui-states.md`
- `docs/frontend/frontend-architecture.md`
- `docs/development/tech-stack.md`
- `docs/open-questions.md`
- `docs/test-coverage.md`
- `docs/tasks/2026-07-28-phase-5b-tenant-gate.md`

## Out of scope

- **Every ledger screen.** Accounts (5c), transfer (5d), history and reversal (5e), reconciliation and sandbox (5f), audit (5g). This slice adds exactly one throwaway probe — an account *count* — to prove an `orgProcedure` call now succeeds from a browser; 5c replaces it with the real list.
- **`apps/web/src/lib/ledger/**`.** 5a closed that kernel. If a defect is found in it, stop and re-scope rather than editing it here.
- **`privateData`'s removal from `packages/api`.** This slice removes the last *consumer*; deleting the procedure is 5h, because it drags `procedures.test.ts` and `no-org-input.test.ts`'s pinned procedure count with it.
- **Deleting `packages/ui`'s unused chat scaffolding** (`bubble`, `message`, `message-scroller`, `attachment`, `marker`). Logged as open question #13; deleting working files needs an explicit decision.
- **A role-returning API procedure.** Open question #1. The role is derived client-side here, as an affordance hint only.

## Related docs

- `docs/adr/0005-tenant-isolation.md`
- `docs/product/roles-and-permissions/ledger.md`
- `docs/backend/error-handling.md`
- `docs/product/requirements/ledger.md#frontend-console--phase-5`

## External sources

- Task/issue: N/A: local phase task, no external tracker configured.
- Product documentation: `docs/product/requirements/ledger.md` (local, authoritative).
- Design: N/A.

## Approved decisions

**D1 — the console derives its role client-side; it does not gain an API procedure for it.** No procedure returns the caller's role; it exists only in middleware context (`packages/api/src/procedures.ts`). Adding one would reopen `packages/api` and drag `no-org-input.test.ts`'s pinned procedure count into a frontend slice. So `lib/org/role.ts` mirrors `toLedgerRole`'s mapping exactly — `owner`/`admin` → admin, comma-lists take the write role, **anything unrecognised → viewer** — and a test asserts the two agree.

This is an **affordance hint only**. `docs/product/roles-and-permissions/ledger.md:64` is unambiguous: *"'The frontend hides the button' is not enforcement anywhere in this system."* Every write path in 5c–5g still handles `403 insufficient_role`, because the role is re-read from the `member` row on every request and can be revoked mid-session with no sign-out (`ledger.md:68`). Recorded as open question #1 so a future `session.context` procedure can replace the duplicated mapping.

**D2 — `403 no_active_organization` is a redirect, not an error screen.** `ledger.md:70` — *"the console is expected to route them to org creation rather than treat it as an error."* It is the normal state of a user who has just signed up. `not_a_member` renders as loss of access and **never** as "that organization does not exist", which would make the console an existence oracle for another tenant (`ADR 0005`).

**D3 — switching organization and signing out both clear the query cache.** The TanStack Query cache is keyed by procedure and input, never by tenant, so org A's rows stay resident when org B renders. Today even *sign-out* does not clear it (`apps/web/src/components/user-menu.tsx:44-53`). `queryClient.clear()` plus `router.invalidate()` on both paths.

**D4 — `noUnusedLocals` is enabled here, the slice that owns its one violation.** Deferred from 5a, where `apps/web/src/routes/__root.tsx:45`'s dead second oRPC client was out of Scope. This slice rewrites that file, so the flag and its fix land together. Open question #14 is updated.

## Design

### The four boundary states the guard must distinguish

| Condition | Detected | Outcome |
|---|---|---|
| No session | `_auth` `beforeLoad` | Redirect to `/login`, carrying a return-to so the user lands where they meant to |
| Session, no active org | `_auth` `beforeLoad` | Redirect to `/organization` — a normal state, not a failure (D2) |
| Session, active org, membership revoked | `403 not_a_member` from a query | Loss-of-access state with a way to switch org; never "does not exist" |
| Session, active org, member | — | Render |

Only the first two are knowable before a request. `not_a_member` is only discoverable by asking the server, because membership lives in a `member` row the client cannot see — which is exactly ADR 0005's design.

### Modules

| Module | Responsibility |
|---|---|
| `lib/auth-client.ts` | Adds `organizationClient()`, unlocking `organization.create` / `list` / `setActive` |
| `lib/org/role.ts` | Better Auth role string → `admin`/`viewer`, fail-closed, mirroring `toLedgerRole` |
| `lib/org/session.ts` | Reads the active org id and the caller's role off the session; clears the cache on switch and sign-out |
| `components/states/` | The loading / empty / error trio, error visually distinct from empty and carrying a working retry |
| `components/shell/` | Header, nav, org switcher, user menu — moved out of the flat `components/` root |
| `routes/_auth/organization.tsx` | Create-first-org and switch-org |
| `utils/orpc.ts` | Query and mutation caches routed through 5a's `describeFailure`; no `error.message` anywhere |

## Acceptance criteria

- `organizationClient()` is wired; `activeOrganizationId` is read from the session rather than being absent from the app.
- A brand-new sign-up lands on `/organization`, creates an org, and reaches a console page that **successfully calls `accounts.list`** — the first moment any `orgProcedure` is reachable from a browser.
- Role mapping matches `toLedgerRole` exactly, asserted case-by-case: `owner`→admin, `admin`→admin, `member`→viewer, `"admin,member"`→admin, `" Owner "`→admin, `""`→viewer, unknown→viewer.
- The guard's four branches each produce their documented outcome; the login redirect preserves a return-to; `/login` bounces an already-signed-in user away.
- `queryClient.clear()` runs on org switch **and** on sign-out; a test asserts the cache is empty afterwards.
- Synthetic `no_active_organization`, `not_a_member`, `insufficient_role`, bare `401`, and `400 {issues}` payloads each map to a distinct outcome, and **none renders the raw server `message`**.
- The error state is visually distinct from the empty state and its retry refetches.
- `noUnusedLocals` is on and `check-types` is green; the dead oRPC client, the `TITLE_TEXT` banner, and `@hookform/resolvers` are gone.
- `privateData` has no consumer left in `apps/web` (`grep` returns nothing); the procedure itself stays until 5h.
- ADR 0009 records how the console learns its active org and role given that no procedure returns either.

## Verification

```bash
pnpm lint        # N/A: no linter is wired in this repo yet (Biome/oxlint planned)
pnpm check-types
pnpm test
pnpm build
node .claude/scripts/migration-integrity-guard.js --check
```

Baseline to beat, measured after 5a: `check-types` 6/6, `test` 424 passed (73 core + 91 web + 28 db + 232 api), `build` 2/2, guard PASS. Report per-package counts so a shrunk suite is visible.

**Result, verified 2026-07-28:**

| Check | After 5a | After 5b |
|---|---|---|
| `check-types` | 6/6 | **6/6 green**, now with `noUnusedLocals` on |
| `build` | 2/2 | **2/2 green** |
| `test` — `packages/core` | 73 | **73** (untouched) |
| `test` — `packages/db` | 28 | **28** (untouched) |
| `test` — `packages/api` | 232 | **232** (untouched) |
| `test` — `apps/web` | 91 | **126** (+23 role agreement, +12 UI states) |
| `test` — total | 424 | **459 passed** |
| migration integrity guard | PASS | **PASS** (exit 0) |

`pnpm lint` — `N/A`, no linter is wired in this repo yet.

`grep -rn "privateData" apps/web/src` returns only a comment in `dashboard.tsx` explaining the removal — no consumer remains, so 5h can delete the procedure without touching `apps/web`.

These are the first **rendering** tests in the repo: 5a installed the happy-dom + Testing Library harness but used only its Node half, so this slice is the first proof the DOM half works.

**Manual demo** (there is no e2e harness — this is acceptance criteria, not commentary). Requires `pnpm db:start` and `pnpm dev`:
1. Sign up as a new user → land on `/organization`, not an error.
2. Create an org → reach the console; the account count renders (proving `accounts.list` returned rather than 403'd).
3. Create a second org, switch to it → the count refetches and shows no data from org one.
4. Sign out and back in → no residue from the previous session.
5. Stop the API server → the error state appears, is distinct from empty, and its retry works once the server is back.

## Retention

When this reaches `Done`, move it to `docs/tasks/archive/2026/` and **delete `.claude/.active-task-scope.json`** — nothing clears it automatically, and a stale one blocks 5c's first edit.

## Spec completeness checklist

### Common
- [x] Actor(s) defined — org admin and org viewer (`docs/product/requirements/ledger.md:34-35`); also the signed-in user with no org yet, which is the normal post-sign-up state.
- [x] Entry point defined — `/login`, `/organization`, and the `_auth` layout guarding every console route.
- [x] Preconditions described — a running API and database; Better Auth's `organization` plugin is already registered server-side (`packages/auth/src/index.ts:35`).
- [x] Happy path described — sign in → active org resolved → console renders with a successful org-scoped call.
- [x] Error paths described — the four-branch table above, plus the five synthetic payloads in Acceptance criteria.
- [x] Permissions considered — role derived client-side as an affordance hint only (D1); enforcement stays server-side and every write still handles `403 insufficient_role`.
- [x] Acceptance criteria written
- [x] Tests defined
- [x] Out of scope stated explicitly

### Backend
- [x] API endpoints defined — N/A: this slice adds and changes no procedure. It consumes existing `accounts.list` as a readiness probe and Better Auth's own `organization.*` client endpoints.
- [x] Validation described — N/A: no new input contract. Org creation is validated by Better Auth's own schema.
- [x] Error responses defined — consumes the published contract; the reason→copy map shipped in 5a.
- [x] Side effects listed — a Better Auth session update on `setActive`; a query-cache clear on switch and sign-out. No ledger writes.

### Frontend
- [x] Loading state defined — skeletons on every fetch, shipped as `components/states/` (`ledger.md:73`).
- [x] Empty state defined — distinct, with a next action; the no-organization case routes to creation rather than rendering empty.
- [x] Error state defined — visually distinct from empty, carries a working retry (`ledger.md:75`).
- [x] Navigation after each action defined — sign-in → return-to or console; create org → console; switch org → current route, refetched; sign-out → `/`.
- [x] Feedback defined — toast on successful org create/switch; inline reason on failure; the shell renders `not_a_member` as loss of access rather than a toast.

---

*Started 2026-07-28. If scope needs to expand mid-task, stop and update this section explicitly rather than just editing outside it — the hook will block it either way, so updating here is the only path forward.*

*Phase 5 slice 2 of 8. Predecessor: 5a (console kernel, Done). Successors: 5c accounts · 5d transfer · 5e history + reversal · 5f reconciliation + sandbox · 5g audit · 5h retire `privateData`.*

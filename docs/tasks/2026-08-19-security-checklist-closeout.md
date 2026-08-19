# Close the outstanding ⚠️ rows in the security checklist

## Goal

`docs/showcase/security.md` carries four ⚠️ rows. Establish which are real, fix the ones that
are, and correct the ones that are stale. No row moves to ✅ without a test or a verified
observation behind it.

Findings from investigation, before any edit:

| Row | Verdict |
|---|---|
| Rate-limit response headers & shared counters | **Half real.** No `Retry-After`/`RateLimit-*` headers is a genuine, closeable gap. The in-process counter is a deliberate single-process boundary, not a defect. Split the row. |
| Database pool bounds | **Stale.** `createDb` already sets `statement_timeout` (10s), `idle_in_transaction_session_timeout` (30s), and `connectionTimeoutMillis` (5s), with the reasoning written out. The doc never caught up. |
| Operations runbook | **Real.** 12 unfilled `{{...}}` in `runbook.md`, 8 in `deployment.md`. |
| Scalar docs page under CSP | **Real, and now proven.** A live browser load of `/api-reference` blocks **14** webfonts from `fonts.scalar.com`: `default-src` has no `font-src` sibling, so the fallback applies and every Inter/JetBrains Mono face fails. The row predicted this exact failure and it is happening in production. |

## Scope (allowed paths)

- `docs/tasks/2026-08-19-security-checklist-closeout.md`
- `apps/server/src/app.ts`
- `apps/server/src/app.test.ts`
- `packages/api/src/rate-limit.ts`
- `packages/db/src/index.ts`
- `apps/web/src/lib/ledger/errors.ts`
- `apps/web/src/lib/ledger/errors.test.ts`
- `docs/adr/0007-rate-limiting.md`
- `docs/operations/runbook.md`
- `docs/operations/deployment.md`
- `docs/showcase/security.md`

## Out of scope

- Any distributed rate-limit store. It would need a new declared dependency for a
  single-process sandbox; the limitation stays documented instead.
- The nine dangling `docs/open-questions.md` citations in source comments outside the files
  above. Pre-existing, tracked separately.
- Anything touching the ledger write path, tenancy, or migrations.

## Acceptance criteria

1. `/api-reference` loads in a real browser with **no blocked webfont**, verified by re-running
   the browser check rather than by reading the policy. Any violation that remains must be one
   we are choosing to keep, and must be written down as such.
2. The JSON surface keeps `default-src 'none'`. The font relaxation must not follow the docs
   page off its own path — asserted by test.
3. A `429` carries `Retry-After` and `RateLimit-*` headers, and the body contract is unchanged
   so existing clients keep working.
4. `runbook.md` and `deployment.md` contain no `{{...}}` placeholders. Ownership reflects
   reality (solo sandbox, no paging rotation) rather than an invented org chart.
5. `security.md` rows match the code. The multi-replica counter stays ⚠️.
6. Full verification suite green.

## Verification

```bash
pnpm lint
pnpm check-types
pnpm test
pnpm build
node .claude/scripts/migration-integrity-guard.js --check
```

Plus a live browser load of `/api-reference`, checking which resources the bundle actually
fetches rather than which ones the policy names.

## Status

**Done.** Three of four rows converted to ✅; the fourth was narrowed to what is actually
outstanding.

| Row | Outcome |
|---|---|
| Rate-limit headers | ✅ `withRateLimitHeaders` projects `Retry-After` and three `RateLimit-*` headers from the existing `data` block, only on a `429`, and names them in `Access-Control-Expose-Headers` so the cross-origin console can actually read them. ADR 0007 amended. |
| Rate-limit counters | ⚠️ **kept**, split into its own row. Replica-safety needs a shared store, which needs a dependency this sandbox has no other use for. A deliberate boundary, now labelled as one. |
| Database pool bounds | ✅ Row was stale — the bounds have been in `createDb` for some time. Documented what is actually there, including why the statement timeout is 10s and not 1s. |
| Operations runbook | ✅ Both `runbook.md` and `deployment.md` written against the real deployment. Zero `{{...}}` remaining. Rollback and backup restore are labelled **untested**, because they are. |
| Scalar CSP | ✅ The row's suspicion was right. A browser load blocked 14 webfonts; `font-src` falls back to `default-src`, so the policy looked complete. Fixed and re-verified in a browser. |

### What the browser found that reading the policy could not

Two things, and the second only appeared *after* the first was fixed.

The 14 blocked fonts came from `fonts.scalar.com` — a host that appears nowhere in the HTML the
plugin emits, which is why reading the renderer (how the jsDelivr entry was originally found)
missed it. The page still rendered, in a fallback system font, so nothing failed loudly.

With fonts allowed, the bundle then revealed calls to `api.scalar.com` for its registry search and
"Ask AI" panel. Those are **left blocked**. The reference renders completely without them, and
widening `connect-src` so a documentation page can reach a vendor's API is a worse trade than
losing a feature nobody here uses. Disclosed in the checklist rather than quietly allowed.

The general lesson, worth keeping: a CSP is not verified until something has executed under it.

### Verification

- `pnpm lint`, `pnpm check-types`, `pnpm test`, `pnpm build`, migration guard — see below.
- `apps/server` suite: 13 → 17 tests.
- Live browser load of the patched `/api-reference`: no blocked font, all operations rendered,
  Inter and JetBrains Mono resolved.

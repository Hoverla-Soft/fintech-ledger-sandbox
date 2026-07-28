# Open questions & known limitations

Items that are unclear, partially implemented, not yet confirmed with stakeholders, or need external verification. Check here before assuming — and add here instead of guessing silently when a task surfaces something unconfirmed.

---

## API gaps the console works around (opened Phase 5a)

Each of these is a capability the console needs and the API does not currently provide. None is a defect: the API is correct as specified, and the console has a working — sometimes visibly compromised — answer for each. They are recorded so the compromise is a decision on the record rather than an accident, and so Phase 6 has a shortlist.

| # | Item | Status | Action needed |
|---|---|---|---|
| 1 | **No procedure returns the caller's role.** *(Phase 5b: worked around client-side; see `docs/adr/0009-console-session-and-tenant-model.md`.)* `role` is derived inside `requireOrg` and lives only in middleware context (`packages/api/src/procedures.ts`). The console cannot ask the API "am I an admin here?" | By design, with a client-side workaround | Phase 5b derives the role client-side from Better Auth's member data, mirroring `toLedgerRole`'s fail-closed mapping. It is an affordance hint only; every write still handles `403 insufficient_role`. A role-returning read procedure would remove the duplicated mapping |
| 2 | **`transactions.list` returns no amounts and no postings.** *(Phase 5e shipped the history screen without them, as decided.)* It returns `transactionSchema`, so a history table can show id, currency, actor, timestamp, and reversal marker — but not what moved | By design (decided 2026-07-28) | Accepted for Phase 5: amounts appear on transaction detail only. The alternative — an N+1 `transactions.get` per row — was rejected because it fans out up to 200 membership-checked requests per page against an endpoint deliberately shaped to avoid that. The real fix is returning `transactionWithPostingsSchema`, which reopens the Phase 4b wire contract and belongs in its own backend task |
| 3 | **No reverse lookup for reversals.** *(Phase 5e: surfaced honestly in the reversal confirmation rather than worked around.)* `reversesTransactionId` is a forward pointer: it says whether a transaction *is* a reversal, never whether one *has* been reversed. `transactions.list` is forward-only and capped at 200, so it cannot be walked to find out | By design | The console cannot warn "this was already reversed" — `docs/adr/0006-write-endpoint-contract.md:42` assumes a capability that does not exist. Phase 5e ships typed-confirmation friction instead, stating plainly that reversals are unbounded and not deduplicated. A `reversedBy` field would close it |
| 4 | **A replayed write is indistinguishable from a fresh one.** `transactions.create` and `.reverse` return `200` with the original `transactionId` and no replay flag, and the balances on a replay are read live rather than as-of-posting (`ADR 0006`) | By design | The console labels balances "current", never diffs a replay against a cached original, and never renders a "changed since you posted" warning it cannot substantiate. A `replayed: boolean` on the response would let the UI say something true and useful |
| 5 | **Rate-limit detail is in the response body, not a `Retry-After` header** (`ADR 0007`) | By design | The console reads `scope`, `limit`, and `retryAfterSeconds` from `data`. Nothing needed unless a non-console client appears, which would have to do the same |
| 6 | **`audit.list` has no cursor and caps at 200 entries.** The log is not walkable past its most recent 200 | Known limitation | Phase 5g states the ceiling in the UI rather than implying completeness. Cursor pagination would close it |
| 7 | **`accounts.list` and `reconciliation.verify` return every account, unpaginated and unfiltered.** Reset may add a `Sandbox Suspense <CUR>` external account per currency per partial chunk (`ADR 0008`), so the set grows across sandbox cycles | Known limitation | Tolerated and labelled for now. Pagination or filtering would be needed before an org could hold a large number of accounts |
| 8 | **There is no `accounts.deactivate`.** An account can be created and can become inactive, but no procedure closes one | Not implemented | The console offers no close action. Add the procedure if closing an account becomes a product requirement |

---

## Frontend testing scope (opened Phase 5a)

| # | Item | Status | Action needed |
|---|---|---|---|
| 9 | **No end-to-end tests.** Playwright is declared as planned in `docs/development/tech-stack.md` but is not installed. `apps/web`'s automated coverage is component- and unit-level (Vitest + happy-dom + Testing Library, added Phase 5a); no test drives a real browser against a running server and database | Deliberate deferral, recorded per `docs/development/testing-rules.md` | Each Phase 5 slice carries a numbered manual demo script as acceptance criteria to cover the gap. Installing Playwright would replace those with automation |
| 10 | **There is no CI.** `.github/` contains only `ISSUE_TEMPLATE/`, so no check runs on push and the verification block is executed by hand | Known limitation | A workflow running the same five commands would close it |

---

## Documentation and tooling debt (opened Phase 5a)

| # | Item | Status | Action needed |
|---|---|---|---|
| 11 | **`pnpm lint` is documented but does not exist.** `CLAUDE.md` lists it and `turbo.json` defines the task, but no package implements it | Known limitation | Task verification blocks write `N/A: no linter is wired in this repo yet`. Wiring Biome or oxlint would close it |
| 12 | **`docs/development/work-systems.md` is an unfilled template.** Task files therefore record `N/A: no external tracker configured` for external sources | Not operational | Fill it if an external tracker, docs system, or design source is adopted |
| 13 | **`packages/ui` contains unused chat-UI scaffolding** — `bubble`, `message`, `message-scroller`, `attachment`, `marker` — with no consumer in `apps/web`. `message-scroller` is the only importer of the `@shadcn/react` dependency | Known limitation | Left in place deliberately: deleting working files needs an explicit decision. If removed, port `markerVariants`' class string first — it is the package's only divider |
| 14 | **`apps/web` does not extend `packages/config/tsconfig.base.json`.** Phase 5a adopted `verbatimModuleSyntax` and `noUnusedParameters`; **Phase 5b added `noUnusedLocals`** together with the fix for its one violation (the dead second oRPC client in `routes/__root.tsx`). `noUncheckedIndexedAccess` is still off | Partially resolved | `noUncheckedIndexedAccess` is deferred to the end of Phase 5 so it does not blur every slice's diff — cursor stacks, posting arrays, and paginated lists all index |
| 15 | **`packages/ui` emits utility classes that are defined nowhere** — `cn-font-heading`, `cn-menu-target`, `cn-menu-translucent`, `cn-toast`, `cn-rtl-flip`, `scrollbar-thin`, `scrollbar-none` — and `--font-sans: "Inter Variable"` is never loaded | Known limitation, **not** resolved in 5b as originally planned | 5b was expected to fix these alongside its new primitives and deliberately did not. They are no-ops rather than defects — an undefined class applies nothing, so the affected elements simply inherit — and inventing styles for `cn-menu-translucent` or `cn-rtl-flip` without knowing the intended design would replace a harmless no-op with a wrong opinion that later slices then build on. The right fix is to either regenerate the affected components from the shadcn registry that expects these classes, or strip the class names; both are `packages/ui` work with no console consumer waiting on them |

---

Add a new `## Domain area` section per area rather than one giant table — makes it scannable, and `integration-spec-guard`/`backend-architecture-guard` reference specific sections when they flag something as "should be logged as an open question" instead of assumed.

# UI states

The concrete patterns behind `docs/development/coding-rules.md`'s async section and `docs/product/FEATURE-CHECKLIST.md`'s frontend checks (loading/empty/error states). `frontend-fetch-guard` and `ui-ux-agent` check against what's described here.

`docs/product/requirements/ledger.md:73-77` is the product contract; this file is how it is implemented. Filled in Phase 5b, which shipped the primitives.

The primitives live in `apps/web/src/components/states/`. Screens compose them through `QueryState` rather than hand-rolling the branches, because the *precedence* between them is where this goes wrong.

## Loading

**Every fetch renders a skeleton.** Not a spinner, and not nothing.

`LoadingRows` renders skeleton blocks sized to the content they stand in for, so the layout does not jump when data lands. It carries `aria-busy` and a visually-hidden "Loading…" so the state is not silent to a screen reader.

A balance that has not loaded must never render as `0`. Zero is a real, meaningful balance in a ledger — an account that genuinely holds nothing — and showing it while data is in flight tells the user something false about their money.

## Empty

**Distinct from error, and always with a next action.**

`EmptyState` takes `action` as a required prop deliberately. An empty state that only says "no data" leaves the user to guess; every empty surface in this console has an obvious next step — create an account, seed the sandbox, post the first transfer.

Empty means *the server answered, and the answer was nothing*.

## Error

**Visually distinct from empty, and it carries a retry.**

`ErrorState` renders through `Alert variant="destructive"` with `role="alert"`, so it interrupts a screen reader — this is a state change the user did not ask for.

Two rules it enforces so no screen has to remember them:

- **It takes the raw thrown value, not a string.** Callers cannot accidentally render `error.message`. The server's message is a fixed per-branch string chosen to leak nothing, is written for an operator rather than a user, and is explicitly *not* a client contract (`docs/backend/error-handling.md`). `describeFailure` is the single translation point.
- **It reads rate-limit detail from the body.** There is no `Retry-After` header (`docs/adr/0007-rate-limiting.md`); `retryAfterSeconds` arrives in `data`, and the error state surfaces it as a concrete wait.

### The precedence rule, which is the whole point

`QueryState` checks **error before empty**, and this ordering is load-bearing.

A failed query has `data === undefined`. An empty-first branch therefore renders "nothing here yet" when the server is unreachable. In a ledger those two states mean opposite things:

- *empty* → you have no accounts; create one
- *error* → we could not reach the ledger; **the balances on this screen may be nothing at all**

Conflating them is how a user concludes their money has disappeared. `states.test.tsx` asserts the precedence directly, including the settled-but-undefined case, which is treated as an error rather than as empty.

## Navigation after an action

- Successful transfer → transaction detail with the updated balances (5d).
- Cancel → back to the list, nothing written.
- Create organization → the console, with the new org already active.
- Switch organization → stay on the current route, refetched against the new tenant.
- Sign out → the public landing page, with the query cache cleared.

**Drawers, dialogs, and modals close only after the request resolves** (`ledger.md:76`). Closing optimistically shows a success the server has not agreed to yet, and in this domain the difference between "posted" and "about to be rejected for insufficient funds" is the entire product.

## Feedback

| Outcome | Where it appears |
|---|---|
| Success | Toast |
| Validation failure, insufficient funds, and anything else the user can fix | **Inline, in the form, which stays open and populated** |
| Rate limited | Inline, with the wait from the response body — the form stays open |
| Role, membership, or idempotency conflict | Toast, because the form cannot fix it |
| Failed read | In place, where the data would have been, with a retry |

`keepsFormOpen` decides the first four from the failure's disposition. It deliberately covers `retryable` as well as `fix_input`: a throttled submit is not the user's fault and resolves in seconds, so discarding everything they typed would be gratuitous.

Failed reads are **not** toasted. The screen already renders the failure where the data would have been, with a retry next to it; a toast as well would double-report every failure. The query cache toasts only session-level failures, which no single screen owns.

# Forms and validation

Referenced from `docs/development/coding-rules.md`'s Forms section — this is where the specifics live. Filled in Phase 5c, which shipped the console's first real write form.

## The library

`@tanstack/react-form`, with raw Zod schemas as Standard Schema validators (`docs/development/tech-stack.md`). Simple controlled forms — the create-account dialog — use plain `useState` instead; a form library earns its place when there is cross-field validation or array state, not for three inputs.

## Where validation lives

**Three layers, and only one of them is authoritative.**

1. **The domain** (`packages/core`) owns the invariants. Balanced legs, currency agreement, positive amounts, sufficient funds.
2. **The API boundary** (`packages/api`) owns the request contract — Zod schemas on every procedure input.
3. **The form** mirrors layer 2 to give fast feedback, and is *never* trusted.

The form's copy of a rule exists to save a round trip, not to enforce anything. Every constraint it applies must be one the server also applies, and every rejection the server can produce must have somewhere to render — including ones the UI believes it has made unreachable.

### Mirror the published contract; do not restate it loosely

The account name cap is `120` because `accounts.create`'s input schema says `z.string().min(1).max(120)`. Where a value can be *enumerated*, take it from the source rather than retyping it: the currency picker is populated from `CURRENCIES` (`@fintech-ledger-sandbox/core`), so a code the ledger has no minor-unit exponent for cannot be chosen. `docs/adr/0002-money-representation.md` exists because a guessed exponent is a silent 100× error.

**Wire the branch anyway.** The currency wire type is `z.string()`, and a stale client is possible, so `422 unsupported_currency` is handled even though the picker makes it unreachable. A validation path with no test and no UI is a validation path that does not exist.

## Server errors are field errors

The console's inline errors are mostly *server decisions about money* — `409 account_name_taken`, `422 insufficient_funds` — not client-side shape checks. They arrive after a request and must land on the field that caused them.

- `data.reason` → field, via a small pure mapper per form (`features/accounts/field-errors.ts`). Split out of the component so the routing decision is unit-testable without a DOM.
- `400 {issues}` → each issue's `path[0]` selects its field.
- Anything not about a field (`insufficient_role`, `rate_limited`) returns no field error; the form decides what to do from the failure's *disposition*, not its reason.

Never render `error.message`. It is a fixed operator-facing string and explicitly not a client contract (`docs/backend/error-handling.md`). Everything goes through `describeFailure`.

### Accessibility is part of this, not a polish pass

A red sentence under an input is invisible to a screen reader user, who hears "Name, edit text" and no indication the value was rejected. `Field` / `FieldError` / `fieldControlProps` (`packages/ui`) wire `aria-invalid` and `aria-describedby` together, and the error carries `role="alert"` so a rejection arriving after submit is announced rather than silently painted. Spread `fieldControlProps` onto the control so a caller cannot forget it.

## Submission rules

These are behavioural requirements from `docs/product/requirements/ledger.md`, not preferences:

- **Submit is disabled for the whole in-flight window.** Double-submitting a write is how you post twice.
- **The dialog closes only after the request resolves.** Closing on submit shows a success the server has not agreed to — and in this domain the gap between "posted" and "rejected for insufficient funds" is the entire product.
- **A dismiss cannot race an in-flight request.** `onOpenChange` refuses to close while pending; otherwise the write may still land and the user is left looking at a list that does not show it.
- **A failed mutation keeps the form open and populated,** with the reason inline — for anything the user can fix *and* anything transient. A throttled submit is not the user's fault; discarding what they typed would be gratuitous. `keepsFormOpen` encodes this.
- **Clear prior server errors on resubmit,** so a stale `account_name_taken` does not sit under a name the user has since changed.
- **Invalidate, do not hand-patch the cache.** A write changes more than the row it returned; the server is the authority on what a list contains.

## Idempotency (writes that move money)

`accounts.create` needs none — it takes no idempotency key and writes no audit entry (`docs/adr/0006-write-endpoint-contract.md`). That is exactly why it was the right form to build first: it proves the pipeline with a failure mode that is a duplicate name rather than a duplicate payroll.

Forms that call `transactions.create` or `transactions.reverse` must additionally follow `apps/web/src/lib/ledger/idempotency.ts`: mint the key when the form **opens**, never during render, reuse it byte-for-byte on every retry, and abandon it only on `409 idempotency_conflict`. A re-minted key on retry posts twice, and nothing upstream will catch it (`ADR 0006`).

## Role and forms

A form's submit affordance may be hidden from a viewer. That is a courtesy, never enforcement — `docs/product/roles-and-permissions/ledger.md` is explicit that "the frontend hides the button" enforces nothing here. The role is derived client-side from a session Better Auth may have cached (ADR 0009) and can be revoked mid-session, so **every write handler implements the `403 insufficient_role` branch regardless of what the UI chose to render**.

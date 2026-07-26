# Feature spec checklist

A list of docs (`docs/product/*`, `docs/integrations/*`) doesn't by itself guarantee nothing was forgotten — someone still has to check each new feature against the same bar every time. This is that bar. Every feature spec (`docs/product/user-flows/*.md`, `docs/product/requirements/*.md`) and every task file (`docs/tasks/*.md`) that implements one should carry this checklist, checked off before the spec is considered ready to build from.

`spec-completeness-guard` checks a spec against this list automatically and reports what's unchecked or missing outright — it doesn't invent new criteria, it enforces this exact list. Edit this file, not the guard skill, when the bar needs to change.

## Common (every feature)

- [ ] Actor(s) defined — who initiates this, including system/scheduled actors if relevant
- [ ] Entry point defined — where the user/system starts (route, button, webhook, cron)
- [ ] Preconditions described — what must be true before this can happen
- [ ] Happy path described — the main successful sequence, step by step
- [ ] Error paths described — not just "shows an error," which errors, and what the user/system does next
- [ ] Permissions considered — who is and isn't allowed to do this (see `docs/product/roles-and-permissions/`)
- [ ] Acceptance criteria written — testable, not vague ("works correctly")
- [ ] Tests defined — which cases will actually be covered, not just "add tests"
- [ ] Out of scope stated explicitly

## Backend

- [ ] API endpoints defined — method, path, request/response shape
- [ ] Validation described — what's validated, where (contract/schema vs handler)
- [ ] Error responses defined — status codes and shapes, not just the happy response
- [ ] Side effects listed — what else changes (DB writes, webhooks fired, emails sent) beyond the direct response

## Frontend

- [ ] Loading state defined
- [ ] Empty state defined
- [ ] Error state defined (distinct from empty — no data vs. failed to load)
- [ ] Navigation after each action defined — where does the user end up after success, after cancel, after error
- [ ] Feedback defined — toast/inline message/modal, and for which outcomes

## Not applicable

If a section genuinely doesn't apply (e.g. a backend-only cron job has no frontend section), say so explicitly in the spec rather than leaving the checkboxes unchecked with no explanation — `spec-completeness-guard` treats an unexplained unchecked item differently from an explicit "N/A: no user-facing surface."

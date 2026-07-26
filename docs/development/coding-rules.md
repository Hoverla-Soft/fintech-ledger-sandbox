# Coding rules

Code-level conventions. Constitution-level process rules (scope discipline, when to ask before proceeding) live in `CLAUDE.md`, not here — this file is style and structure only. For which actual frameworks/libraries these rules apply to, see `docs/development/tech-stack.md` — nothing below names a specific framework on purpose.

## Language

- Strict typing always (e.g. TypeScript strict mode). Avoid an escape-hatch "any" type unless there's a documented reason in a comment.
- Explicit names — avoid `data`/`item`/`value` when context is unclear. No single-letter variables.
- Keep imports clean; remove unused ones rather than leaving them for later.
- Import workspace packages by package name through their public exports. Never use relative cross-package imports, `packages/*/src/**` deep imports, or TypeScript/bundler aliases that bypass the package's generated `dist` contract.

## UI components

- Split into separate files; one component = one responsibility.
- Extract repeated markup into a component instead of copy-pasting it.
- When multiple compatible frontend apps share a design system, put reusable components, tokens, themes, shared/global styles, and icons in the single shared UI package declared in `docs/development/architecture.md` (normally `packages/ui`).
- Keep routes, screens, app layouts, feature-specific components, and app-only styles inside the owning `apps/*` workspace.
- Add an item to the shared UI package when it is an intentional design-system primitive or has a concrete cross-app consumer; keep one-off UI local until that boundary is real.
- Import only from the shared UI package's public entry points. Do not reach into its private source folders.
- Use a map/iteration helper to render lists of same-shaped items, not repeated hand-written blocks.
- Constants: `UPPER_CASE`, defined above the component, outside the render/template — not inline magic values.
- Named exports for reusable components/utils.
- Avoid deeply nested markup — split when it gets hard to scan at a glance.

## Forms

- Keep validation close to the schema/contract that defines the shape — don't duplicate validation rules by hand in the component when a schema (see the validation library declared in `docs/development/tech-stack.md`) already defines them.
- See `docs/frontend/forms-and-validation.md` for the project's specific schema/validation library and pattern.

## Async / data fetching

- Before implementing a request, inspect the target workspace's `package.json`, the lockfile, nearby imports, and shared clients/hooks. Follow the HTTP client and server-state choices in `docs/development/tech-stack.md`.
- Reuse the established package and shared configuration for equivalent work. If Axios is the declared client, use the project Axios instance rather than adding direct `fetch`; if TanStack Query/SWR/RTK Query owns server state, do not recreate its cache/loading/retry behavior by hand.
- An installed package that is undeclared, unused, legacy, or incompatible with the target runtime is not permission to use it. Report the mismatch and propose adoption or cleanup separately.
- If a declared companion would avoid duplicating substantial behavior but is not installed, explain the concrete benefit and ask before installing it. Do not hand-roll the same capability merely to avoid that decision.
- A platform primitive remains appropriate when the stack explicitly selects it, the runtime requires it, or the existing package does not cover the use case. Document deviations when they introduce a second pattern.
- Set loading state before the request, clear it in `finally` — not just on the success path.
- Disable submit/confirm buttons while a request is in flight.
- Close modals/drawers only after the request resolves — never immediately on submit click.
- Refresh affected data after a mutation.
- Show an explicit empty state when there's no data, not a blank area.

## Errors and logging

- Never use an empty `catch`, discard a rejected promise, or convert an unexpected failure into a successful result. Handle an expected error deliberately; otherwise add useful context and rethrow or return it to the boundary responsible for the response/job outcome.
- Catch errors only where the code can recover, translate them into a domain/API error, add missing context, or perform cleanup. Do not catch only to log and rethrow when the same error is already logged at the boundary; that creates duplicate events.
- Use the project logger declared in `docs/development/tech-stack.md`. Direct `console.*` calls are limited to bootstrap/fatal fallback paths and local tooling unless the selected runtime explicitly uses console as its structured logging API.
- Use structured fields, stable event names, and parameterized messages. Do not build logs from large serialized objects or raw request/provider payloads.
- Never log secrets, authorization headers, cookies, session tokens, API keys, passwords, reset links, payment data, or unnecessary personal data. Redaction belongs in the logger configuration as a second line of defense, not as a substitute for careful call sites.
- A request, queue consumer, or scheduled job boundary owns the final failure log. Lower layers return typed/normalized errors and attach context without repeatedly logging the same failure.
- Follow the environment-specific levels and required fields in `docs/backend/error-handling.md`.

## Architecture

- Keep API/business logic out of UI components — components render and dispatch, they don't decide.
- Move repeated logic into helpers/hooks/services rather than duplicating it.
- Respect package boundaries in the monorepo — see `docs/development/architecture.md` for the boundary model. No reaching across layers to save an import.
- Packages should not depend on app-specific `.env` files — env access belongs at the app boundary, not inside shared packages.
- Use existing project patterns instead of inventing new ones for the same problem.
- Don't over-engineer one-time logic; don't add a dependency or abstraction for something used once.
- Don't rewrite working code to make it "prettier" without being asked — see `CLAUDE.md` on scope discipline.
- Before installing or using any framework/library not yet declared in `docs/development/tech-stack.md`, fill in the relevant row there first (ask if it's a real open choice — see `docs/development/framework-companions.md`) rather than adding a dependency silently.

## Tooling

- Ignore `.next`, `dist`, `coverage`, `node_modules`, and other build output when searching or reasoning about the codebase — these are generated, never edited directly.

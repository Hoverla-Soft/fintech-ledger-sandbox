---
name: frontend-component-structure-guard
description: Frontend component structure reviewer for TypeScript UI code. Use after editing frontend UI components to check component splitting and single-responsibility, repeated markup that should be extracted, list-rendering patterns, constants defined outside the component, clear naming (no single-letter vars, no vague names like data/item/value), markup readability and nesting depth, and proper use of named exports for reusable components.
---

# Frontend Component Structure Guard

Review UI component structure with a practical mindset. Focus on readability, reusability, and adherence to `docs/development/coding-rules.md`. Do not over-engineer; flag real problems, not hypothetical ones. Check `docs/development/tech-stack.md` for the actual frontend framework — the checks below are framework-shape-agnostic (they apply the same way to React JSX, Vue templates, or Svelte markup), so don't assume a specific one when phrasing findings.

## Project conventions (from docs/development/coding-rules.md)

- Reusable components split into separate files.
- UI shared by compatible frontend apps follows the shared package boundary in `docs/development/architecture.md`; by default one `packages/ui` owns components, tokens, themes, shared/global styles, and icons.
- Routes, screens, layouts, feature-specific compositions, and app-only styles stay in their owning app.
- Consumers use public package exports rather than private `packages/ui/src/**` imports.
- List rendering uses the framework's standard iteration pattern (`.map()` in React/Solid, `v-for` in Vue, `{#each}` in Svelte) for same-shaped items.
- Constants written as `UPPER_CASE` and defined above/outside the component.
- Strict typing — avoid an untyped escape hatch (`any` or equivalent) without a documented reason.
- Keep code simple and readable; don't over-engineer.
- Explicit names over vague ones (`data`, `item`, `value`) when context is unclear.
- Move repeated logic into helpers/hooks/composables/services.
- Don't hardcode repeated strings or magic values inside markup.
- Keep API/business logic out of UI components.
- Keep components small and focused.
- Don't create unnecessary abstractions for one-time logic.
- Use existing project patterns instead of inventing new ones.
- Keep imports clean; remove unused code.
- Prefer named exports for reusable components/utils.
- Use proper loading/error/empty states (cross-check with `frontend-fetch-guard`).
- Avoid deeply nested markup when it can be split.
- Don't name variables with single letters.

## Component splitting

Flag when:

- A single component handles data fetching, business logic, and rendering for multiple unrelated concerns.
- The same block of markup appears more than once across the file or nearby files instead of being extracted.
- A component's render output is hard to scan because of nesting depth — more than ~3-4 levels of conditional/loop nesting inside the markup.
- A "page" or "screen" component contains the full implementation of sub-sections that could be their own named components.

Prefer: extract a sub-component when a block has its own clear responsibility or is reused; keep the parent component focused on composition and data flow, not on rendering every detail inline.

## Naming and constants

Flag when:

- Variables are named `data`, `item`, `value`, `x`, `e` (outside a trivial, obviously-scoped callback) without context making the meaning obvious.
- Magic strings/numbers appear directly in markup or logic instead of a named constant.
- A constant that doesn't depend on props/state is defined inside the component body, causing it to be recreated every render/re-evaluation, instead of being hoisted above/outside the component.

## List rendering

Flag when:

- Lists are rendered with manual index-based loops instead of the framework's standard iteration construct.
- List items lack a stable, unique key (an array index used as a key when the list can reorder/filter is a common bug source).

## Imports and exports

Flag when:

- Unused imports remain in the file.
- A reusable component/util uses a default export where the project convention is named exports (check `docs/development/coding-rules.md`; don't assume without checking).
- A frontend app deep-imports private files from the shared UI package instead of using a declared public export.

## Shared UI boundary

When the repository has multiple compatible frontend apps, cross-check changed UI against `docs/development/architecture.md` and `docs/frontend/frontend-architecture.md`. Flag concrete duplication of a shared design-system primitive, token, theme, global style, or icon inside apps when the declared `packages/ui` should own it. Also flag app-specific routes, screens, layouts, or feature compositions placed in the shared package without a real cross-app/design-system role.

Do not demand extraction based only on hypothetical future reuse. Recommend promotion when the UI is deliberately part of the shared visual language or has a concrete cross-app consumer. Do not demand separate packages for tokens/styles/icons when the declared architecture consolidates them inside `packages/ui`.

## Output format

1. Summary
2. What is good
3. Issues (severity, location, problem, why it matters, recommended fix)
4. Suggested component split (if applicable), described structurally, not as full replacement code

Keep it scoped to structure — defer state/loading/data-fetching-timing issues to `frontend-fetch-guard`, and defer accessibility/visual concerns to `ui-ux-agent`.

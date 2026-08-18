# Task: Vendor `shadcn/tailwind.css` and drop the CLI from production dependencies

## Goal

The remaining tractable half of `docs/open-questions.md` #18. `packages/ui` carried **`shadcn` in `dependencies`** — the code-generation CLI, 32 production packages including `@modelcontextprotocol/sdk` and a second copy of `hono` — to serve exactly one line in `globals.css`:

```css
@import "shadcn/tailwind.css";
```

That import resolves to `dist/tailwind.css`: 629 lines of static CSS that ship unchanged in every release. The subtree was the source of three of the six advisories `pnpm audit` reports, none fixable without a major-version override that breaks the CLI.

Outcome: the stylesheet is vendored verbatim, the dependency is gone, and the *emitted* CSS is proven unchanged rather than assumed unchanged.

## Status

Human Review

Verified 2026-08-17: `pnpm lint` (265 files, 0 diagnostics) · `pnpm check-types` (6/6) · `pnpm test` (**755 passed** — core 90, server 13, web 297, db 28, api 327) · `pnpm build` (2/2). Local only; CI has still never executed a check (#10).

## Scope (allowed paths)

- `packages/ui/src/styles/shadcn-tailwind.css`
- `packages/ui/src/styles/globals.css`
- `packages/ui/package.json`
- `pnpm-lock.yaml`
- `biome.jsonc`
- `docs/open-questions.md`
- `docs/development/tech-stack.md`
- `docs/tasks/2026-08-17-vendor-shadcn-stylesheet.md`

## Out of scope

- **`packages/ui/components.json`.** It configures the shadcn *registry*, which is still how a primitive gets added — now via `pnpm dlx shadcn@latest add …` rather than a locally installed copy. Deleting it would remove the config while leaving the workflow, which is backwards.
- **Any component under `packages/ui/src/components/`.** This change touches one `@import` and one manifest entry; a component edit here would make the byte-identical CSS check meaningless as evidence.
- **The two remaining audit advisories** (`esbuild` via drizzle-kit, `uuid` via `autocannon`). Each needs a major-version override that breaks its consumer, and both are `devDependencies`. They are why the CI gate stays at `high`.
- **Lowering the CI audit gate to `moderate`.** #18 conditions that on the list being empty. It is not empty; lowering it now would make the gate red on every run, which is how a gate gets disabled.

## Related docs

- `docs/open-questions.md` #18 — the row this closes half of, and which named this as "the tractable one"
- `docs/development/tech-stack.md` → "Component library / design system"
- `docs/tasks/2026-08-16-close-recorded-gaps.md` → "Out of scope", which fenced this off as "a separate change with its own visual-regression risk"

## External sources

- Task/issue: `N/A: no external tracker configured`
- Product documentation: `N/A: all product docs are local, in docs/`
- Design: `N/A: tokens in packages/ui/src/styles/globals.css are authoritative`

## Actors, entry points, preconditions

`N/A: no user-facing behaviour, no actor, no entry point.` This is a dependency and build-input change. Its whole risk surface is whether the CSS the browser receives changes, which is what the verification below measures.

## Happy path

1. **Capture the baseline first.** Build `apps/web` and record the size and sha256 of the emitted CSS bundle *before* any edit. Doing this afterwards proves nothing.
2. Copy `shadcn@4.16.1`'s `dist/tailwind.css` verbatim into `packages/ui/src/styles/shadcn-tailwind.css`, under a header recording provenance, version, MIT licence and copyright, why it is copied, and how to update it.
3. Point `globals.css` at the local file.
4. Remove `"shadcn"` from `packages/ui`'s `dependencies`; `pnpm install`.
5. Exclude the vendored file from Biome's **formatter** in `biome.jsonc`, with the reason written inline.
6. Rebuild and diff the CSS bundle against the baseline.
7. Re-run `pnpm audit` and record the before/after counts.

## Error paths

- **The rebuilt CSS differs from the baseline** → stop. A difference means the vendored copy is not what the import resolved to, and the change is not safe to land on that evidence.
- **Biome reformats the vendored file** → it did, on the first `pnpm lint`. Letting it would have destroyed the file's only real property. Fixed by an `overrides` entry, not by accepting the reformat.
- **A stale `shadcn` reference remains** → the build resolves nothing and fails. Checked by grep after removal; the only survivor is `components.json`, which is deliberate (see Out of scope).

## Permissions

`N/A: no permission surface.`

## Side effects

223 packages removed from the lockfile. No runtime behaviour, no database, no API contract touched.

## Acceptance criteria

- [x] `packages/ui` no longer depends on `shadcn`; no source file imports it.
- [x] The vendored file is **byte-identical** to upstream below its header, and says so, with the update procedure written down.
- [x] **The emitted CSS bundle is unchanged, measured**: 51757 bytes and sha256 `458c5913644119bd252b571b913150cf19b766ffbe014d1cb7f42aec1ba5b9ac` before and after, `diff` clean.
- [x] `pnpm audit` improves: **6 findings (1 low + 5 moderate) → 2 moderate.** All three `hono` advisories, whose only path was `packages__ui>shadcn>@modelcontextprotocol/sdk>hono`, are gone.
- [x] `pnpm audit --audit-level=high` still exits `0`, so `ci.yml`'s existing gate is unaffected.
- [x] The formatter exclusion carries a written reason in `biome.jsonc`, matching the file's two existing precedents.
- [x] `docs/development/tech-stack.md` no longer implies `shadcn` is an installed dependency.
- [x] `pnpm lint`, `pnpm check-types`, `pnpm test`, `pnpm build` all pass.

## Verification

```bash
pnpm lint
pnpm check-types
pnpm test
pnpm build
```

Plus the two checks specific to this change:

```bash
# CSS equivalence — the actual risk this task carries
cd apps/web && pnpm exec vite build && shasum -a 256 dist/assets/*.css
# Dependency-tree improvement
pnpm audit --audit-level=moderate
```

## Retention

Move to `docs/tasks/archive/2026/` on `Done`, once #18 reflects what shipped.

## Spec completeness checklist

### Common
- [x] Actor(s) defined — `N/A: no user-facing behaviour`
- [x] Entry point defined — `N/A: build-input change`
- [x] Preconditions described — a captured CSS baseline, taken before any edit
- [x] Happy path described
- [x] Error paths described
- [x] Permissions considered — `N/A: no permission surface`
- [x] Acceptance criteria written
- [x] Tests defined — the existing 755-test suite plus the CSS hash comparison; no new test, because the property under test is "the build output did not change", which a unit test cannot express
- [x] Out of scope stated explicitly

### Backend
- [x] `N/A: no backend surface.` No endpoint, validation, error response, or side effect changes.

### Frontend
- [x] Loading / empty / error states — `N/A: no component, route, or request changed`
- [x] Navigation after each action — `N/A`
- [x] Feedback — `N/A`
- [x] **Visual result** — the one frontend property at risk, verified as a byte-identical CSS bundle rather than by eye

---

*Started 2026-08-17.*

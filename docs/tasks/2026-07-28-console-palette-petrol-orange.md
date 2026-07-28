# Task: re-hue the console palette — petrol and signal orange on bone paper

## Goal

Replace the console's color ground. The palette established in
`docs/tasks/2026-07-28-console-design-foundation.md` is a cool grey neutral
(hue 264) under a blue-violet primary (`oklch(0.45 0.17 267)`) — which is the
family every shadcn/ui starter ships with and every other B2B SaaS console
therefore wears. It is correct and accessible; it is not distinctive, and for a
product whose stated brand commitment is the craft bar of Stripe, Mercury and
Ramp, wearing the default is the problem.

The new ground is Color Hunt palette
[`#FF9E20 #215E61 #1D2128 #F4F2F2`](https://colorhunt.co/palette/ff9e20215e611d2128f4f2f2),
mapped onto the roles the system already has rather than sprinkled as
decoration:

| Source | OKLCH | Role in this system |
| --- | --- | --- |
| `#215E61` | `oklch(0.444 0.062 200)` | **Ledger Petrol** — the single action/state hue, replacing indigo |
| `#FF9E20` | `oklch(0.781 0.167 65)` | **Signal Orange** — the caution role, replacing amber; carries the sandbox badge |
| `#1D2128` | `oklch(0.247 0.015 262)` | **Ink** — primary text, and the base the dark canvas is built from |
| `#F4F2F2` | `oklch(0.963 0.002 17)` | **Paper** — the canvas, re-cast warm |

This is a token and documentation change only. No component markup, layout,
spacing, type scale, radius, or shadow geometry changes — every screen inherits
the new hue through the variables it already consumes.

## Status

Done

## Scope (allowed paths)

- `docs/tasks/2026-07-28-console-palette-petrol-orange.md`
- `DESIGN.md`
- `packages/ui/src/styles/globals.css`
- `apps/web/src/components/sign-in-form.tsx`
- `apps/web/src/components/sign-up-form.tsx`
- `apps/web/src/components/shell/sandbox-badge.tsx`

### Scope amendments

- **2026-07-28 — added `apps/web/src/components/sign-in-form.tsx` and
  `apps/web/src/components/sign-up-form.tsx`.** Both auth links carry
  `className="text-indigo-600 hover:text-indigo-800"` — a hardcoded Tailwind
  palette literal that bypasses the token system entirely. It survived the
  foundation slice because indigo utilities happened to sit near the indigo
  token; against a petrol primary it is simply a wrong-colored link, and it is
  the only place in the app where a color is written outside a token. The
  `Button variant="link"` these override already resolves to `--primary`, so the
  fix is deletion, not substitution.
- **2026-07-28 — added `apps/web/src/components/shell/sandbox-badge.tsx`.** Its
  doc comment names the token it renders ("Amber rather than red — this is
  expected-and-notable, not an error"). The reasoning survives the re-hue
  exactly; the color name does not. One word, no behavior change, and leaving it
  stale would put the component and `DESIGN.md` in disagreement about what the
  badge is.

## Out of scope

- **Component or layout change of any kind.** Geometry, density, type scale,
  radius and shadow values are settled by the foundation slice and are not
  reopened here.
- **The `--input` border's non-text contrast.** `--input` against `--card`
  measures 1.57:1, below the 3:1 that WCAG 1.4.11 asks of a control boundary.
  This is inherited, not introduced — the previous token measured 1.37:1, so
  this change improves it — and raising it to 3:1 makes every field on every
  screen read as a heavy-ruled box, which is a component design decision that
  belongs to its own slice with the field styles in front of it.
- **`defaultTheme="dark"` in `apps/web/src/routes/__root.tsx`**, still deferred
  from the foundation slice for the same reason: the file is outside Scope and
  the default is the product's choice.
- **Chart palette expansion.** The five chart tokens are re-hued into the new
  petrol→blue ramp so nothing renders stale, but no charting capability exists
  to consume them and none is added.

## Related docs

- `DESIGN.md` — the design system this rewrites the Colors section of
- `docs/tasks/2026-07-28-console-design-foundation.md` — established the tokens
  being replaced, and the named color rules that survive unchanged
- `PRODUCT.md` — the brand commitment that makes "not the default palette" a
  requirement rather than a preference

## External sources

- Task/issue: `N/A: originated as a direct request in-session`
- Design: [Color Hunt palette `ff9e20215e611d2128f4f2f2`](https://colorhunt.co/palette/ff9e20215e611d2128f4f2f2)
  — source hexes only; every token below is derived, not pasted, because the
  four source colors are a poster palette and a console needs ~40 tokens across
  two themes that hold contrast.

## Design decisions

**Why petrol rather than the palette's orange as primary.** `#FF9E20` is the
palette's loudest color and the obvious "brand" pick, but at
`oklch(0.781 …)` it cannot carry white text, and a fintech console's primary hue
must survive being a filled button. It also collides with the caution role the
system already needs. Petrol takes the action hue; orange takes caution, which
puts it on the sandbox badge — visible in the chrome of every screen, so the
palette's hero color is present constantly without ever being decoration.

**Warm paper, cool ink.** The source palette pairs a faintly warm off-white with
a cool graphite. Rather than flatten that to one cast, both are kept and pushed
apart: neutrals run warm (hue 75, a bone paper), text and dark surfaces run
petrol-cool (hue 220). That is the ledger book's own contrast — warm stock, cold
ink — and it keeps the primary from looking like a stray accent on a grey.

**Chroma ceiling.** Teal at `L 0.44` tops out at `C 0.075` in sRGB, so the
primary sits at `0.07` — deliberately under the gamut boundary, because a
clipped OKLCH value is gamut-mapped differently by each engine and would render
as a different color per browser. Every token was checked in-gamut; the previous
indigo's `C 0.17` is simply not available at this hue, and the resulting lower
chroma is what makes petrol read as an instrument rather than a brand.

**Success shifted away from primary.** Audit Green moves from hue 155 to 148 and
gains chroma (`0.115` → `0.125`). With a teal primary, a blue-leaning green is
the one real risk in this palette — a `success` badge next to an active nav item
must not read as the same color. 49° of hue separation plus the chroma gap keeps
them distinct.

## Acceptance criteria

- No token references hue 264/267; the primary is petrol and the caution hue is
  the palette's orange.
- Every token resolves inside the sRGB gamut, so no value is left to
  per-engine gamut mapping.
- Every text pairing clears WCAG AA (≥4.5:1): foreground, secondary, and muted
  foregrounds on every surface they land on; every colored fill against its
  paired foreground; and primary, success and destructive used as text.
- Focus rings clear 3:1 against both canvas and card.
- No color literal remains outside the token system.
- `DESIGN.md` frontmatter and Colors section describe the tokens that actually
  ship, and the three named color rules still hold.

## Verification

```bash
pnpm lint
pnpm check-types
pnpm test
pnpm build
```

Contrast and gamut were computed for all 23 text and non-text pairings per theme
before the tokens were written, rather than eyeballed after.

## Retention

Working record. Move to `docs/tasks/archive/2026/` once `DESIGN.md` is settled;
the durable content is already there rather than here.

## Spec completeness checklist

### Common
- [x] Actor(s) defined — every console user, both themes; no role-specific behavior
- [x] Entry point defined — the token layer in `globals.css`, inherited by every screen
- [x] Preconditions described — the foundation slice's token contract exists and is consumed by name
- [x] Happy path described — every surface re-hues with no markup change
- [x] Error paths described — `N/A: a stylesheet change with no runtime branch`
- [x] Permissions considered — `N/A: no permission surface`
- [x] Acceptance criteria written
- [x] Tests defined — no new unit test; correctness here is contrast/gamut arithmetic, computed in Verification, plus the existing suite proving nothing regressed
- [x] Out of scope stated explicitly

### Backend
- [x] API endpoints defined — `N/A: frontend token change`
- [x] Validation described — `N/A: no input`
- [x] Error responses defined — `N/A: no endpoint`
- [x] Side effects listed — `N/A: none`

### Frontend
- [x] Loading state defined — unchanged; no fetch touched
- [x] Empty state defined — unchanged
- [x] Error state defined — unchanged
- [x] Navigation after each action defined — `N/A: no action added`
- [x] Feedback (toast/inline/modal) defined — unchanged; `sonner` inherits the new tokens

---

*Started and completed 2026-07-28.*

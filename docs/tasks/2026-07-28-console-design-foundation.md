# Task: console design foundation — tokens, shell, command palette, ledger table

## Goal

The console reads as a premium, enterprise-grade financial product rather than a scaffold. This slice replaces the visual foundation everything else inherits: a real color system (the current tokens are entirely zero-chroma, so "primary" is grey), a typography scale that actually loads and renders money in tabular figures, an elevation and radius scale, the console shell (persistent sidebar, top bar, organization switcher, sandbox environment badge), a keyboard-first command palette over the routes and actions that exist, and one ledger table primitive with a sticky header and correctly aligned monetary columns.

Screen-by-screen redesign is **not** in this slice; it lands in follow-ups that inherit what this establishes.

## Status

In Progress

## Scope (allowed paths)

- `docs/tasks/2026-07-28-console-design-foundation.md`
- `DESIGN.md`
- `PRODUCT.md`
- `docs/frontend/design-system.md`
- `packages/ui/src/styles/globals.css`
- `packages/ui/src/components/table.tsx`
- `packages/ui/src/components/badge.tsx`
- `apps/web/index.html`
- `apps/web/src/components/shell/**`
- `apps/web/src/features/accounts/account-display.tsx`
- `apps/web/src/features/accounts/account-display.test.tsx`

### Scope amendments

- **2026-07-28 — added `apps/web/src/features/accounts/account-display.test.tsx`.** Under-scoped on the first pass: the balance's test file was omitted while its implementation was included. Rendering the currency code in its own element (so the figure carries the emphasis) splits what was one text run, and Testing Library's `getByText` matches only an element's *direct* text children, so four assertions broke on markup granularity while asserting content that did not change. They are rewritten against the element's full text content, which states the "exact wire string" contract more directly than the original did.
- **2026-07-28 — added `packages/ui/src/components/badge.tsx`.** Two reasons, both inside this slice's stated goal. The `destructive` badge pairs `text-white` with `--destructive`, which fails WCAG AA at the current token value in both themes, and the acceptance criteria require AA across text pairings. Separately, reconciliation status ("clean" vs "drift") and the semantic `success` / `warning` roles this slice introduces have no badge variant to render them, so the tokens would ship unusable.

## Out of scope

- **Any capability the API does not have.** No Chart of Accounts, Trial Balance, Balance Sheet, Income Statement, journal-entry editor, invoices, approval workflow, comments, attachments, import wizard, API playground, or webhook log. `docs/product/requirements/ledger.md` §"Out of scope (v1)" governs; the console must not imply a capability the ledger cannot perform.
- **Per-screen redesign.** `dashboard`, `accounts`, `transfer`, `transactions`, `reconciliation`, `sandbox`, `audit`, and `organization` route files keep their current composition in this slice.
- **The public landing page** (`apps/web/src/routes/index.tsx`) — a Persuade surface with its own chrome, handled separately.
- **New dependencies.** The command palette is built on the already-declared Base UI primitives rather than adding `cmdk`; a charting library is not introduced, because no aggregate endpoint exists to chart.
- **Role logic.** The palette hides admin-only actions as a courtesy exactly as the existing screens do; enforcement stays server-side.

## Related docs

- `docs/product/requirements/ledger.md` — capability boundary and the required loading/empty/error/feedback behavior
- `docs/product/roles-and-permissions/ledger.md` — `admin` / `viewer`, and why hiding a control is never enforcement
- `docs/development/tech-stack.md` — Tailwind v4, Base UI primitives via shadcn/ui, TanStack Router/Query
- `docs/frontend/ui-states.md` — the three states every screen owes
- `docs/adr/0002-money-representation.md` — money is server-formatted at the currency's own exponent; the client never re-formats

## External sources

- Task/issue: `N/A: originated as a direct design brief in-session`
- Product documentation: `docs/product/requirements/ledger.md` (local, authoritative)
- Design: `N/A: no external design file; the brief pins a reference craft bar (Stripe, Mercury, Linear, Vercel, Ramp) recorded as a brand commitment in PRODUCT.md`

## Acceptance criteria

- Color tokens carry a real primary hue with semantic success/warning/danger roles, in light and dark, all text pairings meeting WCAG AA (≥4.5:1 body, ≥3:1 large).
- The declared font family actually loads; no token names a face the browser cannot resolve.
- Every monetary value renders in tabular figures and right-aligns, so digits form columns across rows.
- The console shell presents a persistent sidebar with the seven real routes, a top bar carrying organization switcher, theme toggle and user menu, and a visible sandbox environment badge.
- The command palette opens on `Cmd/Ctrl+K`, is fully keyboard operable, navigates to any console route, and offers write actions only when the current role can perform them.
- The ledger table primitive supports a sticky header, numeric columns, hover and keyboard focus, and does not regress the existing accounts and transactions tables.
- Focus is visible on every interactive element; the sidebar and palette are reachable and operable by keyboard alone.
- `DESIGN.md` exists and matches what was built.

## Verification

```bash
pnpm lint
pnpm check-types
pnpm test
pnpm build
```

Plus a browser pass over the running console, signing up and seeding real scenario data so no table was judged empty: `/dashboard`, `/accounts`, `/transactions`, `/reconciliation`, `/audit`, `/sandbox`, and the palette open and filtered — each in both themes at 1440, 834, and 390 wide. Every capture also asserted `documentElement.scrollWidth === clientWidth`, which is what caught the defect below.

### Found and fixed during the browser pass

- **The whole page scrolled sideways at 390 wide**, carrying the top bar and the accounts table's leading columns off screen. Two causes: the content column is a grid item, whose automatic minimum size is its content unless `min-width: 0` says otherwise; and the top bar spent more width than 390 has. Fixed with `min-w-0` on the column, and by giving the below-`lg` bar the environment badge instead of a breadcrumb that only repeated the nav strip under it, plus a harder truncation and no icon or role text on the organization switcher below `sm`.
- **The palette trigger had no accessible name below `sm`**, where it renders as an icon only. It now carries `aria-label` and `aria-keyshortcuts`.
- **The table's horizontal scroll region was reachable by pointer only.** It is now a labelled, focusable region when it measures as overflowing — which on a narrow screen is exactly when the balance column is the part hidden off the right edge.
- **The sidebar's environment description wrapped into its badge.** Stacked; verified fully inside the viewport with the router devtools overlay hidden, since that overlay was masquerading as a clip.
- **`DESIGN.md` described a mobile sidebar that was never built** — a drawer, where the code deliberately ships a scrollable strip. Corrected there, along with the top bar's real below-`lg` composition.

### Deferred, with reasons

- **`defaultTheme="dark"` in `apps/web/src/routes/__root.tsx`** means a first-run operator gets dark regardless of their OS preference. `"system"` is almost certainly what was meant, but the file is outside this Scope and the choice is the product's to make.
- **Data screens cap at `max-w-4xl`**, so at 1440 a six-column table uses under half the width available to it. Route composition is explicitly out of scope here; the per-screen slice should drop the cap on table screens.
- **Mobile column priority.** The accounts table hides `BALANCE` off the right edge at 390 because column order is `NAME · TYPE · CURRENCY · BALANCE · STATUS`. The primitive cannot reorder its caller's columns; the per-screen slice should drop `CURRENCY` below `sm`, since the balance already carries its code.
- **`reversed` renders as a `destructive` badge** on `/transactions`, which reads as an error for what is a factual, expected state. `muted` is the honest variant. Route-owned.
- **Screen `h1`s use `text-2xl font-bold`** rather than the Title role this slice defined. Route-owned; a mechanical follow-up.

## Retention

Working record. Move to `docs/tasks/archive/2026/` once the durable system rules are captured in `DESIGN.md` and `docs/frontend/design-system.md`.

## Spec completeness checklist

### Common
- [x] Actor(s) defined — org `admin` and `viewer`; every console route
- [x] Entry point defined — the console shell wrapping `/_auth/*`, plus `Cmd/Ctrl+K`
- [x] Preconditions described — signed-in session with an active organization (`_auth/route.tsx` gate)
- [x] Happy path described — operator lands in the console, orients via sidebar, jumps by palette, reads aligned balances
- [x] Error paths described — `N/A: this slice adds no new data fetch; existing QueryState error handling is preserved unchanged`
- [x] Permissions considered — palette write actions gated on `canWrite` as courtesy only
- [x] Acceptance criteria written
- [x] Tests defined — component tests for the palette and shell nav under `apps/web/src/components/shell/`
- [x] Out of scope stated explicitly

### Backend
- [x] API endpoints defined — `N/A: frontend-only slice, no API change`
- [x] Validation described — `N/A: no new input reaches the server`
- [x] Error responses defined — `N/A: no new endpoint`
- [x] Side effects listed — `N/A: none; navigation and theme only`

### Frontend
- [x] Loading state defined — org switcher keeps its skeleton; palette renders instantly from static route data
- [x] Empty state defined — palette shows a "no matching command" result for an unmatched query
- [x] Error state defined — unchanged; `QueryState` remains the single translation point
- [x] Navigation after each action defined — selecting a palette entry navigates and closes the dialog
- [x] Feedback (toast/inline/modal) defined — unchanged toast behavior via `sonner`

---

*Started 2026-07-28.*

---
name: Ledger sandbox
description: A double-entry ledger console built like a precision instrument — squared, dense, and legible under audit.
colors:
  ink: "oklch(0.235 0.018 220)"
  paper: "oklch(0.958 0.004 75)"
  surface: "oklch(0.997 0.002 75)"
  rule: "oklch(0.885 0.006 75)"
  quiet-ink: "oklch(0.45 0.02 220)"
  ledger-petrol: "oklch(0.44 0.07 197)"
  ledger-petrol-wash: "oklch(0.95 0.017 197)"
  audit-green: "oklch(0.5 0.125 148)"
  signal-orange: "oklch(0.78 0.16 65)"
  reject-red: "oklch(0.48 0.19 25)"
  night-ink: "oklch(0.965 0.004 80)"
  night-paper: "oklch(0.185 0.016 220)"
  night-surface: "oklch(0.225 0.018 220)"
  night-petrol: "oklch(0.68 0.1 196)"
typography:
  display:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 600
    lineHeight: "2.125rem"
    letterSpacing: "-0.02em"
  title:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 600
    lineHeight: "1.75rem"
    letterSpacing: "-0.015em"
  heading:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 600
    lineHeight: "1.5rem"
    letterSpacing: "-0.01em"
  body:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: "1.375rem"
    letterSpacing: "normal"
  label:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: "1rem"
    letterSpacing: "0.06em"
  numeric:
    fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: "1.375rem"
    fontFeature: "tabular-nums"
rounded:
  sm: "0.125rem"
  md: "0.1875rem"
  lg: "0.25rem"
  xl: "0.375rem"
spacing:
  xs: "0.25rem"
  sm: "0.5rem"
  md: "0.75rem"
  lg: "1rem"
  xl: "1.5rem"
  2xl: "2rem"
components:
  button-primary:
    backgroundColor: "{colors.ledger-petrol}"
    textColor: "{colors.surface}"
    rounded: "0"
    padding: "0 0.625rem"
    height: "2rem"
  button-outline:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "0"
    padding: "0 0.625rem"
    height: "2rem"
  nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.quiet-ink}"
    rounded: "{rounded.sm}"
    padding: "0.375rem 0.5rem"
  nav-item-active:
    backgroundColor: "{colors.ledger-petrol-wash}"
    textColor: "{colors.ledger-petrol}"
    rounded: "{rounded.sm}"
    padding: "0.375rem 0.5rem"
  table-head:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.quiet-ink}"
    typography: "{typography.label}"
    height: "2.25rem"
  money-cell:
    textColor: "{colors.ink}"
    typography: "{typography.numeric}"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "1rem"
---

# Design System: Ledger sandbox

## Overview

**Creative North Star: "The Ruled Ledger Page"**

This is a double-entry ledger, and the oldest interface for one is a bound book of ruled paper: columns that align because alignment is how errors are caught, hairline rules instead of boxes, and no ornament anywhere near a number. That tradition — not the modern SaaS dashboard — is the reference. Everything here is squared, ruled, and dense, and the one saturated color in the system is spent on where you are and what you are about to do, never on decoration.

The register is professional and unhurried. Operators come here to answer a question about money — does this balance, who posted it, did the reversal land — and the interface's job is to make the answer legible in one glance and impossible to misread. Density is a feature: a screen that shows twenty rows without crowding beats one that shows six inside generous cards. Whitespace does structural work (separating groups, opening above a heading) rather than decorative work.

What this system refuses is the generic admin template: pillowy rounded cards floating on grey, gradient headers, a metric tile grid as the page structure, and color sprayed across every status. It also refuses the opposite failure — a "technical" costume of monospace everywhere. Monospace is for measurement only: money, identifiers, hashes.

**Key Characteristics:**
- Squared geometry throughout; corners are a hairline at most (≤4px), never a pillow
- Neutrals run warm as paper (hue 75) against petrol-cool ink (hue 220); a single petrol carries state and action
- Money is monospaced, tabular, right-aligned, and never colored for being merely positive
- Hairline rules and tonal steps do the separating; shadows appear only when something floats
- Dense by default: compact control heights (28–32px), 13–14px body text

## Colors

A warm bone ground under petrol-cool ink, one deep petrol carrying action and state, plus three semantic hues that appear only when they carry meaning a reader must act on.

The hue set derives from Color Hunt palette [`ff9e20215e611d2128f4f2f2`](https://colorhunt.co/palette/ff9e20215e611d2128f4f2f2) — `#215E61` becomes the action hue, `#FF9E20` the caution hue, `#1D2128` the ink and the dark canvas, `#F4F2F2` the paper. Four poster colors are not a system, so each token below is derived from them and checked in-gamut and against WCAG, never pasted.

### Primary
- **Ledger Petrol** (`oklch(0.44 0.07 197)`): the only saturated color in ordinary use. It marks the active navigation item, the primary action, focus rings, and links. Carries white text at 7.3:1 and reads as instrumentation rather than a consumer brand accent — partly *because* its chroma is low. Teal at this lightness tops out at `C 0.075` in sRGB, so the value sits just inside that ceiling deliberately: a clipped OKLCH color is gamut-mapped differently by every engine, and would render as a different color per browser. To deepen it, lower the lightness; never raise the chroma.
- **Ledger Petrol Wash** (`oklch(0.95 0.017 197)`): the tinted fill behind an active nav item or a selected row. It is the *only* place petrol appears as a background in the light theme.

### Secondary
- **Audit Green** (`oklch(0.5 0.125 148)`): reconciliation clean, a verification that passed, a seed scenario that posted. Never used to celebrate a positive balance, and never to mark an account merely *active* — almost every account is, so colouring it makes green mean nothing. Held 49° off the primary's hue and given more chroma than it strictly needs, because a blue-leaning green beside a teal primary is the one real confusion this palette can produce.
- **Signal Orange** (`oklch(0.78 0.16 65)`): the sandbox environment badge, and any state that is expected-but-notable — a suspense account opened by a reset, a drift figure that needs review. It is the source palette's loudest color and it is *not* the primary, because at this lightness it cannot carry white text and a primary hue must survive being a filled button. Spending it on the sandbox badge instead puts it in the chrome of every screen, where it does a job.
- **Reject Red** (`oklch(0.48 0.19 25)`): a rejected transaction, a failed load, a destructive confirmation, and the one balance that should look wrong — a `normal` account gone negative, which invariant #6 makes impossible.

### Neutral
- **Ink** (`oklch(0.235 0.018 220)`): all primary text. Near-black pulled toward petrol so text and the action hue belong to one family.
- **Quiet Ink** (`oklch(0.45 0.02 220)`): secondary text, column headers, metadata. Chosen at exactly the lightness that still clears 4.5:1 on every surface it lands on — card, canvas, sidebar, muted fill, and the petrol wash.
- **Paper** (`oklch(0.958 0.004 75)`): the application canvas. Bone rather than white, and warm where the ink is cool — the ledger book's own contrast, warm stock and cold ink. Its darker value is also what lets surfaces step up visibly without a shadow.
- **Surface** (`oklch(0.997 0.002 75)`): cards and tables, one tonal step above the canvas. Warm white, not pure white, so it shares the paper's cast rather than reading cold against it. This step, not a shadow, is what makes content read as raised.
- **Rule** (`oklch(0.885 0.006 75)`): every divider and table border, always 1px.

### Dark theme
Not a per-token inversion. The canvas is a petrol-black (`oklch(0.185 0.016 220)`) rather than neutral black, so it belongs to the primary's hue family and hairline rules stay visible on it. Text keeps the light theme's warm cast (`oklch(0.965 0.004 80)`), which is what makes the two themes read as one product rather than a negative of it. Petrol lightens to `oklch(0.68 0.1 196)` to hold contrast on a dark ground, and every semantic hue lightens with it while its paired foreground darkens.

### Named Rules
**The One Voice Rule.** Petrol is the only saturated hue that appears without a semantic reason. If a screen shows petrol in more than two places at once — active nav plus primary action — one of them is decoration and comes out.

**The Unremarkable Number Rule.** A positive balance gets no color. Only a *negative* balance is colored, and only when it is genuinely notable: `external` accounts are expected to go negative and render in plain ink, while a negative `normal` account renders in Reject Red because the ledger's own invariants say it cannot exist.

**The Meaning-Only Rule.** Green, orange, and red never appear as accents, illustration, or chart decoration. Each one is a claim about state that a reader may need to act on. The chart ramp therefore stays inside the petrol→blue band.

**The In-Gamut Rule.** Every token resolves inside sRGB. A value outside it is not "more vivid" — it is handed to each browser's gamut mapping and becomes a different color in each one, which is not a thing a system can promise contrast about.

## Typography

**Body & Display Font:** the platform UI stack (`ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto`)
**Numeric & Mono Font:** the platform mono stack (`ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas`)

**Character:** deliberately unbranded and native. A console an operator lives in all day should render in the face their operating system renders best, at the weight their system hints for; a loaded webfont here buys personality at the cost of a flash of unstyled text over financial data. The prior token named `"Inter Variable"` but nothing ever loaded it, so every screen silently fell back to Arial or Helvetica — the stack below is what actually renders.

### Hierarchy
- **Display** (600, 1.75rem/2.125rem, -0.02em): the dashboard's single page title. One per screen at most.
- **Title** (600, 1.375rem/1.75rem, -0.015em): the `h1` on every other console screen.
- **Heading** (600, 1.0625rem/1.5rem, -0.01em): section headings inside a screen.
- **Body** (400, 0.875rem/1.375rem): all prose and table content. Prose measure caps at 70ch.
- **Label** (600, 0.6875rem/1rem, 0.06em, uppercase): navigation group headings and table column headers only.
- **Numeric** (400, 0.875rem/1.375rem, `tabular-nums`): every monetary amount, quantity, and identifier.

### Named Rules
**The Column Rule.** Every number a reader might compare vertically renders in tabular figures and right-aligns. Proportional digits in a balance column are a defect, not a style choice — misaligned decimal points are exactly how a misread happens.

**The Label Budget Rule.** Uppercase tracked labels exist for two jobs: sidebar group headings and table column headers. An uppercase label introducing a content section is an eyebrow, and this system does not use them.

**The Monospace-Is-Measurement Rule.** Mono is for money, IDs, keys, and hashes. It is never used to make prose look technical.

## Layout

A two-column application frame: a fixed 15rem sidebar and a fluid content column. The sidebar is persistent from `lg` up and becomes a horizontally scrollable strip of the same destinations below that — not a drawer, because a drawer hides every destination behind a tap and needs a focus trap to be accessible. Content never reflows into a mobile-only layout, because a ledger table is legitimately wide and horizontal scroll inside the table is the honest answer.

Above the content column sits a 3.5rem top bar. From `lg` up it carries breadcrumb context on the left; below that the breadcrumb would only repeat the active pill in the strip beneath it, so the space goes to the environment badge instead. The right side carries organization switcher, theme toggle, and account menu at every width, shedding the switcher's icon and role text below `sm` so the bar can never widen the page. Content is capped at 80rem and gutters at 1.5rem on desktop, 0.75rem below `sm`.

The content column sets `min-width: 0`. Without it a grid item's automatic minimum size is its content, and a wide table or a crowded top bar pushes the whole page into horizontal scroll — taking the top bar and the table's leading columns off screen.

Spacing rhythm runs on a 4px base with a strong preference for the small end: 0.5rem inside a control, 0.75–1rem between related rows, 1.5rem between groups, 2rem above a section heading and 1rem below it. Tables set their own vertical rhythm at 0.5rem cell padding and a 2.25rem header — tight, because row count is the point.

## Elevation & Depth

Depth is tonal first. The canvas is the darkest surface in light mode and the darkest in dark mode; cards and tables step *up* one tonal notch, and a 1px rule closes the edge. Nothing at rest carries a shadow.

Shadows appear only when an element genuinely floats above the page — dropdown, popover, dialog, command palette — and they are tinted with the neutral's own hue rather than pure black, so they read as shade rather than smudge.

### Shadow Vocabulary
- **xs** (`0 1px 2px 0 oklch(0.235 0.03 220 / 0.06)`): a control that is being pressed or dragged.
- **sm** (`0 1px 3px 0 oklch(0.235 0.03 220 / 0.08), 0 1px 2px -1px oklch(0.235 0.03 220 / 0.06)`): a hovered menu item surface.
- **md** (`0 4px 12px -2px oklch(0.235 0.03 220 / 0.10), 0 2px 4px -2px oklch(0.235 0.03 220 / 0.06)`): dropdowns and popovers.
- **lg** (`0 16px 40px -12px oklch(0.235 0.03 220 / 0.18), 0 4px 12px -4px oklch(0.235 0.03 220 / 0.08)`): dialogs and the command palette.

### Named Rules
**The Flat-At-Rest Rule.** If an element is part of the page, it has no shadow. A shadow is a claim that something is temporarily on top of everything else, and that claim must be true.

## Shapes

Squared, with a hairline concession. The corner scale tops out at 4px (`rounded-lg`), and the component library's buttons and badges are explicitly `rounded-none` — a decision this system keeps rather than reverses, because a 90° control next to a ruled table column is the form language the ledger tradition already had.

Borders are always exactly 1px and always the Rule neutral. A colored border wider than 1px on a card, row, or callout is not part of this system; state is carried by fill and text color instead.

Empty states use a 1px dashed rule rather than a solid card, so a region with nothing in it does not look like a region that failed to load.

## Components

### Buttons
- **Shape:** square (0 radius), 2rem tall at default, 1.75rem at `sm`, with a transparent 1px border so size never shifts between variants.
- **Primary:** Ledger Petrol fill, white text, 0.625rem horizontal padding.
- **Hover / Focus:** primary lightens to 80% opacity on hover; focus shows a 1px petrol border plus a 1px petrol ring at 50%. Active state translates down 1px — a press, not a bounce.
- **Outline / Ghost / Secondary:** neutral fills over the canvas; used for everything that is not the one primary action on screen.
- **Destructive:** a 10% Reject Red tint with Reject Red text, not a solid red slab. Destructive actions in a ledger are rare and deliberate; a solid red button invites the reflex click.

### Badges
- **Style:** square, 1px border, 0.6875rem text. Fill-and-text pairs only — never a border-only colored variant, which reads as a disabled control.
- **Variants:** `default` (petrol), `secondary`, `outline`, `muted`, `success`, `warning`, `destructive`. Each colored variant pairs its fill with an explicitly darkened or lightened foreground token so it clears AA in both themes.

### Cards / Containers
- **Corner Style:** 4px hairline (`rounded-lg`).
- **Background:** Surface, one tonal step above the canvas.
- **Shadow Strategy:** none at rest — see Elevation.
- **Border:** 1px Rule.
- **Internal Padding:** 1rem, rising to 1.5rem only for a card that is the sole content of a screen.

### Inputs / Fields
- **Style:** 1px Rule border on the Surface fill, square, 2rem tall.
- **Focus:** border shifts to petrol with a 1px petrol ring; no glow.
- **Currency inputs:** right-aligned, tabular figures, with the currency code as a static suffix rather than placeholder text.

### Navigation
- **Sidebar:** Surface-adjacent tonal fill, 1px right rule, 15rem wide. Items are 1.75rem tall with a 16px icon and Body text at 400 weight, rising to 500 when active. Active items take the Ledger Petrol Wash fill with petrol text; hover takes the neutral accent fill. Group headings use the Label role.
- **Top bar:** 3.5rem, 1px bottom rule, transparent over the canvas.
- **Mobile:** below `lg` the sidebar becomes a horizontally scrollable strip under the top bar, carrying all seven destinations with the same active fill. Only the group headings are lost, and they were orientation rather than information.

### Ledger Table
The signature component. Column headers use the Label role over the canvas fill and stay stuck to the top of the scroll container, so a header is still readable 40 rows down. Numeric columns right-align and set tabular figures at the cell level rather than relying on the caller to remember. Rows separate with a 1px bottom rule, take the neutral accent on hover, and expose a visible focus ring when reached by keyboard. A row that links somewhere makes its first cell the link target rather than trapping the whole row in an `onClick`.

The table scrolls inside its own wrapper rather than moving the page. When it measures as actually overflowing, that wrapper becomes a labelled, focusable scroll region with a focus ring — a scroller with no focusable content is reachable by pointer only, and on a narrow screen the column hidden off the right edge is usually the balance. The measurement is what keeps it honest: an unconditional tab stop in front of every table that fits is its own defect. The overflow is never masked by a fade, because a half-faded figure is a misreading waiting to happen.

### Command Palette
Opens on `⌘K` / `Ctrl+K` over a dialog backdrop, 32rem wide, anchored above center. This is the system's one authored motion moment: the panel arrives with an exponential ease-out over 180ms, scaling from 98% with the backdrop fading in behind it, and leaves in half that. Results group under Label headings; the highlighted row takes the Petrol Wash fill; arrow keys move, Enter commits, Escape closes. An unmatched query says so in Quiet Ink rather than showing an empty box.

## Do's and Don'ts

### Do:
- **Do** render every comparable number in tabular figures, right-aligned (`The Column Rule`).
- **Do** convey depth with tonal steps and 1px rules; reserve shadows for elements that actually float.
- **Do** spend petrol on exactly two things per screen: where you are, and the one primary action.
- **Do** keep controls compact — 1.75–2rem tall — and let row count rather than padding fill the screen.
- **Do** pair every colored fill with its matched foreground token so contrast holds in both themes.
- **Do** state the sandbox nature of the environment plainly in the chrome; it is product truth, not a disclaimer to hide.

### Don't:
- **Don't** color a balance for being positive, and don't color a negative `external` balance as an error — it is expected (`The Unremarkable Number Rule`).
- **Don't** introduce a corner radius above 4px, or restore radius to the library's squared buttons and badges.
- **Don't** use an uppercase tracked label anywhere except a sidebar group heading or a table column header.
- **Don't** build a page whose structure is a grid of same-size metric tiles.
- **Don't** use a colored left border above 1px to mark state on rows, cards, or alerts.
- **Don't** add a gradient, a glass blur, or a sparkline that stands in for real data.
- **Don't** write a color literal in a component — no `text-indigo-600`, no hex. Every color comes from a token, or the next re-hue misses it.
- **Don't** render a screen for a capability the ledger does not have — no trial balance, income statement, or journal-entry editor exists behind this API.

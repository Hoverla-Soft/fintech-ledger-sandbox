# Frontend architecture

## App structure

{{Folder structure per app — routes/pages, components, hooks/composables, api layer.}}

## State management

Client state and server-state libraries: see `docs/development/tech-stack.md`'s Companion libraries table. Note here, once decided:

- {{What goes in client state vs. server-state cache — don't duplicate server data into client state that then goes stale.}}
- {{Where global vs. local state boundaries are drawn.}}

## Shared components and design system

For multiple compatible frontend apps, use one `packages/ui` package as the shared design-system boundary. Record any project-specific alternative here.

The default internal shape is:

```text
packages/ui/src/
  components/   # reusable primitives and composed design-system components
  tokens/       # color, spacing, typography, radii, breakpoints, motion
  styles/       # reset, global styles, and shared styling entry points
  themes/       # default and app/brand theme definitions
  icons/        # the normalized shared icon surface
```

Expose stable public entry points for the package root and, when useful, `styles`, `tokens`, `themes`, and `icons`. Frontend apps must not import private source paths.

Add UI to `packages/ui` when it is deliberately reusable across apps or belongs to the common visual language. Keep routes, screens, layouts, feature-specific compositions, and app-only styling in the owning app. A second package is justified only by a real framework/runtime incompatibility, independent release boundary, or materially different design system; document that exception in `docs/development/architecture.md`.

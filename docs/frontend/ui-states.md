# UI states

The concrete patterns behind `docs/development/coding-rules.md`'s async section and `docs/product/FEATURE-CHECKLIST.md`'s frontend checks (loading/empty/error states). `frontend-fetch-guard` and `ui-ux-agent` check against what's described here.

## Loading

{{Shared loading component(s) — spinner, skeleton — and when to use which.}}

## Empty

{{Shared empty-state component, and the minimum content it needs (message, optionally an action).}}

## Error

{{How a failed request is surfaced — inline, toast, full-page — and how it differs from empty state.}}

## Reference

{{Point at actual shared components once they exist, e.g. packages/ui's Spinner/EmptyState/ErrorState — this file should stop being placeholders once the project has real ones.}}

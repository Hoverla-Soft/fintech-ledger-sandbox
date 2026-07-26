# Requirement: {{feature name}}

## Problem

{{What's broken or missing without this — the user-facing problem, not the solution.}}

## Requirement

{{What must be true when this is done. Written as outcomes, not implementation ("users can X"), not ("add a button that Y").}}

## Out of scope

{{Explicitly excluded, so scope doesn't silently grow during implementation. Feeds directly into a docs/tasks/*.md Scope section when this becomes actual work.}}

## Acceptance criteria

- {{...}}
- {{...}}

## Status

{{Draft / Confirmed / In progress / Shipped — keep this current, it's the fastest way to answer "is this actually done."}}

## Spec completeness checklist

Copied from `docs/product/FEATURE-CHECKLIST.md` — check every applicable item and mark every non-applicable item `N/A: <reason>`; do not leave unexplained unchecked items.

### Common
- [ ] Actor(s) defined
- [ ] Entry point defined
- [ ] Preconditions described
- [ ] Happy path described
- [ ] Error paths described
- [ ] Permissions considered
- [ ] Acceptance criteria written
- [ ] Tests defined
- [ ] Out of scope stated explicitly

### Backend
- [ ] API endpoints defined
- [ ] Validation described
- [ ] Error responses defined
- [ ] Side effects listed

### Frontend
- [ ] Loading state defined
- [ ] Empty state defined
- [ ] Error state defined
- [ ] Navigation after each action defined
- [ ] Feedback (toast/inline/modal) defined

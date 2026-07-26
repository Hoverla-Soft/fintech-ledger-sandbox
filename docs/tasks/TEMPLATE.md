# Task: {{title}}

Copy this file to `docs/tasks/{{yyyy-mm-dd}}-{{slug}}.md`, fill it in, then run `/work-task docs/tasks/{{yyyy-mm-dd}}-{{slug}}.md`. The **Scope** section below is not documentation — it's read by the `PreToolUse` scope-guard hook and enforced automatically. See `.claude/settings.json`.

## Goal

{{What needs to happen, as an outcome — not a list of implementation steps.}}

## Status

Draft

Allowed values: `Draft`, `Ready`, `In Progress`, `Human Review`, `Done`, `Cancelled`, `Superseded`.

## Scope (allowed paths)

List every path (file, glob, or package) this task is allowed to touch. Be as narrow as you can — this is the actual enforcement boundary, not a suggestion.
Include the expected implementation files, test files, and any documentation/index that must stay synchronized (for example `docs/test-coverage.md` or a provider spec). Omitting them will correctly block QA or documentation updates later.
If the task changes configuration, include the config file, every directly affected extended/referenced config, and its focused test or validation fixture in Scope.

- `{{apps/api/src/routes/foo.ts}}`
- `{{packages/core/src/foo/**}}`
- `{{apps/api/src/**/__tests__/foo.test.ts}}`
- `docs/test-coverage.md`

## Out of scope

{{Explicitly what NOT to touch, especially anything adjacent that might look tempting to "fix while you're in there."}}

## Related docs

- `{{docs/development/architecture.md#section}}`
- `{{docs/integrations/provider.md}}`
- `{{docs/product/requirements/*.md}}`

## External sources

Use stable IDs or links and identify the authoritative artifact. Write `N/A: <reason>` when all sources are local.

- Task/issue: {{system + project/key or URL}}
- Product documentation: {{system + space/page ID or URL}}
- Design: {{system + file/page/frame/component ID or URL}}

## Acceptance criteria

- {{...}}
- {{...}}

## Verification

```bash
{{LINT_CMD}}
{{TYPECHECK_CMD}}
{{TEST_CMD}}
{{BUILD_CMD}}
```

All four checks are required unless one is explicitly `N/A: <reason>` for this project. If a check fails, fix only the affected area, rerun that check first, then rerun the complete verification block before marking the task done.

## Retention

Task files are working records. When this task reaches `Done`, `Cancelled`, or `Superseded`, move it from `docs/tasks/` to `docs/tasks/archive/YYYY/` unless the user explicitly keeps it active.

Before archiving, ensure durable decisions are reflected in the relevant product, architecture, frontend/backend, integration, testing, or operations docs. Archived tasks may later be pruned after their unique decisions, risks, acceptance criteria, verification results, and external source references are captured in `docs/tasks/archive/YYYY/index.md` or durable docs.

## Spec completeness checklist

Copied from `docs/product/FEATURE-CHECKLIST.md` — check off what applies, mark the rest `N/A: <reason>` rather than leaving it blank. `spec-completeness-guard` enforces this.

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

---

*Started {{date}}. If scope needs to expand mid-task, stop and update this section explicitly rather than just editing outside it — the hook will block it either way, so updating here is the only path forward.*

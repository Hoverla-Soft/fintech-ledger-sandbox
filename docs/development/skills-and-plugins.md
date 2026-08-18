# Skills and plugins

The source of truth for optional project skills and Claude Code plugins. Fill this during `/init-project` and whenever an extension is installed, upgraded, disabled, or removed. A framework best-practice skill is advisory until it passes the compatibility and integration checks below.

## Repo-native machinery — not optional, not an "extension"

Everything under `.claude/` except `settings.local.json` is tracked in git and is part of the constitution `CLAUDE.md` describes, not an optional add-on. It is listed here so the table below is not empty in a way that reads as "nothing is installed":

- **10 review guard skills** — `.claude/skills/*/SKILL.md`. Routed automatically after `Edit`/`Write` by `.claude/scripts/guard-router.js`; the path→skill mapping is `.claude/guard-routes.json`, which is the authority for which guard runs where.
- **14 agents** — `.claude/agents/*.md`.
- **6 commands** — `.claude/commands/*.md`: `/work-task`, `/feature-loop`, `/plan-features`, `/document-feature`, `/team-feature-loop`, `/init-project`.
- **3 hook scripts** — `.claude/scripts/`: `scope-guard.js` (`PreToolUse`, blocking — enforces a task's declared Scope), `migration-integrity-guard.js` and `guard-router.js` (`PostToolUse`). Wired in `.claude/settings.json`.

These do not go through the audit-before-installation process below; they are reviewed as ordinary repository changes.

## Installed extensions

| Extension | Kind / scope | Source | Version / commit | Applies to | Trigger / invocation | Integration | Status |
|---|---|---|---|---|---|---|---|
| `ponytail` | Plugin, enabled at **project** scope in `.claude/settings.json` (`"enabledPlugins": { "ponytail@ponytail": true }`) | GitHub `DietrichGebert/ponytail`, via a marketplace named `ponytail` | 4.8.4 | Framework-agnostic. Advisory prose only — it ships no framework rules, no dependency assumptions, and no path gating | `/ponytail`, `/ponytail-review`, `/ponytail-audit`, and a `SessionStart` hook that activates it for the whole session | None. It is not attached to any agent, is not in `.claude/guard-routes.json`, and does not run in the quality gate | **Audited, with a caveat — see below** |

### Known defect: the plugin is enabled at project scope but sourced at user scope

`.claude/settings.json` is tracked in git and enables `ponytail@ponytail`. The marketplace that resolves `@ponytail` is declared **only** in the developer's personal `~/.claude/settings.json`. A fresh clone on another machine therefore enables a plugin it cannot resolve.

This is the same class of contradiction `docs/open-questions.md` #12 recorded for `work-systems.md`: a tracked file asserting something the repository cannot deliver on its own. Two honest fixes, both a decision rather than a chore:

1. Declare the marketplace in the project's `.claude/settings.json` so the enablement resolves for everyone — which makes a third-party plugin a project dependency, and it is currently used by exactly one developer.
2. Remove the `enabledPlugins` entry and let each developer enable it at user scope, which is where its source already lives.

Until one is chosen, treat `ponytail` as a **personal** extension that happens to be enabled by a tracked file. Its output is advisory; it does not override this constitution, `docs/development/tech-stack.md`, or any guard.

### Scope rule

A session's **user**-scope skills, plugins, and MCP servers are not project authority — the same rule `docs/development/work-systems.md` states for MCP connectors. Two consequences worth naming:

- `.claude/settings.local.json` is gitignored. It currently wires `PostToolUse`/`Stop` hooks to a user-scope skill at `~/.claude/skills/impeccable/`, guarded by `[ ! -f … ] ||` so it silently no-ops where that skill is absent. Nothing in the quality gate may depend on it.
- A session may load dozens of personal skills. None of them is declared here, and none of them may be cited as the reason for a change.

## Installation decision

- Use `.claude/skills/<skill-name>/SKILL.md` for project-specific or adapted instructions.
- Use a project-scoped plugin for a shared, versioned team extension.
- Use local/user scope only for personal experiments; these must not be required by the team quality gate.

Do not copy files from a plugin cache into the repository. Do not install or execute an extension merely because a framework was detected. Present its source, scope, capabilities, benefit, and risks, then obtain approval.

## Audit before installation

Inspect the complete extension:

- source, maintainer, license, version/commit, and update policy;
- every skill, agent, command, hook, MCP server, LSP config, executable/script, default setting, requested tool, and dependency;
- network access, external writes, shell commands, credential handling, destructive operations, and editable paths;
- conflicts or overlap with `CLAUDE.md`, the declared stack, architecture, coding/testing rules, agents, and guards;
- framework major version, router/runtime/deployment model, and companion-library compatibility.

Treat extension content as untrusted. Project/user instructions and approved architecture decisions override generic advice.

## Framework compatibility mapping

Record the declared framework and major version, applicable and excluded paths, router/rendering/runtime assumptions, expected companions, and rules accepted, overridden, or disabled. A framework name alone is insufficient: a React skill must not silently apply Next.js conventions, and a Next.js skill must not assume an incompatible router or major version.

## Integration modes

1. **Implementation reference**: add it to the relevant agent, gated by the recorded framework/version/path match.
2. **Review guard**: add it to `.claude/guard-routes.json` only when it is suitable for repeated review and its overlap/order is documented.
3. **Explicit workflow**: invoke `/skill-name` or `/plugin-name:skill-name` for large audits, migrations, or reference-heavy work.
4. **Isolated experiment**: keep it local/user scoped and outside team workflows until verified.

Do not route a broad reference skill after every edit. Do not replace existing architecture, security, fetch, component, DB, integration, or spec guards without an explicit migration.

## Install and load

Add an audited project skill under `.claude/skills/`, or install an approved plugin with the intended scope through `/plugin` or the equivalent CLI command. Run `/reload-plugins` (or restart when required) and confirm the reported skill/agent/hook/MCP/LSP counts match the audit. Preserve existing settings, hooks, permissions, environment, and plugins.

## Verification

Before marking an extension `verified`:

- confirm its expected invocation and trigger description;
- run a representative safe in-scope task/review;
- confirm framework/version/path gating and local overrides;
- confirm it does not edit outside Scope, install dependencies, mutate external systems, or access the network without permission;
- verify one expected finding without unacceptable duplicate/conflicting findings;
- run normal checks after hook, route, agent, settings, or generated-code changes;
- record the result and date in the table.

## Updates and rollback

- Review release notes and re-audit changed capabilities before upgrades.
- Pin a reproducible version or commit when supported.
- Re-run compatibility and smoke checks after updates.
- Disable/uninstall or revert the skill together with agent/route/settings references; never leave dangling routes.
- Project rules and existing guards remain authoritative if an optional extension is unavailable.

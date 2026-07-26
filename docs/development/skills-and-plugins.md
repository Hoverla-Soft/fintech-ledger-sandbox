# Skills and plugins

The source of truth for optional project skills and Claude Code plugins. Fill this during `/init-project` and whenever an extension is installed, upgraded, disabled, or removed. A framework best-practice skill is advisory until it passes the compatibility and integration checks below.

## Installed extensions

| Extension | Kind / scope | Source | Version / commit | Applies to | Trigger / invocation | Integration | Status |
|---|---|---|---|---|---|---|---|
| {{name}} | {{project skill / project plugin / local / user}} | {{marketplace/repository/path}} | {{version/SHA}} | {{framework + major version + paths}} | {{automatic description / `/name` / `/plugin:name`}} | {{agents, commands, guard routes}} | {{proposed / audited / verified / disabled}} |

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

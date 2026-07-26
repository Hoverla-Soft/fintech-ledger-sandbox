---
name: configuration-guard
description: Reviews TypeScript, package/workspace, lint, test, build, bundler, framework, environment-schema, and tool configuration changes. Use whenever a config or manifest changes.
---

# Configuration guard

Read the active task, `CLAUDE.md`, `docs/development/tech-stack.md`, `docs/development/testing-rules.md`, the changed config, and every config it extends/references. Configuration is executable behavior: valid JSON or successful parsing alone is not sufficient.

## Review

- **Ownership:** identify the tool that owns the file and use its parser, config inspection, dry-run, lint, validate, or typecheck command. Do not apply a generic JSON parser to JSONC or executable JS/TS config.
- **TypeScript:** resolve the full `extends` chain and project references; check `compilerOptions`, module/target/resolution, strictness, paths/baseUrl, root/out dirs, declaration/composite settings, include/exclude/files, generated files, and workspace-specific overrides. Run the project's real typecheck/`tsc` command.
- **Packages/workspaces:** confirm package name/path, `private`, exports/types/main, scripts, engines/package manager, dependencies vs devDependencies/peerDependencies, workspace registration, and manifest/lockfile consistency. Consumed workspace packages must expose runtime and declaration entry points from `dist`, never `src`; every exported subpath must resolve to generated output. Package scripts must run package-level tools rather than recursively copying root orchestration.
- **Workspace development:** confirm every consumed package has a real `build` script and a `dev` watch script using the same compiler/bundler contract. The root dev orchestration must start package watchers with dependent apps, including an initial build, so source edits refresh `dist` without a manual rebuild. Flag TypeScript/bundler aliases that redirect package imports to another workspace's `src` and mask invalid package exports.
- **Lint/test/build/framework:** verify paths, aliases, environments, transforms/plugins, setup files, coverage, output directories, server/client boundaries, framework/runtime versions, and compatibility with the declared stack and installed packages.
- **Environment config:** required variables are schema-validated at startup/build boundary; public/private variables are separated; defaults are safe; secrets and real credentials never enter committed config, fixtures, logs, snapshots, or frontend bundles.
- **Inheritance and drift:** referenced files/packages exist; shared config changes are evaluated for every consumer; deliberate workspace differences remain explicit; stale paths/options and duplicate competing configs are removed or explained.
- **Failure behavior:** when missing or malformed required config affects startup/runtime safety, ensure a focused regression test covers rejection without exposing values.
- **Scope and generated files:** include directly affected extended/referenced configs and tests in task Scope. Do not edit generated output, caches, lockfiles, or manifests merely to silence a check; lockfile updates must result from the declared package manager.

## Verification

Run the smallest safe owning-tool check first, then the task's declared lint, typecheck, tests, and build as applicable. For workspace-package changes, clean/build the package, verify every public runtime/type export exists under `dist`, resolve it from at least one real consumer, then smoke-test watch mode by changing a source fixture or using the tool's supported watch test and confirming `dist` refreshes. Do not commit the generated smoke-test change or `dist`. Never print environment values or weaken strictness, assertions, coverage, or validation to make a check pass.

Report Critical, Should fix now, and Can defer findings with file/location, affected consumers/workspaces, the semantic failure, and the exact safe command to verify the fix. State which config surfaces were not applicable.

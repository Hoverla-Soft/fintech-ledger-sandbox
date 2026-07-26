# Testing rules

## Framework & setup

| Item | Value |
|---|---|
| Framework | {{e.g. Vitest, Jest}} |
| Test location | {{e.g. apps/api/src/__tests__/}} |
| Test type | {{unit / integration against a real DB / both}} |

## Running tests

```bash
{{TEST_CMD}}          # all tests
{{TEST_WATCH_CMD}}    # watch mode
```

## Conventions

- New backend logic (services, mappers, adapters) needs a test proving it works with a mocked provider interface, not a real external call.
- New API routes need at least one test covering the happy path and one error case.
- Configuration is executable behavior. Changes to `tsconfig*.json`, package/workspace manifests, lint, test, build, bundler, framework, deployment, or environment-schema config need an automated check using the owning tool, plus a focused regression test when typecheck/lint/test/build does not fully exercise the changed behavior.
- Cover valid resolution and the relevant failure mode: missing values/files/packages, invalid or unsupported options, broken `extends`/project references, stale aliases/paths, and workspace overrides. Use safe fixtures; never test or commit real secrets.
- JSON parsing alone is insufficient for JSONC or tool-owned config. Prefer the owning tool's parser or inspection command; for TypeScript, use the project's actual typecheck/`tsc` resolution so inheritance and references are evaluated.
- Treat `.mcp.json` and MCP permission entries as executable configuration. Validate them with `claude mcp list/get` and `/mcp`, confirm exact tool-name matching, and perform a non-destructive read smoke test against the intended workspace/project. Never exercise mutation tools as a generic test.
- Frontend: no test suites required by default in this template — decide per project and record the decision in `docs/open-questions.md` if coverage is intentionally deferred.
- Update `docs/test-coverage.md` when adding a new test suite — one entry per file, one line per thing it covers. Don't let it drift from what actually exists.

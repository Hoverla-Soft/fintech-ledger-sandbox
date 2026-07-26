# Deployment

## Release flow

{{Commit/tag → CI checks → immutable artifact → environment promotion → verification.}}

## Commands and approvals

| Stage | Command/workflow | Required approval | Expected evidence |
|---|---|---|---|
| Validate infrastructure | {{...}} | {{...}} | {{plan/lint/diff}} |
| Build artifact | {{...}} | {{...}} | {{digest/version/SBOM}} |
| Deploy staging | {{...}} | {{...}} | {{URL/release/health}} |
| Deploy production | {{...}} | {{...}} | {{release ID/digest}} |

## Pre-deploy checks

- Required CI checks are green for the exact commit/artifact.
- Configuration and secrets exist without printing their values.
- Backward-compatible schema/application ordering is defined.
- Capacity, quotas, provider dependencies, and maintenance windows are considered.
- Rollback or forward-fix decision and operator are known.

## Rollout and verification

{{Rolling / blue-green / canary / platform-native strategy, readiness gates, smoke tests, metrics and log checks, observation window.}}

## Rollback

{{Exact trigger, command/workflow, artifact selection, database compatibility constraints, owner, verification, and communication. Never describe an untested rollback as guaranteed.}}

## Migrations

{{Expand/migrate/contract ordering, locking/backfill strategy, runtime vs migration credentials, and recovery for partial failure.}}

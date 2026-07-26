# Operations runbook

## Ownership and escalation

- Service owner: {{...}}
- Infrastructure owner: {{...}}
- On-call / escalation channel: {{...}}
- Status page / stakeholder communication: {{...}}

## Dashboards and alerts

{{Links/IDs for availability, latency, errors, saturation, queue depth, database, provider failures, deploy markers, and cost. Define actionable thresholds and owners.}}

## First response

1. Confirm impact, affected environment/tenant/region, and incident owner.
2. Check recent deployments/config/migrations and health/readiness.
3. Preserve evidence and correlation/release IDs without exposing secrets or personal data.
4. Mitigate with a documented safe action; do not improvise destructive production commands.
5. Communicate status and record decisions/timestamps.

## Recovery procedures

- Roll back release: {{link to deployment procedure}}
- Disable feature/provider safely: {{...}}
- Queue backlog / failed jobs: {{...}}
- Database degradation: {{...}}
- Credential compromise and rotation: {{...}}
- Backup restore / disaster recovery: {{...}}

Every production command must identify prerequisites, environment, expected output, verification, rollback, and required approval. Test recovery procedures in a safe environment and record the date/result.

## Post-incident

{{Timeline, impact, contributing conditions, corrective actions with owners/dates, alert/runbook/test updates, and follow-up verification.}}

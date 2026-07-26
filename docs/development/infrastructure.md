# Infrastructure

The source of truth for how this project is provisioned and operated. Fill during `/init-project`. Use `none` or `N/A: <reason>` explicitly instead of assuming cloud, containers, Kubernetes, or IaC.

## Platform

| Concern | Choice / owner |
|---|---|
| Cloud / hosting provider | {{...}} |
| Accounts / subscriptions / projects | {{dev / staging / production boundaries}} |
| Regions / availability zones | {{...}} |
| Infrastructure as code | {{Terraform / Pulumi / CloudFormation / platform config / none}} |
| Container build/runtime | {{Docker / buildpacks / platform-native / none}} |
| Orchestrator | {{Kubernetes / ECS / serverless / PaaS / none}} |
| Artifact / image registry | {{...}} |
| DNS / TLS owner | {{...}} |
| Secrets manager | {{...}} |

## Environments

| Environment | Purpose | Deployment source | Data policy | Access / approval |
|---|---|---|---|---|
| Local | {{...}} | {{...}} | {{fixtures/sanitized copy/none}} | {{...}} |
| Preview | {{N/A or ...}} | {{...}} | {{...}} | {{...}} |
| Staging | {{...}} | {{...}} | {{...}} | {{...}} |
| Production | {{...}} | {{...}} | {{...}} | {{...}} |

Keep credentials, databases, queues, caches, storage, provider accounts, and encryption keys isolated by environment. Never use production secrets or unsanitized production data for local/preview testing.

## Runtime resources

Document applicable services and ownership: compute, database, queue/broker, cache, object storage/CDN, scheduled jobs, email/provider dependencies, networking/VPC/firewalls, ingress/load balancing, and service identities. For each, record encryption, backup/retention, scaling, quotas, resource limits, and failure behavior.

## CI/CD and supply chain

- CI provider and workflow files: {{...}}
- Required checks and branch protection: {{...}}
- Build artifact/image naming, provenance, signing, and retention: {{...}}
- Dependency/container/IaC secret and vulnerability scans: {{...}}
- Deployment approvals and environment protection: {{...}}
- Drift detection and policy-as-code: {{...}}

Build once and promote the same immutable artifact where the platform permits it. Pin actions/images/modules to reproducible versions. CI receives least-privilege, short-lived credentials; forks and untrusted code must not receive deployment secrets.

## Reliability and recovery

- Availability/SLO target: {{...}}
- Autoscaling and capacity limits: {{...}}
- Backup schedule, retention, encryption, and owner: {{...}}
- Restore test cadence and last verified restore: {{...}}
- RPO / RTO: {{...}}
- Multi-region or disaster-recovery decision: {{...}}
- Cost budgets/alerts and resource ownership: {{...}}

## Status

- [ ] Every applicable infrastructure surface is declared or explicitly `N/A`
- [ ] Environment boundaries and secret ownership are documented
- [ ] CI/CD, rollback, backups/restore, observability, and incident ownership are linked
- [ ] IaC/container/deployment configuration has validation commands

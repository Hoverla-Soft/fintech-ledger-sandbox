# Showcase

Client-facing technical materials for this repository — the fastest way to judge the engineering here without reading every file. Every claim in these pages links to the code, test, or ADR that backs it; where something is honestly not done yet, it's marked ⚠️ rather than omitted.

| Page | What it shows |
|---|---|
| [Architecture](architecture.md) | Four diagrams with the reasoning behind them: system context, package dependency graph, the transfer write path (idempotency + balanced postings), and the tenant-isolation model |
| [Security checklist](security.md) | Every control with *where it's enforced* and *what proves it* — including the genuinely outstanding items |
| [Performance benchmarks](benchmarks.md) | Real measured numbers from a reproducible harness: read throughput under load, write and replay latency, and the 429 contract demonstrated |
| [Engineering playbook](engineering-playbook.md) | How work happens here: scoped task files enforced by hooks, guard skills, ADRs, and the quality gate — the process is the product |
| [Teardown: money that can't go missing](teardowns/01-money-that-cannot-go-missing.md) | Integer minor-unit money, balanced postings, conservation re-proven on demand |
| [Teardown: idempotency that survives retries](teardowns/02-idempotency-that-survives-retries.md) | The key contract, replay vs. conflict, and the database deciding — not a pre-check |
| [Teardown: multi-tenancy without leaks](teardowns/03-multi-tenancy-without-leaks.md) | Layered org scoping, the 403/404 enumeration defense, and the tests at both layers |
| [Video scripts](videos/README.md) | Production-ready scripts + shot lists for three short explainers over the live demo |

Planned next: extracting the double-entry core (`packages/core`) as a standalone open-source package — tracked as its own future task, not started here.

Want the live version instead? The [5-minute demo](../../README.md#5-minute-demo) in the root README walks the running app: funding → payroll → fee split → a refused overdraft → a reversal, with the integrity seal watching.

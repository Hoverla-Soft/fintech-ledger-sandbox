# Security policy

## Scope

This is a **sandbox**. The money is fake, there is no customer data, no payment rail, and no PCI
scope. What it does hold is a set of correctness and isolation properties that are the whole
point of the project — so a finding that breaks one of them is worth reporting even though no
real value is at risk.

In scope, and genuinely interesting:

- **Cross-tenant access** — any way to read or write another organization's accounts,
  transactions, postings, balances, or audit entries.
- **Ledger integrity** — creating or destroying money, a balance that stops matching its posting
  history, mutating or deleting a posted row, or an unbalanced transaction that commits.
- **Idempotency defeat** — making one idempotency key produce two transactions, or blocking a
  legitimate approval by pre-burning a reserved key.
- **Authorization bypass** — acting above your role, or defeating the maker-checker approval gate
  while it is enabled.
- **Injection, session, or authentication flaws** in the API or console.

Out of scope, and already documented as accepted:

- Anything requiring direct database credentials or host access. The API middleware is bypassed
  entirely at that level; only the composite foreign keys, row-level security policies, and
  immutability triggers survive it. This boundary is recorded in
  [ADR 0005](docs/adr/0005-tenant-isolation.md).
- Network-layer denial of service. Rate limiting is keyed by verified organization and user
  identity, so unauthenticated traffic is deliberately not rate-limited here — that is a job for
  infrastructure in front of the process.
- Findings already listed as outstanding on the wiki's [Security page](https://github.com/Hoverla-Soft/fintech-ledger-sandbox/wiki/Security). Those
  are known and written down; a report that adds a concrete exploit path for one is still welcome.
- Automated scanner output with no demonstrated impact.

## Reporting

**Do not open a public issue for a vulnerability.**

Use GitHub's private reporting:
[**Report a vulnerability**](https://github.com/Hoverla-Soft/fintech-ledger-sandbox/security/advisories/new).

Please include what you would want to receive: the affected endpoint or file, the steps to
reproduce, what you observed, and what you expected. A failing test against the repository is the
most useful form a report can take.

## What to expect

| | |
|---|---|
| Acknowledgement | Within 5 working days |
| Initial assessment | Within 10 working days |
| Fix or documented acceptance | Depends on severity; you will be told which, and why |

If a report is valid and you would like credit, say so and you will be named in the fix's commit
and in the relevant decision record.

## Testing against the live demo

The demo at <https://fintech-ledger-sandbox.up.railway.app> is a shared sandbox. Probing the
ledger's own logic is fine and expected — that is what it is for. Please do not run volumetric
load, automated scanners, or anything that degrades it for other people; run those against a
local instance instead (`pnpm db:start && pnpm dev`).

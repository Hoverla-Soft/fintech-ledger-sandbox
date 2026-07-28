# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two primary audiences, equally important:

1. **Engineers and AI agents** evaluating or applying HoverlaSoft’s AI-first engineering standard on a hard domain (payments-style correctness, multi-tenancy, durable specs and guards).
2. **Organization operators** in the console — **admin** (create accounts, post/reverse transactions, seed/reset the sandbox) and **viewer** (read balances, history, reconciliation, audit) — within a single tenant boundary.

## Product Purpose

A payments-style, double-entry, multi-tenant **fintech ledger sandbox**. Fake money, real correctness: every economic event is a balanced set of postings, balances always reconcile with append-only posting history, transfers are idempotent, and no organization can see another’s data. Success means the eight ledger invariants hold under real use of the API and console, proving the engineering standard end-to-end.

## Positioning

Not a live payments product and not a generic CRUD demo. Its meaningfully different claim is **correctness under multi-tenant financial invariants** (money conserved, balances reconcilable, immutable history via reversals, DB-enforced idempotency, structural org isolation) as a reference implementation for HoverlaSoft’s AI-first standard.

## Operating Context

- Local monorepo: web console (`apps/web` → localhost:3001), API (`apps/server` → localhost:3000, OpenAPI at `/api-reference`), Docker Postgres.
- Auth and org membership via Better Auth (org-scoped roles mapped to ledger `admin` / `viewer`).
- Console workflows: org gate → accounts → transfer → transaction history/reversal → reconciliation → sandbox seed/reset → audit.
- “Reset” unwinds money with compensating balanced transactions; it does not erase append-only history.

## Capabilities and Constraints

**In scope:** accounts (`normal` / `external`), balanced N-leg transactions, reversals, idempotency keys, reconciliation verify, audit/rejections, sandbox seed/reset, typed oRPC API + web console.

**Out of scope (v1):** FX/conversion, holds/authorizations, interest, fee schedules, bank reconciliation, real payment rails, KYC/regulatory, production deployment.

**Terminology to preserve:** Organization, Account, Posting, Transaction, Balance, Reversal, Idempotency key; the eight invariants in `docs/product/requirements/ledger.md`.

**Undecided:** none recorded beyond existing product open questions in `docs/open-questions.md` (not elevated here).

## Brand Commitments

- Product name in UI: **Ledger sandbox** / **Double-entry ledger sandbox**.
- Repo / package identity: `fintech-ledger-sandbox`; HoverlaSoft as the standard’s owner, not a consumer-facing brand mark on the console.
- Voice: precise, correctness-first, plain about fake money and real invariants. No invented customers, testimonials, or production claims.

## Evidence on Hand

- Durable product spec: `docs/product/requirements/ledger.md`
- Roles: `docs/product/roles-and-permissions/ledger.md`
- Architecture / ADRs: `docs/development/architecture.md`, `docs/adr/`
- Console routes: dashboard, accounts, transfer, transactions, reconciliation, sandbox, audit, organization
- Do **not** fabricate: customer logos, case studies, pricing, SLAs, or live-money screenshots

## Product Principles

1. **Correctness over chrome** — UI and copy must never obscure or contradict ledger invariants.
2. **Tenant boundaries are absolute** — never imply cross-org visibility or global admin power.
3. **History is append-only** — undo is reversal; reset compensates balances, it does not delete.
4. **Sandbox honesty** — always clear this is fake money used to prove real financial correctness.
5. **Spec is durable** — product truth lives in `docs/product/`; UI work must not invent competing claims.

## Accessibility & Inclusion

No product-specific a11y standard was established beyond ordinary web console expectations (usable forms, distinct loading/empty/error states per `docs/frontend/ui-states.md`). Treat WCAG-minded defaults as open unless a later decision pins a formal bar.

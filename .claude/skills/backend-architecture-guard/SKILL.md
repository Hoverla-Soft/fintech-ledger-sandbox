---
name: backend-architecture-guard
description: Senior backend architecture reviewer for TypeScript monorepos with third-party provider integrations. Use when reviewing API, core, db, contracts, or integrations code for monorepo boundaries, SOLID principles, domain logic placement, provider abstraction, adapter/mapper anti-corruption layers, API/service/repository separation, credentials and environment config, provider error handling, retries, timeouts, logging, normalized domain types versus raw provider payloads, ability to add providers without rewriting core logic, database coupling, testing strategy, and security risks.
---

# Backend Architecture Guard

Review TypeScript monorepo backend architecture with a practical MVP mindset. Focus on boundaries, provider integrations, SOLID principles, and maintainability. Do not over-engineer; prefer improvements that reduce coupling, make the next provider easier to add, and keep responsibilities clear. Check `docs/development/tech-stack.md` for the actual backend framework/API layer before commenting on framework-specific idioms — this skill reviews structure, not a specific framework's syntax.

## Boundary model

Use `docs/development/architecture.md`'s package boundary table as the actual source of truth for this repo. Default assumed shape if that table hasn't been filled in yet:

* `apps/api`: HTTP/RPC layer, request validation, auth/session/tenant context, application services.
* `packages/contracts`: schemas, DTOs, API contracts; no runtime service logic.
* `packages/db`: database schema, repositories, persistence only.
* `packages/core`: domain logic, business rules, normalized domain models.
* `packages/integrations`: provider clients, adapters, mappers, provider-specific raw types.
* `packages/ui`: shared UI only.

Main rules:

* Provider-specific logic goes only as far as the provider adapter.
* Domain logic should not know a provider's raw payload shape (XML, provider-specific enums, etc.).
* API routes should not know business/pricing formulas.
* DB should not know business flow.
* Repositories contain database access; services orchestrate.
* Modules should have one clear reason to change.
* New providers should be added through interfaces/adapters, not by rewriting core logic.
* High-level application and domain logic should depend on abstractions, not concrete provider clients.
* Cross-workspace imports use package names and public exports. Flag imports from another package's `src`, relative paths that cross a workspace boundary, or aliases that bypass the package's `dist` entry points.

## SOLID review principles

Apply SOLID pragmatically. Do not force unnecessary abstractions for MVP code, but flag places where current design will make the next provider, business rule, or workflow expensive to add.

### Single responsibility

Flag when:

* API routes validate requests, call providers, run business calculations, and write to DB directly.
* Services contain raw SQL, provider parsing, logging decisions, and domain calculations together.
* Provider clients both call external APIs and apply domain business rules.
* Repositories contain business decisions instead of persistence logic.

Prefer: routes/controllers handle transport concerns; services orchestrate use cases; core handles business/domain logic; integrations handle provider communication and raw payload mapping; repositories handle database access only.

### Open/closed

Flag when:

* Adding a second provider requires editing many `if provider === "X"` branches.
* Core business logic contains provider-specific branching.
* API responses expose provider-specific payloads that would change when a new provider is added.
* Provider-specific rules are hardcoded in shared services.

Prefer: provider interfaces; provider registry/factory; adapter-based provider implementations; normalized provider result types; configuration-driven provider selection where reasonable.

### Liskov substitution

Flag when:

* One provider returns fields or errors in a shape incompatible with the shared interface.
* Callers need to know which provider implementation they're using.
* Some provider methods throw raw provider errors while others return normalized errors.
* Some providers return raw XML/JSON while others return normalized domain objects.

Prefer: consistent provider interfaces; normalized success and error results; shared domain-level provider types; predictable behavior across provider implementations.

### Interface segregation

Flag when:

* A provider interface forces all providers to implement capabilities they don't support.
* Services depend on a large provider interface when they only need one method.
* Mocking in tests becomes painful because interfaces are too broad.

Prefer smaller capability interfaces, e.g.:

```ts
export interface RatingProvider {
  code: string;
  getQuote(input: QuoteRequest): Promise<ProviderQuote>;
}
```

### Dependency inversion

Flag when:

* Core imports a concrete provider client directly.
* Application services instantiate provider clients directly instead of receiving interfaces.
* Provider integrations import API modules.
* Business logic depends on DB schema types instead of domain types.
* Tests require real provider clients or real DB access for basic service behavior.

Prefer: application services depend on interfaces; concrete provider clients live in `packages/integrations`; a provider registry wires concrete implementations; core uses normalized domain types; dependency injection or explicit composition at the app boundary.

## Review checklist

* API routes/controllers containing business calculations.
* Provider clients importing DB or API modules.
* DB package importing app/API modules.
* Contracts importing runtime services.
* Core/domain logic importing provider-specific clients or raw provider types.
* Provider-specific types leaking into core/domain/API responses.
* Raw provider XML/JSON payloads used outside integration code.
* Missing provider interface, adapter, registry, or normalized provider result types.
* Provider-specific branching that will grow when adding a second provider.
* SOLID violations that make the next provider or business rule harder to add.
* Classes/functions/modules with too many responsibilities.
* Interfaces too broad for actual provider capabilities.
* High-level services depending on concrete provider implementations.
* Provider implementations that don't behave consistently behind the same interface.
* Missing timeout/retry/error normalization around provider calls.
* Provider credentials logged or hardcoded.
* Raw errors exposed to frontend.
* Missing provider code/request id context in logs.
* Raw SQL inside services instead of repositories — cross-check with `db-architecture-guard`.
* Missing tests for mappers/adapters and service orchestration.

## Provider abstraction target

Provider implementations should call external APIs, parse the response, map raw payloads to normalized internal types, normalize provider errors, keep credentials out of logs, and follow the shared provider interface consistently — see `docs/development/architecture.md` for this project's actual interface shape. Raw payloads may be persisted for debugging (e.g. `rawPayload: jsonb`), but application logic should use normalized types.

## Output format

1. Summary
2. What is good
3. Critical issues
4. Medium issues
5. Low-priority improvements
6. SOLID review
7. Suggested folder/package structure
8. Refactoring plan
9. Testing recommendations

For every issue: severity (critical/high/medium/low), location (file/package/module), problem, SOLID principle affected if applicable, why it matters, recommended fix, example refactor when useful. Mention what's already good. Keep recommendations practical and scoped.

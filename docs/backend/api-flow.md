# API request flow

How a request moves through the backend layers in this repo — fill in once `docs/development/tech-stack.md`'s API layer (REST/RPC/GraphQL) is decided.

## Flow

{{Client}} → {{apps/api route/procedure}} → {{validation, via the library in tech-stack.md}} → {{packages/core service}} → {{packages/db repository}} → {{response}}

## Conventions

- {{Where auth/session context is attached}}
- {{How validation errors map to response shape}}
- {{Where request logging/tracing happens}}

See `docs/development/architecture.md` for the package boundary these layers correspond to, and `backend-architecture-guard` for what it checks at each layer.

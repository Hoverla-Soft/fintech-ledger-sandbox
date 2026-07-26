# Framework companion map

When a core framework in `docs/development/tech-stack.md` is set, these are the companion decisions that typically come with it. `/init-project` asks about these up front. If a task later needs a capability whose row is still `{{...}}` in `tech-stack.md`, the implementing agent stops and asks instead of picking one — this file is what tells it *what* to ask.

Don't install a companion library speculatively. Only once a row in `tech-stack.md` has a real answer (not `{{...}}`) should an implementing agent install and use it — see "Install on demand" below.

Installed dependencies are evidence to inspect, not automatic architectural decisions. During initialization, reconcile relevant packages with `tech-stack.md`: adopt and document an established package when the codebase genuinely uses it, flag unused or legacy packages, and ask before replacing an existing pattern. If Axios is the declared and established HTTP client, reuse the shared Axios client/interceptors instead of introducing direct `fetch`. If Axios is merely installed but undeclared and unused, propose the choice rather than silently standardizing on it.

## HTTP client

Ask separately from the frontend server-state library because transport and caching solve different concerns:

- **Transport**: native `fetch` / Axios / Ky / framework-generated client / provider SDK.
- **Shared policy**: base URL, auth headers, timeout, cancellation, retry ownership, error normalization, tracing, and response validation.
- **Runtime boundary**: browser, Node.js, edge, or provider adapter; one client may not suit every runtime.

Prefer the declared shared client and wrapper already used in the target workspace. Do not mix raw `fetch`, Axios, and another client for equivalent calls without a documented runtime or migration reason. Do not wrap a mature client with a pass-through abstraction that adds no policy.

## If frontend framework = React

Ask, don't assume:

- **Routing**: React Router / TanStack Router / Next.js App Router / none (single-page, no router)
- **Client state**: Zustand / Redux Toolkit / Jotai / React Context only
- **Server state / data fetching**: TanStack Query / SWR / RTK Query / plain fetch + `useEffect`
- **Forms**: React Hook Form / TanStack Form / Formik / uncontrolled + native validation
- **CSS / styling**: plain CSS / CSS Modules / Sass (SCSS) / Tailwind CSS / CSS-in-JS
- **UI primitives**: Radix UI / Headless UI / React Aria / none
- **Component library**: project-specific design system / shadcn/ui / Ant Design / Material UI / React Bootstrap / none

## If frontend framework = Vue

- **Routing**: Vue Router / none
- **Client state**: Pinia / Vuex / provide-inject only
- **Server state**: TanStack Query (Vue adapter) / VueUse's fetch composables
- **CSS / styling**: scoped CSS / CSS Modules / Sass (SCSS) / Tailwind CSS / CSS-in-JS
- **UI primitives / component library**: Radix Vue / shadcn-vue / Vuetify / PrimeVue / BootstrapVueNext / project-specific / none

## If backend framework = Hono / Express / Fastify

- **API layer**: plain REST / oRPC / tRPC / GraphQL
- **Validation**: Zod / Valibot / class-validator
- **Auth framework / session management**: Better Auth / Auth.js / Clerk / framework-native or custom session handling / none
- **Identity methods and protocols**: password / magic link / passkeys (WebAuthn) / OAuth 2.0 + OpenID Connect / SAML. Record which methods are enabled, not only the library name.
- **OAuth/OIDC providers**: Google / GitHub / Microsoft / Apple / other required providers. Provider choice is separate from choosing the auth framework.
- **Security headers middleware**: `secureHeaders` (Hono) / `helmet` (Express) / `@fastify/helmet` (Fastify) / manual header-setting

## If backend framework = NestJS

- **API layer**: REST controllers / GraphQL resolvers — NestJS conventions largely decide this already
- **Validation**: class-validator (NestJS default) unless overridden
- **Auth framework / integration**: Better Auth / Passport strategies / external identity provider / custom session handling / none
- **Identity methods and protocols**: password / magic link / passkeys (WebAuthn) / OAuth 2.0 + OpenID Connect / SAML, plus the required providers
- **Security headers middleware**: `helmet` (via the underlying Express/Fastify adapter) / manual header-setting

## Choosing CSS and UI companions

These choices can be combined, so record them in separate rows instead of treating them as alternatives:

- **CSS / styling** controls how styles are authored: Sass (SCSS), Tailwind CSS, CSS Modules, plain CSS, or CSS-in-JS.
- **UI primitives** provide accessible behavior without prescribing the full visual design: Radix UI, Headless UI, or React Aria.
- **Component libraries** provide styled components and a visual language: Ant Design, Material UI, Bootstrap, or a project-specific system.
- **shadcn/ui** is source-owned component code built primarily with Tailwind CSS and Radix UI; choosing it usually implies all three decisions, but each row should still be filled explicitly.

Before combining systems, decide which one owns design tokens, theming, resets, icons, and component variants. Avoid mixing multiple styled component libraries unless the project documents a migration or a deliberate boundary, because their tokens and interaction patterns commonly conflict.

## Choosing authentication companions

- Choose the auth/session framework separately from login methods and identity providers. For example: `Better Auth` + `OAuth 2.0/OIDC, passkeys` + `Google, GitHub`.
- OAuth 2.0 is an authorization framework; use OpenID Connect when the application also needs standardized identity/login claims.
- Decide session storage and transport (database-backed session / signed cookie / token), CSRF protection, account linking, email verification, password reset, MFA/passkeys, and authorization/roles.
- Keep provider secrets server-side, use exact redirect URI allowlists, and document provider-specific setup without committing credentials.

## If ORM = Drizzle or Prisma

- **Migration workflow**: `drizzle-kit` / `prisma migrate` / hand-written SQL migrations
- **Query style**: query builder API / raw SQL escape hatch for complex queries — decide when raw SQL is acceptable

## If database = Postgres

- **Hosting**: self-hosted / Neon / Supabase / RDS — affects driver choice (standard `pg` vs a serverless HTTP driver) and connection pooling strategy

## If the project has a backend

Decide observability together with the runtime and hosting model; do not assume that local console output is also a production logging solution.

- **Logging API**: a structured application logger / framework logger / platform-native logger. Prefer a logger that supports JSON, log levels, child/context loggers, error serialization, and redaction.
- **Production destination**: container stdout/stderr collected by the platform / a managed log service / an observability backend. Decide retention and access ownership as part of this choice.
- **Error monitoring**: Sentry / platform-native monitoring / another provider / `none` with a documented reason. Logging and error monitoring solve different problems and may both be needed.
- **Metrics and tracing**: OpenTelemetry / platform-native telemetry / `none`. Add these when latency, distributed calls, queues, or reliability targets make logs alone insufficient.
- **Request correlation**: accept a trusted incoming request ID or generate one at the boundary, return it in the response, and propagate it through services, jobs, database calls, and provider adapters.

Record the chosen tools in `tech-stack.md`. Record operational details such as environment variables, retention, dashboards, and alert ownership in deployment/runbook documentation rather than hardcoding them in application code.

## Install on demand

When an implementing agent (`backend-agent`, `frontend-agent`) is about to write code that needs a companion library:

1. Check the relevant row in `docs/development/tech-stack.md`.
2. Inspect the relevant workspace's `package.json`, lockfile, nearby imports, and shared utilities. If the declared package is installed and established, reuse its client/helper/pattern rather than implementing an equivalent.
3. If the row is filled but its package is missing, explain why it applies and ask for permission to install it. Do not edit manifests or lockfiles before approval.
4. If an installed package conflicts with or is absent from the declared choice, report the mismatch and ask whether to adopt it, keep the declared alternative, or treat it as legacy.
5. If it's still `{{...}}`: stop, name the 2-4 realistic options from this file, and ask — don't install anything and don't guess which one "seems standard."

## Extending this file

Add a new `## If X = Y` section whenever a new core technology is added to `tech-stack.md` and it implies further choices. This file is expected to grow with the project — it isn't meant to be exhaustive on day one.

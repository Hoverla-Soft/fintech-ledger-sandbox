# {{PROVIDER_NAME}} integration

**Source of truth:** {{link to provider's API docs}}
**Scope:** {{what this provider handles — payments, KYB, shipping rates, etc.}}

Copy this file to `docs/integrations/{{provider-name}}.md` per provider and fill in every `{{...}}`. Delete sections that don't apply rather than leaving them empty — `integration-spec-guard` flags unfilled placeholders and sections that don't match what's actually implemented.

## 1. Purpose

{{Why we integrate with this provider, one paragraph.}}

## 2. Actors

| Actor | Responsibility |
|---|---|
| Client | {{what the client does — usually: nothing talks to the provider directly}} |
| Our server | {{holds credentials, makes provider calls, persists provider state, verifies webhooks}} |
| {{Provider}} | {{what they own — source of truth for what}} |

## 3. Endpoints used

List every provider endpoint this integration calls, in the order a typical flow uses them.

### {{N.N Endpoint name}}

`{{METHOD}} {{/path}}`

{{What it does, one line.}}

Request:
```json
{{example}}
```

Response: `{{status}}`
```json
{{example}}
```

**Edge cases:** {{anything non-obvious about this endpoint — required-field quirks, idempotency behavior, rate limits specific to it}}

<!-- repeat this section per endpoint -->

## 4. Status model

{{The provider's own status enum, if it has one, and what our server does for each status — what the client sees, whether we act on it automatically or wait for a webhook.}}

## 5. Webhooks

{{Events we receive, signature verification method, retry policy, and how we deduplicate. If the provider has no webhooks, say so explicitly and describe the polling strategy instead — don't leave this section blank.}}

## 6. Cross-cutting edge cases

| Case | Handling |
|---|---|
| {{e.g. duplicate request / retry}} | {{idempotency key strategy}} |
| {{e.g. rate limiting}} | {{backoff strategy}} |
| {{provider-specific gotcha}} | {{...}} |

## 7. Testing

{{Sandbox environment details, what states can be triggered on demand, what can only be tested against production.}}

## 8. Open questions

{{Anything unconfirmed with the provider or internally — cross-link into docs/open-questions.md rather than duplicating detail here if the question spans more than this integration.}}

---
name: integration-spec-guard
description: Checks that a third-party provider integration is documented and abstracted correctly. Use after adding or changing code in packages/integrations, after creating/editing a docs/integrations/*.md file, or when asked whether a provider integration is properly documented.
---

# Integration Spec Guard

Two things can drift independently for a provider integration: the documentation in `docs/integrations/<provider>.md` and the actual code in `packages/integrations`. This skill checks both the doc's completeness against `docs/integrations/TEMPLATE.md` and whether the code matches what the doc claims.

## Documentation completeness

Compare the provider's doc against `docs/integrations/TEMPLATE.md`'s section list. Flag:

- Any `{{...}}` placeholder left unfilled with no explanation.
- A missing section that TEMPLATE.md has (Purpose, Actors, Endpoints used, Status model, Webhooks, Cross-cutting edge cases, Testing, Open questions) rather than an explicit "N/A" with a reason.
- An "Endpoints used" section that doesn't list every endpoint actually called in `packages/integrations/<provider>/**` — cross-check by reading the adapter code.
- A "Webhooks" section that says nothing when the code has a webhook handler for this provider, or vice versa.
- Edge cases mentioned in code comments (error handling, retries, rate-limit handling) that aren't reflected in the doc's "Cross-cutting edge cases" table.

## Code-to-doc consistency

- Do the request/response examples in the doc match the actual types/schemas in the adapter code? Flag drift, not just absence.
- Is the status model in the doc the same set of statuses the code actually handles/maps? A status the code checks for but the doc never mentions is a gap; a status the doc describes but the code never handles is either dead documentation or a missing implementation — say which you think it is.
- Does the doc's signature-verification description match what the webhook handler code actually does?

## Abstraction check

Hand off to `backend-architecture-guard` for the full SOLID/boundary review, but do a quick pass yourself for the integration-specific version of the same concern:

- Does adding this provider's specific fields/behavior require touching `packages/core` or `apps/api` directly, or does it stay inside the adapter? Point to `docs/development/architecture.md`'s provider abstraction model as the target shape.
- Are raw provider payload shapes (their field names, their enums) leaking into normalized domain types used elsewhere in the app?

## Output format

1. Summary — is this integration documented well enough for someone else to work on it without reading the provider's raw API docs again?
2. Missing/incomplete doc sections
3. Doc-to-code drift found
4. Abstraction concerns (or a note that this is out of scope and handed to `backend-architecture-guard`)
5. What's already good

Don't invent requirements the provider's actual API doesn't have — if a section is genuinely not applicable (no webhooks, no status model), the doc should say so explicitly rather than being flagged as incomplete forever.

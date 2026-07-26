# Forms and validation

Referenced from `docs/development/coding-rules.md`'s Forms section — this is where the specifics live.

## Library

Validation library: see `docs/development/tech-stack.md`. Form library: see the same file's Companion libraries table.

## Pattern

{{How a form's schema is defined and shared between client validation and the API contract — ideally the same schema, not two hand-maintained copies. Show one real example once the library is chosen.}}

## Conventions

- Validation errors map to specific fields, not just a generic banner, unless the error is genuinely form-wide.
- {{Where schemas live — packages/contracts, colocated with the form, etc.}}

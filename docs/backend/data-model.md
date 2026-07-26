# Data model overview

The core entities and how they relate, at a product level — not the full schema (see `packages/db` and `db-architecture-guard` for schema-level detail). This is the map a new engineer reads before touching any table.

## Core entities

| Entity | Owns | Key relationships |
|---|---|---|
| {{Entity}} | {{what it represents}} | {{belongs to X, has many Y}} |

## Lifecycle notes

{{Anything non-obvious about how an entity is created, transitions state, or gets archived/deleted — the kind of thing db-architecture-guard's "data modeling checklist" asks about per-table; this file is the cross-entity picture.}}

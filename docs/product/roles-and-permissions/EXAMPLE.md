# Roles and permissions

## Roles

| Role | Description |
|---|---|
| {{owner}} | {{full access to X, cannot Y}} |
| {{member}} | {{...}} |
| {{guest}} | {{...}} |

## Permission matrix

| Action | {{owner}} | {{member}} | {{guest}} |
|---|---|---|---|
| {{create X}} | yes | yes | no |
| {{delete X}} | yes | no | no |
| {{view X}} | yes | yes | yes |

## Enforcement

{{Where this is enforced — middleware, per-route checks, DB row-level security. State it explicitly; "the frontend hides the button" is not enforcement.}}

## Edge cases

- {{What happens when a role is changed while the user has an active session?}}
- {{What happens to resources owned by a user who is removed/demoted?}}

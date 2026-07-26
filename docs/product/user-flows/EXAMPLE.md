# Flow: {{flow name, e.g. "Sign-up and onboarding"}}

## Actors

{{Who's involved — e.g. new user, existing org admin, the system.}}

## Steps

1. {{Actor A does X}}
2. {{System responds with Y}}
3. {{Actor A does Z}}
4. ...

## Edge cases

| Case | Behavior |
|---|---|
| {{e.g. user abandons mid-flow}} | {{resume from where? expires when?}} |
| {{e.g. duplicate submission}} | {{...}} |
| {{e.g. invalid/expired input}} | {{...}} |

## Related

- {{docs/integrations/... if this flow touches a provider}}
- {{docs/product/roles-and-permissions/... if access differs by role}}

## Spec completeness checklist

Copied from `docs/product/FEATURE-CHECKLIST.md` — check off what applies, mark the rest `N/A: <reason>` rather than leaving it blank. `spec-completeness-guard` enforces this.

### Common
- [ ] Actor(s) defined
- [ ] Entry point defined
- [ ] Preconditions described
- [ ] Happy path described
- [ ] Error paths described
- [ ] Permissions considered
- [ ] Acceptance criteria written
- [ ] Tests defined
- [ ] Out of scope stated explicitly

### Backend
- [ ] API endpoints defined
- [ ] Validation described
- [ ] Error responses defined
- [ ] Side effects listed

### Frontend
- [ ] Loading state defined
- [ ] Empty state defined
- [ ] Error state defined
- [ ] Navigation after each action defined
- [ ] Feedback (toast/inline/modal) defined

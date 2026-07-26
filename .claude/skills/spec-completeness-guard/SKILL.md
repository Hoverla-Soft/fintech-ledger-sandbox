---
name: spec-completeness-guard
description: Checks a feature spec or task file against docs/product/FEATURE-CHECKLIST.md and flags what's missing. Use after creating or editing a docs/tasks/*.md, docs/product/requirements/*.md, or docs/product/user-flows/*.md file, or when asked whether a spec is ready to build from.
---

# Spec Completeness Guard

A list of docs never guarantees nothing was forgotten — this skill is the check that actually enforces the bar in `docs/product/FEATURE-CHECKLIST.md` against a specific spec, every time one is written. It doesn't invent criteria; it enforces that exact checklist. If the checklist itself needs to change, that's a `docs/product/FEATURE-CHECKLIST.md` edit, not a change to this skill.

## What to check

1. Read `docs/product/FEATURE-CHECKLIST.md` for the current bar.
2. Read the spec/task file being reviewed.
3. For every checklist item:
   - Checked and clearly addressed in the spec → fine.
   - Checked but the spec text doesn't actually support it (a box ticked with nothing behind it) → flag as a false checkmark, which is worse than an honest gap.
   - Unchecked with an explicit "N/A: <reason>" → fine, that's the accepted way to skip an inapplicable item (see FEATURE-CHECKLIST.md's "Not applicable" note).
   - Unchecked with no explanation → flag as missing.
4. Only apply the **Backend** section to specs that actually have a backend surface, and **Frontend** to specs with a user-facing surface — but the spec has to say which apply, per step 3's N/A rule, rather than this skill guessing silently.

## Additional checks beyond the checklist

- **Vagueness**: acceptance criteria or error-path descriptions that are too vague to test ("works correctly," "handles errors properly") — flag these even if the checkbox is ticked, since a ticked-but-vague item doesn't actually meet the bar.
- **Internal consistency**: does the "Out of scope" section contradict something described in the happy path? Does a described error path have no corresponding item in Acceptance criteria?
- **Cross-references**: if the spec touches permissions, does `docs/product/roles-and-permissions/` actually define the relevant role? If it touches a provider, does `docs/integrations/<provider>.md` exist and is it linked?

## Output format

1. Summary — is this spec ready to build from, or does it need another pass?
2. Missing items (checklist item, why it's missing, what's needed)
3. False checkmarks, if any (checked but not actually addressed)
4. Vagueness/consistency issues
5. What's already solid

Don't pad the report with items that are genuinely N/A and explicitly marked as such — only flag real gaps.

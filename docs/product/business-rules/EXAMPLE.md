# Business rule: {{rule name, e.g. "Margin precedence"}}

One file per distinct business rule that affects calculations, permissions, or behavior in a non-obvious way — the kind of thing a new engineer would get wrong by guessing.

## Rule

{{State the rule plainly, one or two sentences.}}

## Why

{{The business reason. Rules without a stated reason get "simplified" away by someone who doesn't know why they're there.}}

## Precedence / priority (if applicable)

{{e.g. "user-level setting > org-level > global default" — spell out the order if multiple sources of the same value can conflict.}}

## Where it's enforced in code

{{File/package reference, so this doc and the implementation don't drift apart silently.}}

## Confirmed with

{{Who signed off on this, or link to the decision. If nobody has, put it in docs/open-questions.md instead of guessing.}}

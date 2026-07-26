---
description: Decompose one or more source documents into an evidence-backed feature inventory and separate spec/task drafts, without implementing code
argument-hint: <files, external links/IDs, attached docs, or product description>
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, Task, ToolSearch
---

Use this before `/feature-loop` when the input may contain multiple features, integrations, infrastructure changes, or technical enablers. This command plans and documents work; it never implements application or infrastructure code.

## 1. Establish sources

- Read every local file explicitly named in `$ARGUMENTS` and any content attached to the conversation.
- Read `docs/development/work-systems.md`. Resolve external task/doc/design IDs through the exact permitted MCP read tools recorded there, using `ToolSearch` when tools are deferred.
- Record a stable path, URL, or system/artifact ID for every source. Distinguish authoritative sources from supporting context.
- If a required source is missing, inaccessible, unauthenticated, or points to the wrong workspace, report that concrete state and request an export/link/content. Do not guess.
- Do not scan the whole repository when the supplied sources and user scope identify a narrower area.

## 2. Extract before grouping

Create an evidence map containing:

- actors and their goals;
- entry points and user journeys;
- capabilities and business rules;
- permissions and data ownership;
- integrations and provider constraints;
- design references and UI states;
- non-functional, infrastructure, migration, operational, and compliance requirements;
- explicit exclusions, deadlines, rollout constraints, and unresolved decisions.

Preserve source references for every material statement. Separate facts from inferred grouping. Never convert an ambiguity into a requirement silently.

## 3. Build the proposed feature inventory

Split the material into independently valuable, testable, and reviewable units. Keep these types distinct:

- **Product feature**: user-visible or business capability.
- **Integration**: provider/third-party boundary with its own contract and failure modes.
- **Technical enabler**: shared contract, migration, platform capability, or prerequisite with no standalone user flow.
- **Infrastructure/operations**: CI/CD, deployment, environment, observability, recovery, or provisioning work.
- **Documentation/research**: evidence-gathering or documentation-only work.

For each proposed item provide: stable ID/slug, title, type, outcome, actors, source references, short scope, explicit out of scope, dependencies, acceptance-criteria outline, risks/open questions, suggested owner/agent, and recommended delivery group (`MVP`, `later`, or `decision required`).

Apply these boundaries:

- avoid one oversized feature spanning unrelated outcomes;
- avoid splitting by frontend/backend/database layers when they jointly deliver one outcome;
- separate work that has independent value, approval, rollout, risk, provider contract, or infrastructure lifecycle;
- identify duplicates and contradictions instead of creating parallel features;
- show dependency reasons and detect cycles;
- do not promise dates or estimates unless the source or user provides them.

## 4. Present for approval — mandatory gate

Present the proposed inventory, dependency order, duplicates/conflicts, assumptions, and open questions before writing spec/task files. Ask the user to approve or revise the decomposition.

Do not dispatch implementation agents, create implementation files, install dependencies, change configuration, update external systems, or start `/feature-loop` before this approval.

## 5. Persist approved planning documents

After approval, check for an existing `.claude/.active-task-scope.json`. If another task is active, stop and ask for it to be completed/cleared rather than overwriting its scope. Otherwise write a temporary documentation-only scope:

```json
{
  "taskFile": "/plan-features $ARGUMENTS",
  "scope": [
    "docs/product/FEATURE-INVENTORY.md",
    "docs/product/requirements/**",
    "docs/product/user-flows/**",
    "docs/tasks/**",
    "docs/open-questions.md"
  ]
}
```

Then:

1. Update `docs/product/FEATURE-INVENTORY.md`, preserving existing IDs and shipped/in-progress statuses.
2. Dispatch `product-analyst` to create one requirement and, when applicable, one user-flow draft per approved product feature using the existing examples and completeness checklist.
3. Create a separate `docs/tasks/*.md` draft only for items the user wants ready for execution. Set its status to `Draft` or `Ready`. Include source links/IDs, narrow Scope, dependencies, acceptance criteria, and verification placeholders that must be resolved before `/work-task`.
4. Put unresolved product decisions in `docs/open-questions.md`; do not hide them inside implementation tasks.
5. For integration and infrastructure items, link the applicable `docs/integrations/`, `docs/development/infrastructure.md`, or `docs/operations/` source-of-truth documents rather than duplicating them.

Remove the temporary active scope when documentation is complete.

## 6. Handoff

Report:

- approved features by delivery group and dependency order;
- files created/updated;
- items blocked by decisions or missing evidence;
- duplicates or source contradictions;
- the exact next command for each ready item: `/feature-loop docs/tasks/<file>.md`.

Do not automatically run those commands. Each feature enters its own scoped feature loop only when the user chooses it.

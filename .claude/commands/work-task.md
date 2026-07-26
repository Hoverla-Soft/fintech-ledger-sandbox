---
description: Start work on a task file — sets the enforced scope, requires an approach note before coding
argument-hint: <path to docs/tasks/*.md>
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, ToolSearch
---

Read the task file at $ARGUMENTS.

Before activating Scope, read `docs/development/work-systems.md` and resolve every item in the task's **External sources** section through its exact allowed MCP read tool, using `ToolSearch` when tools are deferred. Confirm that each artifact belongs to the expected workspace/project. If a server/tool is absent, disconnected, unauthenticated, denied, or returns the wrong workspace, stop and report that concrete state rather than implementing from guessed or stale content. Reading external sources does not authorize comments, status changes, assignments, messages, or document/design edits.

1. Extract the **Scope (allowed paths)** list from the file. Write it to `.claude/.active-task-scope.json` as `{"taskFile": "$ARGUMENTS", "scope": [<the paths>]}`. From this point on, edits outside these paths are blocked by the `PreToolUse` scope-guard hook — this isn't optional bookkeeping, it's what makes the guard work.

2. Read every file listed under **Related docs**. If any of them contradict the task's **Goal** or **Acceptance criteria**, or if the actual code in Scope doesn't match what those docs describe, stop here and report the discrepancy with 2-3 concrete options for how to proceed — do not silently pick one and start coding.

3. If there's no discrepancy, write a short **Approach** note: what you're going to touch and in what order, and any tradeoff worth flagging before you start (e.g. "could do X in packages/core or packages/integrations — going with integrations because Y").

4. Implement within Scope. Guard skills (`backend-architecture-guard`, `frontend-component-structure-guard`, `frontend-fetch-guard`, `integration-spec-guard`) fire automatically via `PostToolUse` when you touch their area — you don't need to invoke them manually.

5. Before considering the task done, run every **Verification** command from the task file yourself: typecheck, lint, tests, and build unless the task explicitly marks one `N/A` with a reason.

6. If a verification command fails:
   - read the actual failure and identify the smallest affected layer/file set;
   - hand the fix to the responsible implementation agent (`database-agent` reviews DB design while `backend-agent` writes DB code; `backend-agent`, `frontend-agent`, or `integration-agent` owns the other implementation areas);
   - fix only that affected part and stay within Scope;
   - rerun the failed command first, then rerun the full Verification block;
   - repeat until all checks are green or report a concrete blocker that requires user input. Do not weaken, skip, or delete a check just to make the loop green.

7. Once implementation and tests stabilize, run `documentator-agent` for affected documentation included in Scope. Then run the relevant review agents and `code-reviewer`. A review finding that requires a code change re-enters the same focused fix → targeted check → documentation sync → full verification loop. Human review is the final gate before merge.

8. Set the task status to `Human Review` when checks and reviews are green. After the user confirms merge/done/cancelled/superseded, update the status and move completed, cancelled, or superseded task files to `docs/tasks/archive/YYYY/` unless the user explicitly keeps them active. Do not archive before affected durable docs are synchronized.

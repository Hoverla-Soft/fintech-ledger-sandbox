#!/usr/bin/env node
// PreToolUse hook: blocks Edit/Write/NotebookEdit outside the active task's declared Scope.
// See docs/tasks/TEMPLATE.md and .claude/commands/work-task.md — Scope is written to
// .claude/.active-task-scope.json by /work-task at the start of a task.
// Agent Teams may instead use .active-task-scope.<session_id>.json so parallel
// Claude sessions cannot overwrite or inherit one another's task scope.
// Fails open (exits 0) on anything unexpected — a broken hook should never be the reason
// a legitimate edit gets stuck; the Scope check is a guardrail, not the last line of defense.

const fs = require("fs");
const path = require("path");
const { matches } = require("./glob-match.js");

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function main() {
  const raw = readStdin();
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  const toolName = input.tool_name || "";
  if (!["Edit", "Write", "NotebookEdit"].includes(toolName)) {
    process.exit(0);
  }

  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const claudeDir = path.join(projectDir, ".claude");
  const sessionId = String(input.session_id || "")
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .slice(0, 128);
  const globalScopeFile = path.join(claudeDir, ".active-task-scope.json");
  const sessionScopeFile = sessionId
    ? path.join(claudeDir, `.active-task-scope.${sessionId}.json`)
    : "";

  let sessionScopeFiles = [];
  try {
    sessionScopeFiles = fs
      .readdirSync(claudeDir)
      .filter((name) => /^\.active-task-scope\..+\.json$/.test(name));
  } catch {
    sessionScopeFiles = [];
  }

  let scopeFile;
  if (sessionScopeFile && fs.existsSync(sessionScopeFile)) {
    scopeFile = sessionScopeFile;
  } else if (sessionScopeFiles.length > 0) {
    process.stderr.write(
      `Blocked: this Claude session (${sessionId || "unknown"}) has no registered team Scope.\n` +
        `Create .claude/.active-task-scope.<session_id>.json for every lead/teammate before parallel edits.\n` +
        `Do not fall back to another teammate's Scope.`
    );
    process.exit(2);
  } else {
    scopeFile = globalScopeFile;
  }

  if (!fs.existsSync(scopeFile)) {
    process.exit(0); // no active task — nothing to enforce
  }

  let scopeData;
  try {
    scopeData = JSON.parse(fs.readFileSync(scopeFile, "utf8"));
  } catch {
    process.exit(0); // malformed state file, fail open
  }

  const scope = Array.isArray(scopeData.scope) ? scopeData.scope : [];
  if (scope.length === 0) {
    process.exit(0); // no scope declared, nothing to enforce
  }

  const filePath = (input.tool_input && input.tool_input.file_path) || "";
  if (!filePath) {
    process.exit(0);
  }

  const relativePath = path.relative(projectDir, filePath);
  const allowed = scope.some((pattern) => matches(relativePath, pattern));

  if (!allowed) {
    process.stderr.write(
      `Blocked: "${relativePath}" is outside the active task's declared Scope (${scopeData.taskFile || "unknown task"}).\n` +
        `Allowed paths:\n${scope.map((s) => "  - " + s).join("\n")}\n\n` +
        `If this file genuinely needs to change, stop and update the Scope section in ${scopeData.taskFile || "the task file"} first, then continue — don't just retry the same edit.`
    );
    process.exit(2);
  }

  process.exit(0);
}

main();

#!/usr/bin/env node
// PostToolUse hook: after an Edit/Write, tells Claude which guard skill(s) to run based on
// the file's path, using .claude/guard-routes.json as the routing table (first match wins).
// This only reminds — it emits hookSpecificOutput.additionalContext on exit 0, it never blocks.
// Fails open (exits 0, silent) on anything unexpected.

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
  if (!["Edit", "Write"].includes(toolName)) {
    process.exit(0);
  }

  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const routesFile = path.join(projectDir, ".claude", "guard-routes.json");

  if (!fs.existsSync(routesFile)) {
    process.exit(0);
  }

  let routesData;
  try {
    routesData = JSON.parse(fs.readFileSync(routesFile, "utf8"));
  } catch {
    process.exit(0);
  }

  const routes = Array.isArray(routesData.routes) ? routesData.routes : [];
  const filePath = (input.tool_input && input.tool_input.file_path) || "";
  if (!filePath) {
    process.exit(0);
  }

  const relativePath = path.relative(projectDir, filePath);
  const route = routes.find((r) => matches(relativePath, r.pattern));

  if (!route || !Array.isArray(route.skills) || route.skills.length === 0) {
    process.exit(0);
  }

  const skillList = route.skills.join(", ");
  const message = `"${relativePath}" was just edited. Run the following guard skill(s) before considering this change done: ${skillList}.`;

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: message,
      },
    }),
  );
  process.exit(0);
}

main();

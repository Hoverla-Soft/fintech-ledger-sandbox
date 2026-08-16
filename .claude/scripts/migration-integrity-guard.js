#!/usr/bin/env node
// PostToolUse/CI guard for Drizzle migration journals. It validates repository
// history only; comparing it with an applied database journal remains a
// separate, environment-specific check.

const fs = require("node:fs");
const path = require("node:path");

const IGNORED_DIRECTORIES = new Set([".git", "node_modules", "dist", "build", ".next"]);

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function isMigrationRelated(filePath) {
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();
  const basename = path.basename(normalized);
  return (
    normalized.includes("/migration") ||
    normalized.includes("/migrations/") ||
    normalized.includes("/drizzle/") ||
    normalized.includes("/seeds/") ||
    basename === "_journal.json" ||
    /(^|[._-])seed([._-]|$)/.test(basename)
  );
}

function findJournals(directory, results = []) {
  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) findJournals(entryPath, results);
    if (entry.isFile() && entry.name === "_journal.json" && path.basename(directory) === "meta") {
      results.push(entryPath);
    }
  }
  return results;
}

function validateJournal(journalPath) {
  const issues = [];
  let journal;
  try {
    journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
  } catch (error) {
    return [`cannot parse journal: ${error.message}`];
  }

  if (!Array.isArray(journal.entries)) return ["journal.entries must be an array"];

  const migrationsDirectory = path.dirname(path.dirname(journalPath));
  const seenIndexes = new Set();
  const seenTags = new Set();
  const seenTimestamps = new Set();
  let previousIndex = -1;
  let previousTimestamp = -Infinity;

  for (const [position, entry] of journal.entries.entries()) {
    const label = `entries[${position}]`;
    if (!Number.isInteger(entry.idx) || entry.idx < 0) {
      issues.push(`${label}.idx must be a non-negative integer`);
    } else {
      if (seenIndexes.has(entry.idx)) issues.push(`${label}.idx duplicates ${entry.idx}`);
      if (entry.idx !== position)
        issues.push(`${label}.idx is ${entry.idx}; expected contiguous index ${position}`);
      if (entry.idx <= previousIndex) issues.push(`${label}.idx is not strictly increasing`);
      seenIndexes.add(entry.idx);
      previousIndex = entry.idx;
    }

    if (typeof entry.tag !== "string" || entry.tag.length === 0) {
      issues.push(`${label}.tag must be a non-empty string`);
    } else {
      if (seenTags.has(entry.tag)) issues.push(`${label}.tag duplicates "${entry.tag}"`);
      seenTags.add(entry.tag);
      const sqlPath = path.join(migrationsDirectory, `${entry.tag}.sql`);
      if (!fs.existsSync(sqlPath)) issues.push(`${label} references missing file ${entry.tag}.sql`);
    }

    if (!Number.isFinite(entry.when)) {
      issues.push(`${label}.when must be a numeric timestamp`);
    } else {
      if (seenTimestamps.has(entry.when))
        issues.push(`${label}.when duplicates timestamp ${entry.when}`);
      if (entry.when <= previousTimestamp) {
        issues.push(
          `${label}.when (${entry.when}) must be greater than the previous timestamp (${previousTimestamp})`,
        );
      }
      seenTimestamps.add(entry.when);
      previousTimestamp = entry.when;
    }
  }

  let sqlFiles = [];
  try {
    sqlFiles = fs.readdirSync(migrationsDirectory).filter((name) => name.endsWith(".sql"));
  } catch {
    // The missing directory will already surface as missing referenced files.
  }
  for (const sqlFile of sqlFiles) {
    const tag = sqlFile.slice(0, -4);
    if (!seenTags.has(tag)) issues.push(`${sqlFile} exists but is absent from the journal`);
  }

  return issues;
}

function checkProject(projectDirectory) {
  const failures = [];
  for (const journalPath of findJournals(projectDirectory)) {
    const issues = validateJournal(journalPath);
    if (issues.length > 0) failures.push({ journalPath, issues });
  }
  return failures;
}

function formatFailures(projectDirectory, failures) {
  const lines = ["Blocked: migration integrity check failed."];
  for (const failure of failures) {
    lines.push(`\n${path.relative(projectDirectory, failure.journalPath)}:`);
    lines.push(...failure.issues.map((issue) => `  - ${issue}`));
  }
  lines.push(
    "\nDo not rewrite applied history. Restore missing files or add a new corrective migration.",
  );
  return lines.join("\n");
}

function main() {
  const projectDirectory = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const isStandaloneCheck = process.argv.includes("--check");

  if (!isStandaloneCheck) {
    let input;
    try {
      input = JSON.parse(readStdin());
    } catch {
      process.exit(0);
    }
    if (!["Edit", "Write"].includes(input.tool_name || "")) process.exit(0);
    const filePath = input.tool_input?.file_path || "";
    if (!filePath || !isMigrationRelated(filePath)) process.exit(0);
  }

  const failures = checkProject(projectDirectory);
  if (failures.length === 0) process.exit(0);
  process.stderr.write(formatFailures(projectDirectory, failures));
  process.exit(2);
}

if (require.main === module) main();

module.exports = { checkProject, findJournals, isMigrationRelated, validateJournal };

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { checkProject, isMigrationRelated } = require("./migration-integrity-guard.js");

function fixture(entries, sqlTags) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "migration-guard-"));
  const migrations = path.join(root, "packages", "db", "drizzle");
  const meta = path.join(migrations, "meta");
  fs.mkdirSync(meta, { recursive: true });
  fs.writeFileSync(path.join(meta, "_journal.json"), JSON.stringify({ entries }));
  for (const tag of sqlTags) fs.writeFileSync(path.join(migrations, `${tag}.sql`), "select 1;\n");
  return root;
}

test("accepts a contiguous journal with matching SQL files", (t) => {
  const root = fixture(
    [
      { idx: 0, tag: "0000_first", when: 1000 },
      { idx: 1, tag: "0001_second", when: 2000 },
    ],
    ["0000_first", "0001_second"],
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(checkProject(root), []);
});

test("rejects missing migration files and orphan SQL", (t) => {
  const root = fixture([{ idx: 0, tag: "0000_missing", when: 1000 }], ["0001_orphan"]);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const issues = checkProject(root)[0].issues.join("\n");
  assert.match(issues, /references missing file 0000_missing\.sql/);
  assert.match(issues, /0001_orphan\.sql exists but is absent from the journal/);
});

test("rejects gaps and timestamps that go backwards", (t) => {
  const root = fixture(
    [
      { idx: 0, tag: "0000_first", when: 2000 },
      { idx: 2, tag: "0002_third", when: 1000 },
    ],
    ["0000_first", "0002_third"],
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const issues = checkProject(root)[0].issues.join("\n");
  assert.match(issues, /expected contiguous index 1/);
  assert.match(issues, /must be greater than the previous timestamp/);
});

test("only runs as a hook for migration and seed edits", () => {
  assert.equal(isMigrationRelated("packages/db/drizzle/meta/_journal.json"), true);
  assert.equal(isMigrationRelated("packages/db/seeds/forward-air.seed.ts"), true);
  assert.equal(isMigrationRelated("packages/db/seeds/forward-air.ts"), true);
  assert.equal(isMigrationRelated("apps/web/page.tsx"), false);
});

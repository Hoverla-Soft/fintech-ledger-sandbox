/**
 * Showcase benchmark harness — see docs/showcase/benchmarks.md for published
 * results and docs/tasks/2026-08-15-showcase-benchmarks.md for scope.
 *
 * Self-contained: signs up its own throwaway user + org against a locally
 * running server, seeds the sandbox, then measures
 *   1. fresh write latency + idempotent-replay latency (sequential, within
 *      the ADR 0007 rate budget — writes are deliberately capped, so the
 *      honest write number is latency, not throughput),
 *   2. the 429 contract when the budget is exceeded (a feature, demonstrated),
 *   3. read throughput under concurrent load (autocannon).
 *
 * Usage:  node scripts/bench/run.mjs            (server on 127.0.0.1:3010)
 *         BENCH_URL=http://127.0.0.1:3000 node scripts/bench/run.mjs
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import os from "node:os";
import autocannon from "autocannon";

// biome-ignore lint/suspicious/noUndeclaredEnvVars: standalone script, never run through a turbo task — turbo.json's env graph doesn't apply to it
const BASE = process.env.BENCH_URL ?? "http://127.0.0.1:3010";
// Better-Auth rejects auth POSTs without a trusted Origin; must match the
// server's CORS_ORIGIN (see the run command in docs/showcase/benchmarks.md).
// biome-ignore lint/suspicious/noUndeclaredEnvVars: standalone script, never run through a turbo task — turbo.json's env graph doesn't apply to it
const ORIGIN = process.env.BENCH_ORIGIN ?? "http://127.0.0.1:3011";
const API = `${BASE}/api-reference`;
const RUN_ID = Date.now().toString(36);

// ---------- tiny HTTP client with a cookie jar ----------

const jar = new Map();

function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function call(url, body, { auth = true, method = "POST" } = {}) {
  const headers = { "content-type": "application/json", origin: ORIGIN };
  if (auth && jar.size > 0) headers.cookie = cookieHeader();
  const started = process.hrtime.bigint();
  const res = await fetch(url, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  for (const raw of res.headers.getSetCookie()) {
    const [pair] = raw.split(";");
    const eq = pair.indexOf("=");
    jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
  const text = await res.text();
  let json = null;
  try {
    json = text === "" ? null : JSON.parse(text);
  } catch {
    /* non-JSON body (e.g. "OK") */
  }
  return { status: res.status, json, text, ms };
}

async function must(step, url, body, opts) {
  const res = await call(url, body, opts);
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`${step} failed: HTTP ${res.status} ${res.text.slice(0, 300)}`);
  }
  return res;
}

// ---------- stats ----------

function percentile(sorted, p) {
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const round = (n) => Math.round(n * 100) / 100;
  return {
    n: sorted.length,
    p50: round(percentile(sorted, 50)),
    p95: round(percentile(sorted, 95)),
    max: round(sorted[sorted.length - 1]),
  };
}

// ---------- setup: user, org, seed ----------

console.error(`# bench ${RUN_ID} against ${BASE}`);

await must("health probe", `${BASE}/`, undefined, { method: "GET", auth: false });

await must("sign-up", `${BASE}/api/auth/sign-up/email`, {
  name: "Bench Runner",
  email: `bench-${RUN_ID}@example.com`,
  password: `bench-${RUN_ID}-Aa1!xxxx`,
});

const org = await must("org create", `${BASE}/api/auth/organization/create`, {
  name: `Bench ${RUN_ID}`,
  slug: `bench-${RUN_ID}`,
});
const orgId = org.json?.id ?? org.json?.organization?.id;
assert.ok(orgId, "organization id missing from create response");

await must("org set-active", `${BASE}/api/auth/organization/set-active`, {
  organizationId: orgId,
});

// Resolve procedure paths from the served OpenAPI spec rather than hardcoding
// oRPC's default path convention.
const spec = await must("openapi spec", `${API}/spec.json`, undefined, {
  method: "GET",
  auth: false,
});
const specPaths = Object.keys(spec.json?.paths ?? {});
function resolvePath(procedure) {
  const want = procedure.replace(/[^a-z0-9]/gi, "").toLowerCase();
  const hit = specPaths.find((p) => p.replace(/[^a-z0-9]/gi, "").toLowerCase() === want);
  if (!hit) throw new Error(`no OpenAPI path for ${procedure}; have: ${specPaths.join(", ")}`);
  return `${API}${hit}`;
}

const seedUrl = resolvePath("sandbox/seed");
const accountsListUrl = resolvePath("accounts/list");
const transactionsListUrl = resolvePath("transactions/list");
const dashboardUrl = resolvePath("dashboard/summary");
const createUrl = resolvePath("transactions/create");

await must("seed", seedUrl, { idempotencyKey: `bench-seed-${RUN_ID}` });

const accounts = await must("accounts.list", accountsListUrl, { limit: 50 });
const byName = (name) => accounts.json.accounts.find((a) => a.name === name);
const source = byName("Operating");
const dest = byName("Employee B");
assert.ok(source && dest, "seeded accounts not found");

// ---------- writes: fresh vs replay, inside the rate budget ----------
// Budget (ADR 0007): 30 writes/min/user, 60/min/org. One round spends
// 14 fresh + 14 replays; with the seed call that is 29 of 30 in minute one.

function transferBody(key) {
  return {
    idempotencyKey: key,
    postings: [
      { accountId: source.id, direction: "credit", amount: "1.00", currency: source.currency },
      { accountId: dest.id, direction: "debit", amount: "1.00", currency: dest.currency },
    ],
  };
}

const fresh = [];
const replays = [];

async function writeRound(round) {
  const replayKey = `bench-w-${RUN_ID}-r${round}-0`;
  for (let i = 0; i < 14; i++) {
    const res = await must("transfer", createUrl, transferBody(`bench-w-${RUN_ID}-r${round}-${i}`));
    assert.equal(res.json.replayed, false, "fresh post must not be a replay");
    fresh.push(res.ms);
  }
  for (let i = 0; i < 14; i++) {
    const res = await must("replay", createUrl, transferBody(replayKey));
    assert.equal(res.json.replayed, true, "same key + same payload must replay");
    replays.push(res.ms);
  }
}

console.error("write round 1/2 …");
await writeRound(1);

// ---------- 429 demonstration (budget now nearly exhausted on purpose) ----------

let rateLimited = null;
for (let i = 0; i < 5 && rateLimited === null; i++) {
  const res = await call(createUrl, transferBody(`bench-429-${RUN_ID}-${i}`));
  if (res.status === 429) {
    rateLimited = res.json;
  } else {
    assert.equal(res.json.replayed, false);
    fresh.push(res.ms);
  }
}
assert.ok(rateLimited, "expected a 429 once the per-user budget was exceeded");
assert.equal(rateLimited.data?.reason, "rate_limited", "429 must carry data.reason");
assert.ok(rateLimited.data.retryAfterSeconds >= 1, "429 must carry retryAfterSeconds");

// ---------- reads under load (autocannon) ----------
// The ~80s of load below also lets the write window slide fully before round 2.

const readTargets = [
  { name: "health baseline (no session, no DB)", url: `${BASE}/`, method: "GET", auth: false },
  { name: "accounts.list (limit 50)", url: accountsListUrl, body: { limit: 50 } },
  { name: "transactions.list (limit 20)", url: transactionsListUrl, body: { limit: 20 } },
  { name: "dashboard.summary", url: dashboardUrl, body: {} },
];

const readResults = [];
for (const target of readTargets) {
  const method = target.method ?? "POST";
  const headers = { "content-type": "application/json" };
  if (target.auth !== false) headers.cookie = cookieHeader();

  // Probe once so a broken target fails loudly instead of benchmarking errors.
  const probe = await call(target.url, target.body, { method, auth: target.auth !== false });
  if (probe.status < 200 || probe.status >= 300) {
    throw new Error(
      `probe for "${target.name}" got HTTP ${probe.status}: ${probe.text.slice(0, 200)}`,
    );
  }
  for (let i = 0; i < 20; i++)
    await call(target.url, target.body, { method, auth: target.auth !== false });

  for (const connections of [10, 50]) {
    console.error(`load: ${target.name} @ c=${connections} …`);
    const r = await autocannon({
      url: target.url,
      method,
      headers,
      ...(target.body === undefined ? {} : { body: JSON.stringify(target.body) }),
      connections,
      duration: 10,
      pipelining: 1,
    });
    assert.equal(r.non2xx, 0, `${target.name} returned non-2xx responses under load`);
    readResults.push({
      name: target.name,
      connections,
      rps: Math.round(r.requests.average),
      latencyMs: { p50: r.latency.p50, p97_5: r.latency.p97_5, p99: r.latency.p99 },
    });
  }
}

console.error("write round 2/2 …");
await writeRound(2);

// ---------- report ----------

const report = {
  runId: RUN_ID,
  commit: execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim(),
  date: new Date().toISOString(),
  environment: {
    node: process.version,
    cpu: os.cpus()[0].model,
    cores: os.cpus().length,
    memoryGb: Math.round(os.totalmem() / 1024 ** 3),
    platform: `${os.type()} ${os.release()}`,
    database: "postgres:18 (Docker, packages/db/docker-compose.yml)",
  },
  reads: readResults,
  writes: {
    note: "sequential single-client latency; throughput is deliberately capped by ADR 0007",
    freshPostMs: summarize(fresh),
    idempotentReplayMs: summarize(replays),
  },
  rateLimit429: rateLimited,
};

console.log(JSON.stringify(report, null, 2));

console.error("\n| Endpoint | Conn | Req/s | p50 | p97.5 | p99 |");
console.error("|---|---|---|---|---|---|");
for (const r of readResults) {
  console.error(
    `| ${r.name} | ${r.connections} | ${r.rps} | ${r.latencyMs.p50} ms | ${r.latencyMs.p97_5} ms | ${r.latencyMs.p99} ms |`,
  );
}
const w = report.writes;
console.error(
  `\nfresh post:        p50 ${w.freshPostMs.p50} ms · p95 ${w.freshPostMs.p95} ms (n=${w.freshPostMs.n})`,
);
console.error(
  `idempotent replay: p50 ${w.idempotentReplayMs.p50} ms · p95 ${w.idempotentReplayMs.p95} ms (n=${w.idempotentReplayMs.n})`,
);
console.error(
  `429 contract: reason=${rateLimited.data.reason} retryAfterSeconds=${rateLimited.data.retryAfterSeconds}`,
);

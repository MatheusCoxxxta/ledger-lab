// ==== EDIT HERE ====
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

const DB = {
  host:     process.env.DATABASE_HOST     || "localhost",
  port:     Number(process.env.DATABASE_PORT)    || 5432,
  user:     process.env.DATABASE_USER     || "postgres",
  password: process.env.DATABASE_PASSWORD || "",
  database: process.env.DATABASE_NAME     || "ledger",
};

const USERS            = 10;    // virtual users running in parallel
const DURATION_SECONDS = 30;    // primary stop condition: how long the load runs
const ITERATIONS       = 0;     // secondary cap per user (0 = time-only)
const RAMP_MS          = 150;   // ms between each user start

const WEIGHTS = {
  health:     25,   // GET /health            — hot probe
  createAcct: 20,   // POST /accounts         — account creation
  send:       45,   // POST /send             — transfer (hot write)
  deactivate: 10,   // PATCH /accounts/:id/deactivate — the changed endpoint
};

const SEED_LIMIT    = 30;    // max real rows pulled from local DB
const LOG_EACH_REQUEST = true; // set false for heartbeat-only on heavy runs
// ==== END EDIT ====

const { URL }  = require("url");
const { Pool } = require("pg");
const crypto   = require("crypto");

// ---- local-only guard ----
function assertLocal(label, urlStr) {
  const host = new URL(urlStr).hostname;
  if (!["localhost", "127.0.0.1"].includes(host) && !host.endsWith(".local")) {
    console.error(`[ABORT] ${label} must point to localhost. Got: ${urlStr}`);
    process.exit(1);
  }
}

assertLocal("BASE_URL", BASE_URL);
if (!["localhost", "127.0.0.1"].includes(DB.host) && !DB.host.endsWith(".local")) {
  console.error(`[ABORT] DB.host must be localhost. Got: ${DB.host}`);
  process.exit(1);
}

const HEADERS = { "Content-Type": "application/json" };

// ---- helpers ----
function uuid() { return crypto.randomUUID(); }

function weightedPick(weights) {
  const keys  = Object.keys(weights);
  const total = keys.reduce((s, k) => s + weights[k], 0);
  let r = Math.random() * total;
  for (const k of keys) {
    r -= weights[k];
    if (r <= 0) return k;
  }
  return keys[keys.length - 1];
}

function pct(n, d)  { return d ? ((n / d) * 100).toFixed(1) : "0.0"; }
function p(arr, q)  { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length * q)] || 0; }
function ts(start)  { return ((Date.now() - start) / 1000).toFixed(1) + "s"; }

// ---- seed (excluded from traffic metrics) ----
async function seed() {
  const pool = new Pool(DB);
  let active   = [];
  let inactive = [];
  try {
    const res1 = await pool.query(
      `SELECT id, balance FROM accounts WHERE deactivated_at IS NULL AND balance > 0 LIMIT $1`,
      [SEED_LIMIT]
    );
    active = res1.rows;

    const res2 = await pool.query(
      `SELECT id FROM accounts WHERE deactivated_at IS NOT NULL LIMIT $1`,
      [SEED_LIMIT]
    );
    inactive = res2.rows;

    console.log(`[SEED] Active accounts with balance: ${active.length}, already-deactivated: ${inactive.length}`);
    if (active.length < 2) {
      console.warn("[SEED] Fewer than 2 active accounts — send/deactivate requests will use created accounts.");
    }
  } catch (err) {
    console.warn(`[SEED] DB query failed: ${err.message}. Using placeholders — some requests may 400.`);
  } finally {
    await pool.end();
  }
  return { active, inactive };
}

// ---- request executors ----
async function doHealth() {
  const t0  = Date.now();
  const res = await fetch(`${BASE_URL}/health`);
  return { ok: res.ok, status: res.status, ms: Date.now() - t0, endpoint: "GET /health" };
}

const NAMES = ["Alice","Bob","Carol","Dave","Eve","Frank","Grace","Hiro","Ivy","Jack","Kai","Lee"];

async function doCreateAccount(state) {
  const name = NAMES[Math.floor(Math.random() * NAMES.length)] + "_" + uuid().slice(0, 6);
  const t0   = Date.now();
  const res  = await fetch(`${BASE_URL}/accounts`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ name, currency: "BRL", balance: 50 + Math.floor(Math.random() * 200) }),
  });
  const ms  = Date.now() - t0;
  const ok  = res.status === 201;
  if (ok) {
    const body = await res.json();
    state.createdActive.push({ id: body.id, balance: Number(body.balance) });
  } else {
    await res.text();
  }
  return { ok, status: res.status, ms, endpoint: "POST /accounts" };
}

async function doSend(state) {
  const pool = [...state.createdActive, ...state.seededActive];
  if (pool.length < 2) {
    return { ok: false, status: 0, ms: 0, endpoint: "POST /send", skipped: true };
  }
  let idx1 = Math.floor(Math.random() * pool.length);
  let idx2 = Math.floor(Math.random() * (pool.length - 1));
  if (idx2 >= idx1) idx2++;
  const sender   = pool[idx1];
  const receiver = pool[idx2];
  const amount   = Math.min(1, Number(sender.balance));
  if (amount <= 0) return { ok: false, status: 0, ms: 0, endpoint: "POST /send", skipped: true };

  const t0  = Date.now();
  const res = await fetch(`${BASE_URL}/send`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({
      idempotency_key: uuid(),
      sender_id:   sender.id,
      receiver_id: receiver.id,
      amount,
    }),
  });
  await res.text();
  return { ok: res.ok, status: res.status, ms: Date.now() - t0, endpoint: "POST /send" };
}

async function doDeactivate(state) {
  // prefer already-deactivated ids to exercise 409, otherwise pick from active pool
  const useDeactivated = Math.random() < 0.25 && state.deactivatedIds.length > 0;

  if (useDeactivated) {
    const id  = state.deactivatedIds[Math.floor(Math.random() * state.deactivatedIds.length)];
    const t0  = Date.now();
    const res = await fetch(`${BASE_URL}/accounts/${id}/deactivate`, { method: "PATCH" });
    await res.text();
    // 409 is expected and counts as ok for traffic purposes
    const ok = res.status === 200 || res.status === 409;
    return { ok, status: res.status, ms: Date.now() - t0, endpoint: "PATCH /accounts/:id/deactivate" };
  }

  const active = [...state.createdActive, ...state.seededActive];
  if (active.length === 0) {
    return { ok: false, status: 0, ms: 0, endpoint: "PATCH /accounts/:id/deactivate", skipped: true };
  }
  // pick a random active account; remove from active pools so we don't double-deactivate
  const idx = Math.floor(Math.random() * active.length);
  const acct = active[idx];

  // remove from both pools to avoid re-use as sender/receiver or double-deactivate
  const ci = state.createdActive.indexOf(acct);
  if (ci !== -1) state.createdActive.splice(ci, 1);
  const si = state.seededActive.indexOf(acct);
  if (si !== -1) state.seededActive.splice(si, 1);

  const t0  = Date.now();
  const res = await fetch(`${BASE_URL}/accounts/${acct.id}/deactivate`, { method: "PATCH" });
  await res.text();
  const ok = res.status === 200 || res.status === 409;
  if (ok) state.deactivatedIds.push(acct.id);
  return { ok, status: res.status, ms: Date.now() - t0, endpoint: "PATCH /accounts/:id/deactivate" };
}

// ---- per-user runner ----
async function runUser(userId, seededActive, seededDeactivated, deadline, logLine) {
  const state = {
    seededActive:   [...seededActive],
    createdActive:  [],
    deactivatedIds: [...seededDeactivated.map(r => r.id)],
  };

  const results = [];
  let iter = 0;

  while (Date.now() < deadline && (ITERATIONS === 0 || iter < ITERATIONS)) {
    const pick = weightedPick(WEIGHTS);
    let result;
    try {
      if      (pick === "health")     result = await doHealth();
      else if (pick === "createAcct") result = await doCreateAccount(state);
      else if (pick === "send")       result = await doSend(state);
      else                            result = await doDeactivate(state);
    } catch (err) {
      result = { ok: false, status: 0, ms: 0, endpoint: pick, error: err.message };
    }
    results.push(result);
    logLine(userId, result);
    iter++;
  }

  return results;
}

// ---- report ----
function report(allResults, elapsed) {
  const valid      = allResults.filter(r => !r.skipped);
  const total      = valid.length;
  const passed     = valid.filter(r => r.ok).length;
  const failed     = valid.filter(r => !r.ok).length;
  const latencies  = valid.filter(r => r.ms > 0).map(r => r.ms);
  const throughput = total > 0 ? (total / elapsed).toFixed(2) : "0";

  const byEp = {};
  for (const r of valid) {
    if (!byEp[r.endpoint]) byEp[r.endpoint] = { count: 0, ok: 0, ms: [] };
    byEp[r.endpoint].count++;
    if (r.ok) byEp[r.endpoint].ok++;
    if (r.ms > 0) byEp[r.endpoint].ms.push(r.ms);
  }

  console.log("\n========== SMOKE RESULTS ==========");
  console.log(`Duration: ${elapsed.toFixed(1)}s  |  Total: ${total}  |  Pass: ${passed}  |  Fail: ${failed}`);
  console.log(`Latency:  p50=${p(latencies, 0.5)}ms  p95=${p(latencies, 0.95)}ms`);
  console.log(`Throughput: ${throughput} req/s`);
  console.log("\nPer-endpoint breakdown:");

  for (const [ep, d] of Object.entries(byEp)) {
    const lats = d.ms;
    console.log(
      `  ${ep.padEnd(38)} count=${String(d.count).padStart(4)} (${pct(d.count, total).padStart(5)}%)` +
      `  ok=${d.ok}  p50=${p(lats, 0.5)}ms  p95=${p(lats, 0.95)}ms`
    );
  }

  const errors = valid.filter(r => !r.ok).slice(0, 5);
  if (errors.length) {
    console.log("\nError samples (first 5):");
    for (const e of errors) {
      console.log(`  ${e.endpoint} → status=${e.status}${e.error ? " err=" + e.error : ""}`);
    }
  }

  console.log("====================================\n");
  return failed > 0 ? 1 : 0;
}

// ---- main ----
async function main() {
  console.log(`[SMOKE] ledger-lab account-deactivation  BASE=${BASE_URL}  USERS=${USERS}  DURATION=${DURATION_SECONDS}s`);

  // health-check
  try {
    const h = await doHealth();
    if (!h.ok) { console.error("[ABORT] Server health check failed."); process.exit(1); }
    console.log(`[SMOKE] Server healthy (${h.ms}ms). Seeding...`);
  } catch (err) {
    console.error(`[ABORT] Cannot reach ${BASE_URL}/health: ${err.message}`);
    process.exit(1);
  }

  const { active: seededActive, inactive: seededDeactivated } = await seed();

  const trafficStart = Date.now();
  const deadline     = trafficStart + DURATION_SECONDS * 1000;

  let totalReqs = 0;
  let totalPass = 0;
  let totalFail = 0;
  let lastHb    = trafficStart;

  function logLine(userId, result) {
    totalReqs++;
    if (result.skipped) return;
    if (result.ok) totalPass++; else totalFail++;

    if (LOG_EACH_REQUEST) {
      const flag = result.skipped ? "skip" : result.ok ? "ok" : "FAIL";
      console.log(
        `[t+${ts(trafficStart)}] u${String(userId).padStart(2)} ${result.endpoint.padEnd(38)} ${result.status} ${result.ms}ms ${flag}`
      );
    }

    const now = Date.now();
    if (now - lastHb >= 1000) {
      const elapsed = (now - trafficStart) / 1000;
      const remain  = Math.max(0, DURATION_SECONDS - elapsed).toFixed(0);
      const rps     = (totalReqs / elapsed).toFixed(1);
      console.log(`[HB] elapsed=${elapsed.toFixed(1)}s remaining=${remain}s  reqs=${totalReqs}  pass=${totalPass}  fail=${totalFail}  rps=${rps}`);
      lastHb = now;
    }
  }

  console.log(`[SMOKE] Starting ${USERS} virtual users (ramp ${RAMP_MS}ms)...`);

  const userPromises = [];
  for (let u = 0; u < USERS; u++) {
    if (RAMP_MS > 0 && u > 0) await new Promise(r => setTimeout(r, RAMP_MS));
    userPromises.push(runUser(u, seededActive, seededDeactivated, deadline, logLine));
  }

  const nested     = await Promise.all(userPromises);
  const allResults = nested.flat();
  const elapsed    = (Date.now() - trafficStart) / 1000;

  const exitCode = report(allResults, elapsed);
  process.exit(exitCode);
}

main().catch(err => {
  console.error("[FATAL]", err);
  process.exit(1);
});

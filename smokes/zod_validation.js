// ==== EDIT HERE ====
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

const DB = {
  host:     process.env.DATABASE_HOST     || "localhost",
  port:     Number(process.env.DATABASE_PORT)    || 5438,
  user:     process.env.DATABASE_USER     || "postgres",
  password: process.env.DATABASE_PASSWORD || "postgres",
  database: process.env.DATABASE_NAME     || "ledgerlab",
};

const USERS            = 10;    // virtual users running in parallel
const DURATION_SECONDS = 30;    // primary stop condition: how long the load runs
const ITERATIONS       = 0;     // secondary cap per user (0 = time-only)
const RAMP_MS          = 150;   // ms between each user start

const WEIGHTS = {
  health:              15,  // GET /health                              — hot read baseline
  createAcct_valid:    20,  // POST /accounts  valid payload            — nominal write
  createAcct_bad:      10,  // POST /accounts  invalid payload (Zod 400) — validation exercise
  send_valid:          20,  // POST /send      valid payload            — nominal write
  send_bad:            15,  // POST /send      invalid payload (Zod 400) — validation exercise
  deactivate_valid:    12,  // PATCH /accounts/:id/deactivate valid UUID — low-freq action
  deactivate_bad_uuid:  8,  // PATCH /accounts/:id/deactivate bad UUID  — Zod 400 (was pg 22P02)
};

const SEED_LIMIT       = 30;    // max real rows pulled from local DB
const LOG_EACH_REQUEST = true;  // set false for heartbeat-only on heavy runs
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
function uuid()        { return crypto.randomUUID(); }
function now()         { return Date.now(); }
function ts(start)     { return ((now() - start) / 1000).toFixed(1) + "s"; }
function p(arr, q)     { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length * q)] || 0; }
function pct(n, d)     { return d ? ((n / d) * 100).toFixed(1) : "0.0"; }
function pick(arr)     { return arr[Math.floor(Math.random() * arr.length)]; }

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

// ---- seed (excluded from traffic metrics) ----
async function seed() {
  const pool = new Pool(DB);
  let active = [], deactivated = [];
  try {
    const r1 = await pool.query(
      `SELECT id, balance FROM accounts WHERE deactivated_at IS NULL AND balance > 0 LIMIT $1`,
      [SEED_LIMIT]
    );
    active = r1.rows;

    const r2 = await pool.query(
      `SELECT id FROM accounts WHERE deactivated_at IS NOT NULL LIMIT $1`,
      [SEED_LIMIT]
    );
    deactivated = r2.rows.map(r => r.id);

    console.log(`[SEED] Active (balance>0): ${active.length}  Already-deactivated: ${deactivated.length}`);
    if (active.length < 2) {
      console.warn("[SEED] Fewer than 2 active accounts — send happy-path will rely on accounts created during the run.");
    }
  } catch (err) {
    console.warn(`[SEED] DB unreachable: ${err.message}. Falling back to placeholders — some requests may 400.`);
  } finally {
    await pool.end();
  }
  return { active, deactivated };
}

// ---- invalid payloads for Zod validation exercise ----
const BAD_ACCOUNT_BODIES = [
  {},                                              // name missing
  { name: "   " },                                // whitespace-only name
  { name: "Test", currency: "us" },               // currency too short
  { name: "Test", currency: "usdd" },             // currency too long
  { name: "Test", currency: "12a" },              // currency with digit
  { name: "Test", currency: null },               // currency explicit null
  { name: "Test", balance: -1 },                 // negative balance
  { name: "Test", balance: null },               // balance null
];

const BAD_SEND_BODIES = [
  { receiver_id: uuid(), amount: 10, idempotency_key: uuid() },            // sender_id missing
  { sender_id: "not-uuid", receiver_id: uuid(), amount: 10, idempotency_key: uuid() },   // sender bad uuid
  { sender_id: uuid(), receiver_id: "not-uuid", amount: 10, idempotency_key: uuid() },   // receiver bad uuid
  { sender_id: uuid(), receiver_id: uuid(), idempotency_key: uuid() },     // amount missing
  { sender_id: uuid(), receiver_id: uuid(), amount: 0,  idempotency_key: uuid() },       // amount zero
  { sender_id: uuid(), receiver_id: uuid(), amount: -5, idempotency_key: uuid() },       // amount negative
  { sender_id: uuid(), receiver_id: uuid(), amount: "100", idempotency_key: uuid() },    // amount as string
  { sender_id: uuid(), receiver_id: uuid(), amount: 10, idempotency_key: "" },           // empty idempotency_key
];

const BAD_UUIDS = ["abc", "not-a-uuid", "123", "xyz-xyz", "00000000-0000-0000-0000"];

const NAMES = ["Alice","Bob","Carol","Dave","Eve","Frank","Grace","Hiro","Ivy","Jack","Kai","Lee","Mia","Noa"];

// ---- request executors ----
async function doHealth() {
  const t0  = now();
  const res = await fetch(`${BASE_URL}/health`);
  await res.text();
  return { ok: res.ok, status: res.status, ms: now() - t0, endpoint: "GET /health" };
}

async function doCreateAcctValid(state) {
  const name    = NAMES[Math.floor(Math.random() * NAMES.length)] + "_" + uuid().slice(0, 6);
  const balance = 100 + Math.floor(Math.random() * 900);
  const t0      = now();
  const res     = await fetch(`${BASE_URL}/accounts`, {
    method: "POST", headers: HEADERS,
    body: JSON.stringify({ name, currency: "BRL", balance }),
  });
  const ms = now() - t0;
  const ok = res.status === 201;
  if (ok) {
    const body = await res.json();
    state.active.push({ id: body.id, balance: Number(body.balance) });
  } else {
    await res.text();
  }
  return { ok, status: res.status, ms, endpoint: "POST /accounts (valid)" };
}

async function doCreateAcctBad() {
  const body = pick(BAD_ACCOUNT_BODIES);
  const t0   = now();
  const res  = await fetch(`${BASE_URL}/accounts`, {
    method: "POST", headers: HEADERS,
    body: JSON.stringify(body),
  });
  await res.text();
  const ok = res.status === 400;  // expect Zod 400
  return { ok, status: res.status, ms: now() - t0, endpoint: "POST /accounts (bad)" };
}

async function doSendValid(state) {
  if (state.active.length < 2) {
    return { ok: false, status: 0, ms: 0, endpoint: "POST /send (valid)", skipped: true };
  }
  let i1 = Math.floor(Math.random() * state.active.length);
  let i2 = Math.floor(Math.random() * (state.active.length - 1));
  if (i2 >= i1) i2++;
  const sender   = state.active[i1];
  const receiver = state.active[i2];
  const amount   = Math.min(1, Number(sender.balance));
  if (amount <= 0) return { ok: false, status: 0, ms: 0, endpoint: "POST /send (valid)", skipped: true };

  const t0  = now();
  const res = await fetch(`${BASE_URL}/send`, {
    method: "POST", headers: HEADERS,
    body: JSON.stringify({
      sender_id:       sender.id,
      receiver_id:     receiver.id,
      amount,
      idempotency_key: uuid(),
    }),
  });
  await res.text();
  return { ok: res.ok, status: res.status, ms: now() - t0, endpoint: "POST /send (valid)" };
}

async function doSendBad() {
  const body = pick(BAD_SEND_BODIES);
  const t0   = now();
  const res  = await fetch(`${BASE_URL}/send`, {
    method: "POST", headers: HEADERS,
    body: JSON.stringify(body),
  });
  await res.text();
  const ok = res.status === 400;  // expect Zod 400
  return { ok, status: res.status, ms: now() - t0, endpoint: "POST /send (bad)" };
}

async function doDeactivateValid(state) {
  // 25% chance: hit an already-deactivated account (exercises 409)
  if (Math.random() < 0.25 && state.deactivated.length > 0) {
    const id  = pick(state.deactivated);
    const t0  = now();
    const res = await fetch(`${BASE_URL}/accounts/${id}/deactivate`, { method: "PATCH" });
    await res.text();
    const ok = res.status === 200 || res.status === 409;
    return { ok, status: res.status, ms: now() - t0, endpoint: "PATCH /deactivate (valid)" };
  }

  if (state.active.length === 0) {
    return { ok: false, status: 0, ms: 0, endpoint: "PATCH /deactivate (valid)", skipped: true };
  }

  const idx  = Math.floor(Math.random() * state.active.length);
  const acct = state.active.splice(idx, 1)[0];
  const t0   = now();
  const res  = await fetch(`${BASE_URL}/accounts/${acct.id}/deactivate`, { method: "PATCH" });
  await res.text();
  const ok = res.status === 200 || res.status === 409;
  if (ok) state.deactivated.push(acct.id);
  return { ok, status: res.status, ms: now() - t0, endpoint: "PATCH /deactivate (valid)" };
}

async function doDeactivateBadUUID() {
  const badId = pick(BAD_UUIDS);
  const t0    = now();
  const res   = await fetch(`${BASE_URL}/accounts/${badId}/deactivate`, { method: "PATCH" });
  await res.text();
  const ok = res.status === 400;  // expect Zod 400 (was pg 22P02 before)
  return { ok, status: res.status, ms: now() - t0, endpoint: "PATCH /deactivate (bad UUID)" };
}

// ---- per-user runner ----
async function runUser(userId, seededActive, seededDeactivated, deadline, logLine) {
  const state = {
    active:      [...seededActive],
    deactivated: [...seededDeactivated],
  };

  const results = [];
  let iter = 0;

  while (now() < deadline && (ITERATIONS === 0 || iter < ITERATIONS)) {
    const picked = weightedPick(WEIGHTS);
    let result;
    try {
      if      (picked === "health")              result = await doHealth();
      else if (picked === "createAcct_valid")    result = await doCreateAcctValid(state);
      else if (picked === "createAcct_bad")      result = await doCreateAcctBad();
      else if (picked === "send_valid")          result = await doSendValid(state);
      else if (picked === "send_bad")            result = await doSendBad();
      else if (picked === "deactivate_valid")    result = await doDeactivateValid(state);
      else                                       result = await doDeactivateBadUUID();
    } catch (err) {
      result = { ok: false, status: 0, ms: 0, endpoint: picked, error: err.message };
    }
    results.push(result);
    logLine(userId, result);
    iter++;
  }

  return results;
}

// ---- report ----
function report(allResults, elapsed) {
  const valid     = allResults.filter(r => !r.skipped);
  const total     = valid.length;
  const passed    = valid.filter(r => r.ok).length;
  const failed    = valid.filter(r => !r.ok).length;
  const latencies = valid.filter(r => r.ms > 0).map(r => r.ms);
  const rps       = total > 0 ? (total / elapsed).toFixed(2) : "0";

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
  console.log(`Throughput: ${rps} req/s`);
  console.log("\nPer-endpoint breakdown:");

  for (const [ep, d] of Object.entries(byEp)) {
    console.log(
      `  ${ep.padEnd(38)} count=${String(d.count).padStart(4)} (${pct(d.count, total).padStart(5)}%)` +
      `  ok=${d.ok}  p50=${p(d.ms, 0.5)}ms  p95=${p(d.ms, 0.95)}ms`
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
  console.log(`[SMOKE] ledger-lab zod-validation  BASE=${BASE_URL}  USERS=${USERS}  DURATION=${DURATION_SECONDS}s`);

  try {
    const h = await doHealth();
    if (!h.ok) { console.error("[ABORT] Server health check failed."); process.exit(1); }
    console.log(`[SMOKE] Server healthy (${h.ms}ms). Seeding...`);
  } catch (err) {
    console.error(`[ABORT] Cannot reach ${BASE_URL}/health: ${err.message}`);
    process.exit(1);
  }

  const { active: seededActive, deactivated: seededDeactivated } = await seed();

  const trafficStart = now();
  const deadline     = trafficStart + DURATION_SECONDS * 1000;

  let totalReqs = 0, totalPass = 0, totalFail = 0, lastHb = trafficStart;

  function logLine(userId, result) {
    totalReqs++;
    if (result.skipped) return;
    if (result.ok) totalPass++; else totalFail++;

    if (LOG_EACH_REQUEST) {
      const flag = result.ok ? "ok" : "FAIL";
      console.log(
        `[t+${ts(trafficStart)}] u${String(userId).padStart(2)} ${result.endpoint.padEnd(38)} ${result.status} ${result.ms}ms ${flag}`
      );
    }

    const t = now();
    if (t - lastHb >= 1000) {
      const elapsed = (t - trafficStart) / 1000;
      const remain  = Math.max(0, DURATION_SECONDS - elapsed).toFixed(0);
      const rps     = (totalReqs / elapsed).toFixed(1);
      console.log(`[HB] elapsed=${elapsed.toFixed(1)}s remaining=${remain}s  reqs=${totalReqs}  pass=${totalPass}  fail=${totalFail}  rps=${rps}`);
      lastHb = t;
    }
  }

  console.log(`[SMOKE] Starting ${USERS} virtual users (ramp ${RAMP_MS}ms each)...`);

  const userPromises = [];
  for (let u = 0; u < USERS; u++) {
    if (RAMP_MS > 0 && u > 0) await new Promise(r => setTimeout(r, RAMP_MS));
    userPromises.push(runUser(u, seededActive, seededDeactivated, deadline, logLine));
  }

  const nested     = await Promise.all(userPromises);
  const allResults = nested.flat();
  const elapsed    = (now() - trafficStart) / 1000;

  const exitCode = report(allResults, elapsed);
  process.exit(exitCode);
}

main().catch(err => {
  console.error("[FATAL]", err);
  process.exit(1);
});

// ==== EDIT HERE ====
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

const DB = {
  host:     process.env.DATABASE_HOST     || "localhost",
  port:     Number(process.env.DATABASE_PORT)    || 5432,
  user:     process.env.DATABASE_USER     || "postgres",
  password: process.env.DATABASE_PASSWORD || "",
  database: process.env.DATABASE_NAME     || "ledger",
};

const USERS      = 10;   // virtual users running in parallel
const ITERATIONS = 20;   // requests per user (after prelude)
const RAMP_MS    = 200;  // ms between each user start

const WEIGHTS = {
  health:          30,   // GET /health — health probe (hot)
  createAccount:   40,   // POST /accounts — the changed endpoint
  send:            30,   // POST /send — transfer (requires seeded accounts)
};

const SEED_LIMIT = 20;   // max real accounts pulled from the local DB for send requests
// ==== END EDIT ====

// ---- local-only guard ----
const { URL } = require("url");

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

// ---- fail-fast on missing config ----
const missing = [];
if (!DB.password) missing.push("DATABASE_PASSWORD (or DB.password in top block)");
if (missing.length) {
  console.error("[ABORT] Missing required config:\n " + missing.join("\n "));
  console.error("Set env vars or edit the top block of this file.");
  process.exit(1);
}

// ---- helpers ----
const { Pool } = require("pg");
const crypto = require("crypto");

const HEADERS = { "Content-Type": "application/json" };

function randomUUID() {
  return crypto.randomUUID();
}

function weightedPick(weights) {
  const keys = Object.keys(weights);
  const total = keys.reduce((s, k) => s + weights[k], 0);
  let r = Math.random() * total;
  for (const k of keys) {
    r -= weights[k];
    if (r <= 0) return k;
  }
  return keys[keys.length - 1];
}

function now() { return Date.now(); }

// ---- seed ----
async function seed() {
  const pool = new Pool(DB);
  let accounts = [];
  try {
    const res = await pool.query(
      `SELECT id, balance FROM accounts WHERE balance > 0 LIMIT $1`,
      [SEED_LIMIT]
    );
    accounts = res.rows;
    if (accounts.length < 2) {
      console.warn(`[SEED] Found ${accounts.length} account(s) with balance > 0 — send requests will be skipped or use placeholders.`);
    } else {
      console.log(`[SEED] Loaded ${accounts.length} accounts from local DB.`);
    }
  } catch (err) {
    console.warn(`[SEED] DB unreachable or query failed: ${err.message}. Falling back to placeholders — send requests will return 400.`);
  } finally {
    await pool.end();
  }
  return accounts;
}

// ---- request executors ----
async function doHealth() {
  const t0 = now();
  const res = await fetch(`${BASE_URL}/health`);
  return { ok: res.ok, status: res.status, ms: now() - t0, endpoint: "GET /health" };
}

async function doCreateAccount() {
  const names = ["Alice", "Bob", "Carol", "Dave", "Eve", "Frank", "Grace", "Hiro", "Ivy", "Jack"];
  const name = names[Math.floor(Math.random() * names.length)] + "_" + randomUUID().slice(0, 6);
  const t0 = now();
  const res = await fetch(`${BASE_URL}/accounts`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ name, currency: "BRL", balance: Math.floor(Math.random() * 500) }),
  });
  const ms = now() - t0;
  return { ok: res.status === 201, status: res.status, ms, endpoint: "POST /accounts" };
}

async function doSend(accounts) {
  if (accounts.length < 2) {
    return { ok: false, status: 0, ms: 0, endpoint: "POST /send", skipped: true };
  }
  const idx1 = Math.floor(Math.random() * accounts.length);
  let idx2 = Math.floor(Math.random() * (accounts.length - 1));
  if (idx2 >= idx1) idx2++;
  const sender   = accounts[idx1];
  const receiver = accounts[idx2];
  const amount   = Math.min(1, Number(sender.balance));
  if (amount <= 0) {
    return { ok: false, status: 0, ms: 0, endpoint: "POST /send", skipped: true };
  }
  const t0 = now();
  const res = await fetch(`${BASE_URL}/send`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({
      idempotency_key: randomUUID(),
      sender_id:   sender.id,
      receiver_id: receiver.id,
      amount,
    }),
  });
  const ms = now() - t0;
  return { ok: res.ok, status: res.status, ms, endpoint: "POST /send" };
}

// ---- per-user runner ----
async function runUser(userId, accounts) {
  const results = [];

  for (let i = 0; i < ITERATIONS; i++) {
    const pick = weightedPick(WEIGHTS);
    let result;
    try {
      if (pick === "health")         result = await doHealth();
      else if (pick === "createAccount") result = await doCreateAccount();
      else                           result = await doSend(accounts);
    } catch (err) {
      result = { ok: false, status: 0, ms: 0, endpoint: pick, error: err.message };
    }
    results.push(result);
  }

  return results;
}

// ---- report ----
function report(allResults) {
  const total     = allResults.length;
  const passed    = allResults.filter(r => r.ok || r.skipped).length;
  const failed    = allResults.filter(r => !r.ok && !r.skipped).length;
  const latencies = allResults.filter(r => r.ms > 0).map(r => r.ms).sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)] || 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;

  const byEndpoint = {};
  for (const r of allResults) {
    if (!byEndpoint[r.endpoint]) byEndpoint[r.endpoint] = { count: 0, ok: 0, ms: [] };
    byEndpoint[r.endpoint].count++;
    if (r.ok) byEndpoint[r.endpoint].ok++;
    if (r.ms > 0) byEndpoint[r.endpoint].ms.push(r.ms);
  }

  console.log("\n========== SMOKE RESULTS ==========");
  console.log(`Total:    ${total}  |  Pass: ${passed}  |  Fail: ${failed}`);
  console.log(`Latency:  p50=${p50}ms  p95=${p95}ms`);
  console.log(`Throughput: see per-endpoint below`);
  console.log("\nPer-endpoint breakdown:");

  for (const [ep, d] of Object.entries(byEndpoint)) {
    const share = ((d.count / total) * 100).toFixed(1);
    const lats  = d.ms.sort((a, b) => a - b);
    const ep50  = lats[Math.floor(lats.length * 0.5)] || 0;
    const ep95  = lats[Math.floor(lats.length * 0.95)] || 0;
    console.log(`  ${ep.padEnd(20)} count=${d.count} (${share}%)  ok=${d.ok}  p50=${ep50}ms  p95=${ep95}ms`);
  }

  const errors = allResults.filter(r => !r.ok && !r.skipped).slice(0, 5);
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
  console.log(`[SMOKE] ledger-lab account-creation  BASE=${BASE_URL}  USERS=${USERS}  ITER=${ITERATIONS}`);

  // health-check before starting
  try {
    const h = await doHealth();
    if (!h.ok) { console.error("[ABORT] Server health check failed."); process.exit(1); }
    console.log(`[SMOKE] Server healthy (${h.ms}ms). Starting load...`);
  } catch (err) {
    console.error(`[ABORT] Cannot reach ${BASE_URL}/health: ${err.message}`);
    process.exit(1);
  }

  const accounts = await seed();

  const userPromises = [];
  for (let u = 0; u < USERS; u++) {
    await new Promise(r => setTimeout(r, RAMP_MS));
    userPromises.push(runUser(u, accounts));
  }

  const nested = await Promise.all(userPromises);
  const allResults = nested.flat();

  const exitCode = report(allResults);
  process.exit(exitCode);
}

main().catch(err => {
  console.error("[FATAL]", err);
  process.exit(1);
});

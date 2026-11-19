/**
 * Guardrails for Render free-tier cold starts (~40–50s measured).
 * Retries must outlast a single wake so Add transaction / Forecast succeed
 * without a hard refresh.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const appJs = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
const loginJs = fs.readFileSync(path.join(__dirname, "login.js"), "utf8");

function readConst(src, name) {
  const re = new RegExp(`(?:const|let)\\s+${name}\\s*=\\s*(\\d+)`);
  const m = src.match(re);
  assert.ok(m, `expected ${name} in source`);
  return Number(m[1]);
}

const maxRetryMs = readConst(appJs, "maxRetryMs");
const perAttemptTimeoutMs = readConst(appJs, "perAttemptTimeoutMs");
assert.ok(maxRetryMs >= 75000, `app maxRetryMs=${maxRetryMs} must cover ~40–50s cold starts`);
assert.ok(perAttemptTimeoutMs >= 25000, `app perAttemptTimeoutMs=${perAttemptTimeoutMs} too short for cold start`);
assert.ok(
  maxRetryMs >= 2 * perAttemptTimeoutMs,
  `app maxRetryMs=${maxRetryMs} should allow at least two full attempts`
);
assert.ok(appJs.includes("startApiKeepAlive"), "app starts in-session API keep-alive");
assert.ok(appJs.includes("Waking server"), "Add transaction shows wake hint while retrying");
assert.ok(
  !appJs.includes("Please refresh and try again."),
  "cold-start copy should not push hard refresh as the primary recovery"
);

assert.ok(loginJs.includes("maxMs: 90000"), "login retries long enough for cold start");
assert.ok(
  /requestWithRetry\("\/api\/health"/.test(loginJs),
  "login page wakes API with retries"
);

const keepaliveWorkflow = fs.readFileSync(
  path.join(__dirname, "..", ".github", "workflows", "api-keepalive.yml"),
  "utf8"
);
assert.ok(keepaliveWorkflow.includes("family-cash-flow-api.onrender.com/api/health"));
assert.ok(keepaliveWorkflow.includes("family-cash-flow-api-staging.onrender.com/api/health"));
assert.ok(keepaliveWorkflow.includes("*/10 * * * *"), "keep-alive cadence under Render idle window");

console.log("api-cold-start tests passed");

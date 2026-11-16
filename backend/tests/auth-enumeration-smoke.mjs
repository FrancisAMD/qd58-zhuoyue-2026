import assert from "node:assert/strict";
import worker from "../src/worker.js";

const ORIGIN = "https://58er.eon21.space";
const API = "https://api.58er.eon21.space";
const SECRET = "auth-enumeration-test-secret-0123456789abcdef";

function makeDb({ exists }) {
  const state = { exists, rateLimits: new Map(), challenges: [] };
  const db = {
    prepare(sql) {
      return {
        sql, args: [],
        bind(...args) { this.args = args; return this; },
        async first() {
          const [key] = this.args;
          if (sql.startsWith("SELECT window_started_at,hit_count FROM rate_limits")) {
            return state.rateLimits.get(key) || null;
          }
          if (sql.startsWith("SELECT window_started_at FROM rate_limits")) {
            const row = state.rateLimits.get(key);
            return row ? { window_started_at: row.window_started_at } : null;
          }
          if (sql.startsWith("SELECT id FROM users WHERE phone=? AND deleted_at=''")) {
            return state.exists ? { id: "existing-user" } : null;
          }
          return null;
        },
        async run() {
          const a = this.args;
          if (sql.startsWith("INSERT INTO rate_limits(")) {
            const [bucketKey, startedAt, resetBefore, , , limit] = a;
            const old = state.rateLimits.get(bucketKey);
            if (!old || old.window_started_at <= resetBefore) {
              state.rateLimits.set(bucketKey, { window_started_at: startedAt, hit_count: 1 });
              return { meta: { changes: 1 } };
            }
            if (old.hit_count < limit) {
              old.hit_count += 1;
              return { meta: { changes: 1 } };
            }
            return { meta: { changes: 0 } };
          }
          if (sql.startsWith("INSERT INTO otp_challenges")) {
            state.challenges.push({
              id: a[0], phone: a[1], codeHash: a[2], expiresAt: a[3],
              createdAt: a[4], purpose: a[5], outId: a[6]
            });
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 1 } };
        }
      };
    },
    async batch(statements) {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    }
  };
  return { db, state };
}

const originalFetch = globalThis.fetch;
const providerCalls = [];
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  if (url.hostname === "challenges.cloudflare.com") {
    const token = new URLSearchParams(init.body).get("response");
    return new Response(JSON.stringify({
      success: true,
      action: token,
      hostname: "58er.eon21.space"
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.hostname === "dypnsapi.aliyuncs.com") {
    const action = init.headers?.["x-acs-action"];
    providerCalls.push({ action, phone: url.searchParams.get("PhoneNumber") });
    return new Response(JSON.stringify({
      Success: true, Code: "OK", RequestId: "must-not-leak-to-client"
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  throw new Error("Unexpected outbound request: " + url.hostname);
};

function request(path, phone, action) {
  return new Request(API + path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      "CF-Connecting-IP": "203.0.113.88"
    },
    body: JSON.stringify({
      phone,
      turnstileToken: action,
      ...(action === "register" ? { accountConsent: true } : {})
    })
  });
}

function env(DB) {
  return {
    APP_ORIGIN: ORIGIN, DB,
    RATE_LIMIT_HMAC_SECRET: SECRET,
    TURNSTILE_SECRET_KEY: "turnstile-test-secret",
    ALIBABA_ACCESS_KEY_ID: "test-access-key-id",
    ALIBABA_ACCESS_KEY_SECRET: "test-access-key-secret",
    ALIBABA_SIGN_NAME: "test-sign",
    ALIBABA_TEMPLATE_CODE: "test-template",
    OTP_TTL_SECONDS: "300",
    OTP_SEND_COOLDOWN_SECONDS: "60"
  };
}

try {
  const scenarios = [
    { label: "registered phone registration attempt", path: "/api/auth/register/request-code", action: "register", exists: true },
    { label: "unregistered phone registration attempt", path: "/api/auth/register/request-code", action: "register", exists: false },
    { label: "registered phone password reset", path: "/api/auth/password/request-code", action: "password_reset", exists: true },
    { label: "unregistered phone password reset", path: "/api/auth/password/request-code", action: "password_reset", exists: false }
  ];

  const outcomes = [];
  for (const scenario of scenarios) {
    const { db, state } = makeDb({ exists: scenario.exists });
    const response = await worker.fetch(
      request(scenario.path, "13800138000", scenario.action),
      env(db)
    );
    const body = await response.json();
    outcomes.push({ scenario, status: response.status, body, state });
    assert.equal(response.status, 200, scenario.label + " must have the same public status");
    assert.deepEqual(body, { ok: true }, scenario.label + " must not expose account state or provider request IDs");
    assert([...state.rateLimits.keys()].every(key => !key.includes("13800138000") && !key.includes("203.0.113.88")));
  }

  assert.equal(outcomes[0].state.challenges.length, 0, "existing account must not receive a registration challenge");
  assert.equal(outcomes[1].state.challenges.length, 1, "eligible registration must create one challenge");
  assert.equal(outcomes[2].state.challenges.length, 1, "eligible password reset must create one challenge");
  assert.equal(outcomes[3].state.challenges.length, 0, "unknown account must not receive a reset challenge");

  const sendCalls = providerCalls.filter(call => call.action === "SendSmsVerifyCode");
  assert.equal(sendCalls.length, 2, "PNVS must only be called for eligible registration/reset requests");
  assert(sendCalls.every(call => call.phone === "13800138000"));

  console.log("OTP account-enumeration tests: PASS (uniform response, no provider RequestId leakage, eligible-only SMS sends).");
} finally {
  globalThis.fetch = originalFetch;
}

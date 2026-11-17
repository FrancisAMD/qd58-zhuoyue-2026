import assert from "node:assert/strict";
import worker from "../src/worker.js";

const ORIGIN = "https://58er.eon21.space";
const API = "https://api.58er.eon21.space";
const SECRET = "pnvs-persistence-test-secret-0123456789abcdef";

function makeDb({ failChallengeInsert = false } = {}) {
  const state = { rateLimits: new Map(), challenges: [], events: [], failChallengeInsert };
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
          if (sql.startsWith("SELECT id FROM users WHERE phone=? AND deleted_at=''")) return null;
          return null;
        },
        async run() {
          const a = this.args;
          if (sql.startsWith("INSERT INTO rate_limits(")) {
            const [key, startedAt, resetBefore, , , limit] = a;
            const old = state.rateLimits.get(key);
            if (!old || old.window_started_at <= resetBefore) {
              state.rateLimits.set(key, { window_started_at: startedAt, hit_count: 1 });
              return { meta: { changes: 1 } };
            }
            if (old.hit_count < limit) {
              old.hit_count += 1;
              return { meta: { changes: 1 } };
            }
            return { meta: { changes: 0 } };
          }
          if (sql.startsWith("INSERT INTO otp_challenges")) {
            state.events.push("d1:challenge-insert");
            if (state.failChallengeInsert) throw new Error("simulated_d1_write_failure");
            const [id, phone, codeHash, expiresAt, createdAt, purpose, outId] = a;
            state.challenges.push({ id, phone, codeHash, expiresAt, createdAt, purpose, outId });
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith("DELETE FROM otp_challenges WHERE id=?")) {
            state.events.push("d1:challenge-delete");
            state.challenges = state.challenges.filter(row => row.id !== a[0]);
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith("UPDATE rate_limits SET hit_count=hit_count-1")) {
            const row = state.rateLimits.get(a[0]);
            if (row && row.window_started_at === a[1] && row.hit_count > 0) row.hit_count -= 1;
            return { meta: { changes: row ? 1 : 0 } };
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

function request() {
  return new Request(API + "/api/auth/register/request-code", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      "CF-Connecting-IP": "203.0.113.77"
    },
    body: JSON.stringify({
      phone: "13800138000",
      accountConsent: true,
      turnstileToken: "register"
    })
  });
}

const originalFetch = globalThis.fetch;
const originalConsoleError = console.error;
const providerCalls = [];
let providerMode = "success";
let activeState = null;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  if (url.hostname === "challenges.cloudflare.com") {
    activeState?.events.push("turnstile:verified");
    return new Response(JSON.stringify({
      success: true, action: "register", hostname: "58er.eon21.space"
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.hostname === "dypnsapi.aliyuncs.com") {
    const action = init.headers?.["x-acs-action"];
    const params = url.searchParams;
    providerCalls.push({ action, params });
    activeState?.events.push("pnvs:" + action);
    if (action === "SendSmsVerifyCode") {
      assert.equal(params.get("CountryCode"), "86");
      assert.equal(params.get("PhoneNumber"), "13800138000");
      assert.equal(params.get("SignName"), "test-sign");
      assert.equal(params.get("TemplateCode"), "test-template");
      assert.deepEqual(JSON.parse(params.get("TemplateParam")), { code: "##code##", min: "5" });
      assert.equal(params.get("CodeType"), "1");
      assert.equal(params.get("CodeLength"), "6");
      assert.equal(params.get("ValidTime"), "300");
      assert.equal(params.get("DuplicatePolicy"), "1");
      assert.equal(params.get("Interval"), "60");
      assert.equal(params.get("ReturnVerifyCode"), "false");
      assert.equal(params.get("AutoRetry"), "1");
      assert.ok(params.get("OutId"));
      assert.equal(params.has("VerifyCode"), false);
      if (providerMode === "reject") {
        return new Response(JSON.stringify({
          Success: false, Code: "INVALID_PARAMETERS", Message: "simulated rejection"
        }), { status: 400, headers: { "content-type": "application/json" } });
      }
      if (providerMode === "ambiguous") throw new Error("simulated_network_timeout");
      return new Response(JSON.stringify({
        Success: true, Code: "OK", RequestId: "provider-request-id",
        Model: { VerifyCode: "654321" }
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  }
  throw new Error("Unexpected outbound request: " + url.hostname);
};

async function runScenario(label, options = {}) {
  const { db, state } = makeDb(options);
  activeState = state;
  const response = await worker.fetch(request(), env(db));
  const body = await response.json();
  assert.equal(response.status, 200, label + ": public response remains account-enumeration neutral");
  assert.deepEqual(body, { ok: true }, label + ": provider details and generated code must not reach the browser");
  return state;
}

try {
  console.error = () => {};
  providerMode = "success";
  const success = await runScenario("accepted send");
  assert.equal(success.challenges.length, 1);
  assert.equal(success.challenges[0].codeHash, "ALIYUN", "the locally generated code must never be stored");
  assert.equal(success.challenges[0].outId, providerCalls[0].params.get("OutId"));
  assert(success.events.indexOf("d1:challenge-insert") < success.events.indexOf("pnvs:SendSmsVerifyCode"),
    "the D1 challenge must exist before PNVS can deliver a billable SMS");
  assert(success.rateLimits.size === 3 && [...success.rateLimits.values()].every(x => x.hit_count === 1),
    "accepted SMS keeps all quota reservations");

  providerMode = "reject";
  const rejected = await runScenario("definitive provider rejection");
  assert.equal(rejected.challenges.length, 0, "a definitively rejected send must not leave a verifiable challenge");
  assert([...rejected.rateLimits.values()].every(x => x.hit_count === 0),
    "a definitive rejection releases quota reservations");

  providerMode = "ambiguous";
  const ambiguous = await runScenario("ambiguous transport failure");
  assert.equal(ambiguous.challenges.length, 1,
    "an ambiguous timeout keeps the challenge so an SMS that was delivered can still be verified");
  assert([...ambiguous.rateLimits.values()].every(x => x.hit_count === 1),
    "an ambiguous send keeps quota reservations to prevent duplicate billable SMS");

  providerMode = "success";
  const before = providerCalls.length;
  const storageFailure = await runScenario("D1 challenge storage failure", { failChallengeInsert: true });
  assert.equal(storageFailure.challenges.length, 0);
  assert.equal(providerCalls.length, before, "PNVS must not be called when the challenge cannot be persisted");
  assert([...storageFailure.rateLimits.values()].every(x => x.hit_count === 0),
    "a pre-send storage failure releases reserved quotas");

  console.log("PNVS challenge persistence tests: PASS (provider contract, persist-before-send, definitive rejection cleanup, ambiguous timeout recovery and quota accounting).");
} finally {
  globalThis.fetch = originalFetch;
  console.error = originalConsoleError;
}

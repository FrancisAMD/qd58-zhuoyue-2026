import assert from "node:assert/strict";
import worker from "../src/worker.js";

const ORIGIN = "https://58er.eon21.space";
const API = "https://api.58er.eon21.space";
const PHONE = "13800138000";
const PASSWORD = "Reset-Password-2026!";
const originalFetch = globalThis.fetch;
const originalDateNow = Date.now;
let clockMs = 1_800_000_000_000;
let providerMode = "pass";
let providerHook = null;
let providerCalls = 0;
let barrier = null;
let barrierCount = 0;

function currentSeconds() { return Math.floor(clockMs / 1000); }

function makeDb({ expiresAt = currentSeconds() + 300, attempts = 0, supersededAt = null } = {}) {
  const state = {
    user: { id: "otp-user", phone: PHONE, password_hash: "old-password-hash", auth_version: 1, deleted_at: "" },
    challenge: {
      id: "otp-challenge", phone: PHONE, purpose: "password_reset", out_id: "pnvs-out-id",
      expires_at: expiresAt, attempts, consumed_at: null, superseded_at: supersededAt
    }
  };
  const db = {
    prepare(sql) {
      return {
        args: [],
        bind(...args) { this.args = args; return this; },
        async first() {
          const a = this.args;
          if (sql.startsWith("SELECT id,password_hash,auth_version FROM users WHERE phone=?")) {
            return state.user && state.user.phone === a[0] && state.user.deleted_at === "" ? { ...state.user } : null;
          }
          if (sql.startsWith("SELECT id FROM otp_challenges WHERE phone=? AND purpose=?")) {
            const c = state.challenge;
            return c && c.phone === a[0] && c.purpose === a[1] && c.consumed_at == null && c.superseded_at == null
              ? { id: c.id } : null;
          }
          if (sql.includes("UPDATE otp_challenges") && sql.includes("RETURNING out_id,expires_at")) {
            const [id, phone, purpose, timestamp, maxAttempts] = a;
            const c = state.challenge;
            if (!c || c.id !== id || c.phone !== phone || c.purpose !== purpose ||
                c.consumed_at != null || c.superseded_at != null ||
                c.expires_at <= timestamp || c.attempts >= maxAttempts) return null;
            c.attempts += 1;
            return { out_id: c.out_id, expires_at: c.expires_at };
          }
          return null;
        },
        async run() {
          const a = this.args;
          if (sql.startsWith("UPDATE otp_challenges SET consumed_at=?")) {
            const [consumedAt, id, phone, purpose, timestamp] = a;
            const c = state.challenge;
            if (!c || c.id !== id || c.phone !== phone || c.purpose !== purpose ||
                c.consumed_at != null || c.superseded_at != null || c.expires_at <= timestamp) {
              return { meta: { changes: 0 } };
            }
            c.consumed_at = consumedAt;
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith("UPDATE users SET password_hash=?,auth_version=auth_version+1")) {
            const [hash, updatedAt, id, phone, oldHash, oldVersion] = a;
            const u = state.user;
            if (!u || u.id !== id || u.phone !== phone || u.password_hash !== oldHash ||
                u.auth_version !== oldVersion || u.deleted_at !== "") return { meta: { changes: 0 } };
            u.password_hash = hash;
            u.auth_version += 1;
            u.updated_at = updatedAt;
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        }
      };
    },
    async batch(statements) {
      const snapshot = structuredClone(state.user);
      const results = [];
      try {
        for (const statement of statements) results.push(await statement.run());
        return results;
      } catch (error) {
        state.user = snapshot;
        throw error;
      }
    }
  };
  return { db, state };
}

function env(DB) {
  return {
    APP_ORIGIN: ORIGIN, DB, OTP_MAX_ATTEMPTS: "5",
    ALIBABA_ACCESS_KEY_ID: "test-access-key",
    ALIBABA_ACCESS_KEY_SECRET: "test-access-secret"
  };
}

function resetRequest() {
  return new Request(API + "/api/auth/password/reset", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({ phone: PHONE, newPassword: PASSWORD, code: "654321" })
  });
}

async function callReset(DB) {
  return worker.fetch(resetRequest(), env(DB));
}

try {
  Date.now = () => clockMs;
  console.error = () => {};
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    assert.equal(url.hostname, "dypnsapi.aliyuncs.com");
    assert.equal(init.headers?.["x-acs-action"], "CheckSmsVerifyCode");
    providerCalls++;
    if (providerHook) await providerHook();
    if (barrier) {
      barrierCount++;
      if (barrierCount === 2) barrier.release();
      await barrier.promise;
    }
    return new Response(JSON.stringify({
      Success: true, Code: "OK", Model: { VerifyResult: providerMode === "pass" ? "PASS" : "FAIL" }
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  // An already-expired challenge is rejected before contacting PNVS.
  {
    const { db, state } = makeDb({ expiresAt: currentSeconds() - 1 });
    providerCalls = 0;
    const response = await callReset(db);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "invalid_code");
    assert.equal(providerCalls, 0);
    assert.equal(state.challenge.attempts, 0);
  }

  // A challenge that expires during the provider round trip cannot be consumed.
  {
    const expiresAt = currentSeconds() + 1;
    const { db, state } = makeDb({ expiresAt });
    providerCalls = 0;
    providerHook = async () => { clockMs = expiresAt * 1000; };
    const response = await callReset(db);
    providerHook = null;
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "invalid_code");
    assert.equal(state.challenge.consumed_at, null);
    assert.equal(state.user.auth_version, 1);
    assert.equal(providerCalls, 1);
  }

  // A resend that supersedes the challenge while PNVS is checking it wins.
  {
    clockMs = 1_800_000_000_000;
    const { db, state } = makeDb();
    providerCalls = 0;
    providerHook = async () => { state.challenge.superseded_at = currentSeconds(); };
    const response = await callReset(db);
    providerHook = null;
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "invalid_code");
    assert.equal(state.challenge.consumed_at, null);
    assert.equal(state.user.auth_version, 1);
  }

  // Eight concurrent wrong-code requests may reserve no more than five checks.
  {
    clockMs = 1_800_000_000_000;
    const { db, state } = makeDb();
    providerMode = "fail";
    providerHook = null;
    providerCalls = 0;
    const responses = await Promise.all(Array.from({ length: 8 }, () => callReset(db)));
    assert(responses.every(r => r.status === 400));
    assert.equal(state.challenge.attempts, 5);
    assert.equal(providerCalls, 5);
    providerMode = "pass";
  }

  // Two successful provider checks racing on one challenge can consume it once.
  {
    clockMs = 1_800_000_000_000;
    const { db, state } = makeDb();
    providerCalls = 0;
    barrierCount = 0;
    let release;
    const promise = new Promise(resolve => { release = resolve; });
    barrier = { promise, release };
    const responses = await Promise.all([callReset(db), callReset(db)]);
    barrier = null;
    const statuses = responses.map(r => r.status).sort((a,b) => a-b);
    assert.deepEqual(statuses, [200, 400]);
    assert.equal(state.challenge.attempts, 2);
    assert.notEqual(state.challenge.consumed_at, null);
    assert.equal(state.user.auth_version, 2);
    assert.equal(providerCalls, 2);
  }

  console.log("OTP verification lifecycle tests: PASS (expiry recheck, resend supersession, atomic attempt ceiling and single-use consumption).");
} finally {
  Date.now = originalDateNow;
  globalThis.fetch = originalFetch;
}

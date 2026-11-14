import assert from "node:assert/strict";
import worker, { derivePassword, PBKDF2_ITERATIONS } from "../src/worker.js";

const ORIGIN = "https://58er.eon21.space";
const API = "https://api.58er.eon21.space";
const PHONE = "13800000000";
const USER_ID = "user-account-delete-001";
const TEAM_ID = "team-account-delete-001";
const PASSWORD = "Test-Account-Password-2026!";
const COOKIE = "__Host-qd58_session=" + "a".repeat(64);

async function passwordHash(password) {
  const salt = Uint8Array.from({ length: 16 }, (_, i) => i + 1);
  const bits = await derivePassword(password, salt);
  return "pbkdf2-sha256$" + PBKDF2_ITERATIONS + "$" +
    Buffer.from(salt).toString("base64") + "$" + Buffer.from(bits).toString("base64");
}

function makeDb({ hash, otherMembers = 0, forceDeleteConflict = false } = {}) {
  const state = {
    active: true, tombstone: false, phone: PHONE, passwordHash: hash,
    leadership: otherMembers === null ? null : { id: TEAM_ID, other_members: otherMembers },
    forceDeleteConflict, rateLimits: new Map(), challenge: null,
    challengeDeleted: false, challengeConsumed: false, sessionsRevoked: false,
    leaderReleased: false, pendingTransfersExpired: false, profileFieldsCleared: false,
    audit: null, batchCount: 0
  };
  const db = {
    prepare(sql) {
      return {
        sql, args: [],
        bind(...args) { this.args = args; return this; },
        async first() {
          const a = this.args;
          if (sql.startsWith("SELECT u.id,u.phone")) {
            if (!state.active) return null;
            return {
              id: USER_ID, phone: state.phone, name: "Example Student",
              high_school: "青岛五十八中", class_name: "高三(1)班",
              university_id: "uni-test", grade: "大一", province: "山东省",
              city: "青岛", bio: "private note", phone_visible_to_team: 0,
              consent_given: 1, consent_at: "2026-11-14T00:00:00Z",
              consent_version: "test-v1", account_consent_at: "2026-11-14T00:00:00Z",
              account_consent_version: "test-v1"
            };
          }
          if (sql.startsWith("SELECT id FROM users WHERE phone=? AND deleted_at=''")) {
            return state.active && a[0] === state.phone ? { id: USER_ID } : null;
          }
          if (sql.startsWith("SELECT window_started_at,hit_count FROM rate_limits")) return state.rateLimits.get(a[0]) || null;
          if (sql.startsWith("SELECT window_started_at FROM rate_limits")) {
            const row = state.rateLimits.get(a[0]);
            return row ? { window_started_at: row.window_started_at } : null;
          }
          if (sql.startsWith("SELECT password_hash FROM users WHERE id=? AND deleted_at=''")) {
            return state.active && a[0] === USER_ID ? { password_hash: state.passwordHash } : null;
          }
          if (sql.startsWith("SELECT t.id,")) return state.leadership;
          if (sql.startsWith("SELECT id,out_id,expires_at,consumed_at,attempts FROM otp_challenges")) {
            if (!state.challenge || state.challenge.phone !== a[0] || state.challenge.purpose !== a[1]) return null;
            return { ...state.challenge };
          }
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
            state.challenge = {
              id: a[0], phone: a[1], code_hash: a[2], expires_at: a[3],
              attempts: a[4], consumed_at: a[5], created_at: a[6],
              purpose: a[7], out_id: a[8]
            };
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith("UPDATE otp_challenges SET attempts=attempts+1")) {
            if (!state.challenge || state.challenge.consumed_at || state.challenge.attempts >= 5) return { meta: { changes: 0 } };
            state.challenge.attempts += 1;
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith("UPDATE otp_challenges SET consumed_at=?")) {
            if (!state.challenge || state.challenge.consumed_at) return { meta: { changes: 0 } };
            state.challenge.consumed_at = a[0];
            state.challengeConsumed = true;
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith("UPDATE leader_transfers SET status='expired'")) {
            state.pendingTransfersExpired = true;
            return { meta: { changes: 0 } };
          }
          if (sql.startsWith("DELETE FROM sessions")) {
            state.sessionsRevoked = true;
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith("DELETE FROM otp_challenges")) {
            state.challengeDeleted = true;
            state.challenge = null;
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith("DELETE FROM rate_limits")) {
            for (const key of a) state.rateLimits.delete(key);
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith("UPDATE teams SET leader_user_id=NULL")) {
            if (state.leadership && a[0] === USER_ID && a[1] === state.leadership.id) {
              state.leaderReleased = true;
              state.leadership = null;
            }
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith("UPDATE users SET phone='deleted:'||id")) {
            if (!state.active || state.forceDeleteConflict) return { meta: { changes: 0 } };
            state.active = false;
            state.tombstone = true;
            state.phone = "deleted:" + USER_ID;
            state.passwordHash = null;
            state.profileFieldsCleared = true;
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith("INSERT INTO audit_logs")) {
            // Mirror migration 0009: audit only succeeds after the tombstone.
            if (!state.tombstone) throw new Error("account_delete_conflict");
            state.audit = { id: a[0], targetId: a[1], metadata: a[2] };
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 1 } };
        }
      };
    },
    async batch(statements) {
      state.batchCount += 1;
      const snapshot = {
        active: state.active, tombstone: state.tombstone, phone: state.phone,
        passwordHash: state.passwordHash,
        leadership: state.leadership ? { ...state.leadership } : null,
        rateLimits: new Map([...state.rateLimits].map(([k, v]) => [k, { ...v }])),
        challenge: state.challenge ? { ...state.challenge } : null,
        challengeDeleted: state.challengeDeleted, sessionsRevoked: state.sessionsRevoked,
        leaderReleased: state.leaderReleased, pendingTransfersExpired: state.pendingTransfersExpired,
        profileFieldsCleared: state.profileFieldsCleared, audit: state.audit
      };
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        return results;
      } catch (error) {
        Object.assign(state, snapshot);
        throw error;
      }
    }
  };
  return { db, state };
}

function envFor(DB) {
  return {
    APP_ORIGIN: ORIGIN, DB,
    TURNSTILE_SECRET_KEY: "turnstile-test-secret",
    ALIBABA_ACCESS_KEY_ID: "test-access-key-id",
    ALIBABA_ACCESS_KEY_SECRET: "test-access-key-secret",
    ALIBABA_SIGN_NAME: "test-sign", ALIBABA_TEMPLATE_CODE: "test-template",
    OTP_TTL_SECONDS: "300", OTP_SEND_COOLDOWN_SECONDS: "60"
  };
}

function request(path, body, authenticated = true) {
  const headers = {
    "content-type": "application/json", origin: ORIGIN,
    "CF-Connecting-IP": "198.51.100.20"
  };
  if (authenticated) headers.cookie = COOKIE;
  return new Request(API + path, { method: "POST", headers, body: JSON.stringify(body || {}) });
}

let turnstileMode = "pass";
const providerCalls = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  if (url.hostname === "challenges.cloudflare.com") {
    const form = new URLSearchParams(init.body);
    const success = turnstileMode === "pass" && form.get("response") === "turnstile-valid";
    return new Response(JSON.stringify({
      success, action: "account_delete", hostname: "58er.eon21.space"
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.hostname === "dypnsapi.aliyuncs.com") {
    const action = init.headers?.["x-acs-action"];
    const phone = url.searchParams.get("PhoneNumber");
    const code = url.searchParams.get("VerifyCode");
    providerCalls.push({ action, phone, code });
    if (action === "SendSmsVerifyCode") {
      return new Response(JSON.stringify({ Success: true, Code: "OK", RequestId: "pnvs-send-test" }), { status: 200 });
    }
    if (action === "CheckSmsVerifyCode") {
      const pass = code === "246810";
      return new Response(JSON.stringify({
        Success: true, Code: "OK",
        Model: { VerifyResult: pass ? "PASS" : "FAIL" },
        RequestId: "pnvs-check-test"
      }), { status: 200 });
    }
  }
  throw new Error("Unexpected outbound request in account deletion test: " + url.hostname);
};

try {
  for (const path of ["/api/account/delete/request-code", "/api/account/delete"]) {
    const response = await worker.fetch(request(path, {}, false), { APP_ORIGIN: ORIGIN });
    assert.equal(response.status, 401, path + " must require an authenticated session");
  }
  const unauthenticatedProfile = await worker.fetch(new Request(API + "/api/profile", {
    headers: { origin: ORIGIN }
  }), { APP_ORIGIN: ORIGIN });
  assert.equal(unauthenticatedProfile.status, 401);

  const hash = await passwordHash(PASSWORD);
  const { db, state } = makeDb({ hash });
  const env = envFor(db);

  turnstileMode = "reject";
  const rejected = await worker.fetch(request("/api/account/delete/request-code", {
    phone: "13911112222", turnstileToken: "turnstile-rejected"
  }), env);
  const rejectedBody = await rejected.json();
  assert.equal(rejected.status, 403);
  assert.equal(rejectedBody.error, "turnstile_failed");
  assert.equal(rejectedBody.refreshTurnstile, true);
  assert.equal(providerCalls.length, 0, "failed Turnstile must not send SMS");
  assert.equal(state.rateLimits.size, 0, "failed Turnstile must not reserve SMS quota");

  turnstileMode = "pass";
  const sent = await worker.fetch(request("/api/account/delete/request-code", {
    phone: "13911112222", turnstileToken: "turnstile-valid"
  }), env);
  const sentBody = await sent.json();
  assert.equal(sent.status, 200);
  assert.equal(sentBody.requestId, "pnvs-send-test");
  assert.equal(JSON.stringify(sentBody).includes("246810"), false);
  const sendCall = providerCalls.find(call => call.action === "SendSmsVerifyCode");
  assert.equal(sendCall?.phone, PHONE, "PNVS must receive the session-bound phone");
  assert.equal(state.challenge?.purpose, "account_delete");
  assert.equal(state.challenge?.code_hash, "ALIYUN", "the verification code itself must not be stored");

  const wrongCode = await worker.fetch(request("/api/account/delete", {
    confirmText: "DELETE", password: PASSWORD, code: "000000"
  }), env);
  assert.equal(wrongCode.status, 400);
  assert.equal((await wrongCode.json()).error, "invalid_code");
  assert.equal(state.batchCount, 0);
  assert.equal(state.active, true);

  const deleted = await worker.fetch(request("/api/account/delete", {
    confirmText: "DELETE", password: PASSWORD, code: "246810"
  }), env);
  assert.equal(deleted.status, 200);
  assert.deepEqual(await deleted.json(), { ok: true, anonymized: true });
  assert.match(deleted.headers.get("set-cookie") || "", /Max-Age=0/);
  assert.equal(state.active, false);
  assert.equal(state.tombstone, true);
  assert.equal(state.profileFieldsCleared, true);
  assert.equal(state.sessionsRevoked, true);
  assert.equal(state.leaderReleased, true);
  assert.equal(state.challengeDeleted, true);
  assert.equal(state.audit?.targetId, USER_ID);
  assert.equal(state.audit?.metadata.includes(PHONE), false);
  assert.equal(state.audit?.metadata.includes("Example Student"), false);

  const afterDeleteProfile = await worker.fetch(new Request(API + "/api/profile", {
    headers: { origin: ORIGIN, cookie: COOKIE }
  }), env);
  assert.equal(afterDeleteProfile.status, 401);
  const afterDeleteSms = await worker.fetch(request("/api/account/delete/request-code", {
    turnstileToken: "turnstile-valid"
  }), env);
  assert.equal(afterDeleteSms.status, 401);

  const wrongPasswordDb = makeDb({ hash });
  const checksBeforePassword = providerCalls.filter(call => call.action === "CheckSmsVerifyCode").length;
  const wrongPassword = await worker.fetch(request("/api/account/delete", {
    confirmText: "DELETE", password: "incorrect-password", code: "246810"
  }), envFor(wrongPasswordDb.db));
  assert.equal(wrongPassword.status, 401);
  assert.equal((await wrongPassword.json()).error, "current_password_invalid");
  assert.equal(wrongPasswordDb.state.batchCount, 0);
  assert.equal(providerCalls.filter(call => call.action === "CheckSmsVerifyCode").length, checksBeforePassword);

  const leaderDb = makeDb({ hash, otherMembers: 2 });
  const leaderBlocked = await worker.fetch(request("/api/account/delete", {
    confirmText: "DELETE", password: PASSWORD, code: "246810"
  }), envFor(leaderDb.db));
  assert.equal(leaderBlocked.status, 409);
  assert.equal((await leaderBlocked.json()).error, "leader_transfer_required");
  assert.equal(leaderDb.state.batchCount, 0);

  // If the guarded user update affects zero rows, migration 0009 makes the
  // final audit insert fail; D1 batch then rolls back all earlier cleanup.
  const conflictDb = makeDb({ hash, forceDeleteConflict: true });
  const conflictEnv = envFor(conflictDb.db);
  const conflictCode = await worker.fetch(request("/api/account/delete/request-code", {
    turnstileToken: "turnstile-valid"
  }), conflictEnv);
  assert.equal(conflictCode.status, 200);
  const conflict = await worker.fetch(request("/api/account/delete", {
    confirmText: "DELETE", password: PASSWORD, code: "246810"
  }), conflictEnv);
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).error, "account_delete_conflict");
  assert.equal(conflictDb.state.active, true);
  assert.equal(conflictDb.state.sessionsRevoked, false);
  assert.equal(conflictDb.state.leaderReleased, false);
  assert.equal(conflictDb.state.pendingTransfersExpired, false);
  assert.equal(conflictDb.state.audit, null);

  console.log("Account lifecycle tests: PASS (session binding, Turnstile, mocked PNVS send/check, password gate, leadership guard, anonymization, session revocation and atomic conflict handling).");
} finally {
  globalThis.fetch = originalFetch;
}

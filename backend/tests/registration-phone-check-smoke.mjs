import assert from "node:assert/strict";
import worker from "../src/worker.js";

const ORIGIN = "https://58er.eon21.space";
const API = "https://api.58er.eon21.space";
const PHONE = "13812345678";
const SECRET = "registration-ownership-test-secret-0123456789abcdef";

function makeDb({ exists = true, hasChallenge = true } = {}) {
  const state = {
    exists, hasChallenge, challengeConsumed: false,
    userLookups: 0, userLookupAfterChallengeConsume: false
  };
  const DB = {
    prepare(sql) {
      return {
        args: [],
        bind(...args) { this.args = args; return this; },
        async first() {
          if (sql.startsWith("SELECT id FROM otp_challenges")) {
            return state.hasChallenge ? { id: "challenge-1" } : null;
          }
          if (sql.startsWith("UPDATE otp_challenges") && sql.includes("RETURNING out_id,expires_at")) {
            return state.hasChallenge
              ? { out_id: "provider-out-1", expires_at: Math.floor(Date.now() / 1000) + 300 }
              : null;
          }
          if (sql.startsWith("SELECT id FROM users WHERE phone=? AND deleted_at=''")) {
            state.userLookups += 1;
            state.userLookupAfterChallengeConsume = state.challengeConsumed;
            return state.exists ? { id: "existing-user" } : null;
          }
          return null;
        },
        async run() {
          if (sql.startsWith("UPDATE otp_challenges SET consumed_at=")) {
            state.challengeConsumed = true;
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 1 } };
        }
      };
    }
  };
  return { DB, state };
}

function request(path, data) {
  return new Request(API + path, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify(data)
  });
}

function env(DB) {
  return {
    APP_ORIGIN: ORIGIN,
    DB,
    RATE_LIMIT_HMAC_SECRET: SECRET,
    ALIBABA_ACCESS_KEY_ID: "test-access-key-id",
    ALIBABA_ACCESS_KEY_SECRET: "test-access-key-secret"
  };
}

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  if (url.hostname === "dypnsapi.aliyuncs.com") {
    const action = init.headers?.["x-acs-action"];
    assert.equal(action, "CheckSmsVerifyCode", "registration must verify the SMS code before looking up the account");
    return new Response(JSON.stringify({
      Success: true, Code: "OK", Model: { VerifyResult: "PASS" }
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  throw new Error("Unexpected outbound request: " + url.hostname);
};

try {
  const precheckDb = makeDb({ exists: true });
  const precheck = await worker.fetch(
    request("/api/auth/register/check-phone", { phone: PHONE, accountConsent: true }),
    env(precheckDb.DB)
  );
  assert.equal(precheck.status, 404, "the public registration phone-precheck endpoint must be removed");
  assert.equal(precheckDb.state.userLookups, 0, "removed precheck must never read account state");

  const noCodeDb = makeDb({ exists: true, hasChallenge: false });
  const noCode = await worker.fetch(
    request("/api/auth/register", {
      phone: PHONE, password: "Valid-Password-2026!", code: "123456", accountConsent: true
    }),
    env(noCodeDb.DB)
  );
  assert.equal(noCode.status, 400);
  assert.equal((await noCode.json()).error, "invalid_code");
  assert.equal(noCodeDb.state.userLookups, 0, "an unverified visitor must not learn whether the phone is registered");

  const verifiedDb = makeDb({ exists: true, hasChallenge: true });
  const duplicate = await worker.fetch(
    request("/api/auth/register", {
      phone: PHONE, password: "Valid-Password-2026!", code: "123456", accountConsent: true
    }),
    env(verifiedDb.DB)
  );
  assert.equal(duplicate.status, 409);
  assert.equal((await duplicate.json()).error, "phone_already_registered");
  assert.equal(verifiedDb.state.challengeConsumed, true, "the SMS code must be consumed before account-state disclosure");
  assert.equal(verifiedDb.state.userLookups, 1);
  assert.equal(verifiedDb.state.userLookupAfterChallengeConsume, true, "account lookup must occur only after successful SMS verification");

  console.log("Registration ownership verification tests: PASS (no public precheck; account state disclosed only after SMS ownership proof).");
} finally {
  globalThis.fetch = originalFetch;
}

import assert from "node:assert/strict";
import guardedWorker from "../src/worker-entry.js";

const APP_ORIGIN = "https://58er.eon21.space";
const API_ORIGIN = "https://api.58er.eon21.space";
const SESSION_TOKEN = "a".repeat(64);

function mockEnv(otherMembers) {
  const DB = {
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async first() {
              if (sql.includes("FROM sessions s JOIN users u")) return { id: "user-1" };
              if (sql.includes("FROM teams t WHERE t.leader_user_id")) {
                return otherMembers > 0 ? { id: "team-1", other_members: otherMembers } : null;
              }
              throw new Error("Unexpected SQL in preflight smoke test");
            }
          };
        }
      };
    }
  };
  return { APP_ORIGIN, DB };
}

function request(path, method = "GET", withSession = true) {
  const headers = new Headers({ Origin: APP_ORIGIN });
  if (withSession) headers.set("Cookie", "__Host-qd58_session=" + SESSION_TOKEN);
  if (method === "POST") headers.set("Content-Type", "application/json");
  return new Request(API_ORIGIN + path, {
    method,
    headers,
    body: method === "POST" ? JSON.stringify({ turnstileToken: "must-not-be-consumed" }) : undefined
  });
}

{
  const response = await guardedWorker.fetch(request("/api/account/delete/preflight"), mockEnv(2), {});
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.canDelete, false);
  assert.equal(body.reason, "leader_transfer_required");
}

{
  const response = await guardedWorker.fetch(request("/api/account/delete/request-code", "POST"), mockEnv(3), {});
  const body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(body.error, "leader_transfer_required");
}

{
  const response = await guardedWorker.fetch(request("/api/account/delete", "POST"), mockEnv(1), {});
  const body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(body.error, "leader_transfer_required");
}

{
  const response = await guardedWorker.fetch(request("/api/account/delete/preflight"), mockEnv(0), {});
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.canDelete, true);
  assert.equal(body.reason, null);
}

{
  const response = await guardedWorker.fetch(request("/api/account/delete/preflight", "GET", false), mockEnv(0), {});
  assert.equal(response.status, 401);
}

console.log("PASS: account deletion eligibility blocks leaders before Turnstile/OTP and permits eligible sessions");

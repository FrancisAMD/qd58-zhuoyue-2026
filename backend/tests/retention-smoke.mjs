import assert from "node:assert/strict";
import { cleanupExpiredSecurityData, createRateLimitKey } from "../src/worker.js";

const secret = "retention-smoke-secret-0123456789abcdef";
const phone = "13800138000";
const ip = "203.0.113.42";
const phoneKey = await createRateLimitKey(secret, "sms:phone", phone);
const samePhoneKey = await createRateLimitKey(secret, "sms:phone", phone);
const ipKey = await createRateLimitKey(secret, "sms:ip", ip);
assert.equal(phoneKey, samePhoneKey);
assert.notEqual(phoneKey, ipKey);
assert.match(phoneKey, /^rl:v1:sms:phone:[a-f0-9]{64}$/);
assert.equal(phoneKey.includes(phone), false);
assert.equal(ipKey.includes(ip), false);
assert.notEqual(phoneKey, await createRateLimitKey(secret + "x", "sms:phone", phone));
await assert.rejects(() => createRateLimitKey("short", "sms:phone", phone), /rate_limit_secret_not_configured/);

const calls=[];
const db={
  prepare(sql){return {sql,args:[],bind(...args){this.args=args;return this;},async run(){return {meta:{changes:0}}};}},
  async batch(statements){calls.push(...statements.map(({sql,args})=>({sql,args})));return statements.map(()=>({meta:{changes:0}}));}
};
const timestamp=2_000_000_000;
await cleanupExpiredSecurityData(db,timestamp);
assert.equal(calls.length,4);
assert(calls[0].sql.includes("DELETE FROM otp_challenges") && calls[0].sql.includes("LIMIT 500"));
assert.deepEqual(calls[0].args,[timestamp-86400,timestamp-86400]);
assert(calls[1].sql.includes("DELETE FROM sessions") && calls[1].sql.includes("LIMIT 500"));
assert.deepEqual(calls[1].args,[timestamp]);
assert(calls[2].sql.includes("DELETE FROM admin_sessions") && calls[2].sql.includes("LIMIT 500"));
assert.deepEqual(calls[2].args,[timestamp]);
assert(calls[3].sql.includes("DELETE FROM rate_limits") && calls[3].sql.includes("LIMIT 500"));
assert.deepEqual(calls[3].args,[timestamp-86400,timestamp-172800]);
console.log("Security retention tests: PASS");

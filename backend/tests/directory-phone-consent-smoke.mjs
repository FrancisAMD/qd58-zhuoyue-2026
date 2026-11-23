import assert from "node:assert/strict";
import worker from "../src/worker.js";

const APP_ORIGIN = "https://58er.eon21.space";
const SESSION_TOKEN = "a".repeat(64);
const PRIVACY_NOTICE_VERSION = "2026-11-15-v3";
const cookie = "__Host-qd58_session=" + SESSION_TOKEN;

const currentUser = {
  id: "viewer-1",
  phone: "13800000000",
  name: "当前用户",
  university_id: "university-1",
  province: "山东省",
  phone_visible_to_team: 0,
  consent_given: 1,
  consent_at: "2026-11-20T00:00:00.000Z",
  consent_version: PRIVACY_NOTICE_VERSION,
  account_consent_at: "2026-11-20T00:00:00.000Z",
  account_consent_version: PRIVACY_NOTICE_VERSION,
  deleted_at: "",
  auth_version: 1
};

const candidates = [
  {
    name: "明确授权且同意仍有效",
    phone: "13800000001",
    phone_visible_to_team: 1,
    consent_given: 1,
    consent_at: "2026-11-20T00:00:00.000Z",
    consent_version: PRIVACY_NOTICE_VERSION,
    account_consent_at: "2026-11-20T00:00:00.000Z",
    account_consent_version: PRIVACY_NOTICE_VERSION
  },
  {
    name: "主动关闭手机号展示",
    phone: "13800000002",
    phone_visible_to_team: 0,
    consent_given: 1,
    consent_at: "2026-11-20T00:00:00.000Z",
    consent_version: PRIVACY_NOTICE_VERSION,
    account_consent_at: "2026-11-20T00:00:00.000Z",
    account_consent_version: PRIVACY_NOTICE_VERSION
  },
  {
    name: "旧版隐私同意",
    phone: "13800000003",
    phone_visible_to_team: 1,
    consent_given: 1,
    consent_at: "2026-11-20T00:00:00.000Z",
    consent_version: "2026-11-14-v2",
    account_consent_at: "2026-11-20T00:00:00.000Z",
    account_consent_version: "2026-11-14-v2"
  },
  {
    name: "缺少资料同意时间",
    phone: "13800000004",
    phone_visible_to_team: 1,
    consent_given: 1,
    consent_at: "",
    consent_version: PRIVACY_NOTICE_VERSION,
    account_consent_at: "2026-11-20T00:00:00.000Z",
    account_consent_version: PRIVACY_NOTICE_VERSION
  },
  {
    name: "缺少账号同意记录",
    phone: "13800000005",
    phone_visible_to_team: 1,
    consent_given: 1,
    consent_at: "2026-11-20T00:00:00.000Z",
    consent_version: PRIVACY_NOTICE_VERSION,
    account_consent_at: "",
    account_consent_version: PRIVACY_NOTICE_VERSION
  },
  {
    name: "账号同意版本不匹配",
    phone: "13800000006",
    phone_visible_to_team: 1,
    consent_given: 1,
    consent_at: "2026-11-20T00:00:00.000Z",
    consent_version: PRIVACY_NOTICE_VERSION,
    account_consent_at: "2026-11-20T00:00:00.000Z",
    account_consent_version: "older-version"
  }
];

const state = { queries: [] };
const DB = {
  prepare(sql) {
    return {
      sql,
      bind(...bindings) {
        return {
          sql,
          bindings,
          first: async () => {
            state.queries.push({ method: "first", sql, bindings });
            if (sql.startsWith("SELECT u.id,u.phone")) return currentUser;
            if (sql.startsWith("SELECT university_id,province FROM users WHERE id=?")) {
              return { university_id: "university-1", province: "山东省" };
            }
            throw new Error("Unexpected first query: " + sql);
          },
          all: async () => {
            state.queries.push({ method: "all", sql, bindings });
            if (sql.includes("CASE WHEN u.phone_visible_to_team=1")) {
              const [consentVersion, accountConsentVersion, universityId, excludedUserId] = bindings;
              assert.equal(consentVersion, PRIVACY_NOTICE_VERSION);
              assert.equal(accountConsentVersion, PRIVACY_NOTICE_VERSION);
              assert.equal(universityId, "university-1");
              assert.equal(excludedUserId, "viewer-1");
              return {
                results: candidates.map(member => ({
                  name: member.name,
                  phone: member.phone_visible_to_team === 1
                    && member.consent_given === 1
                    && member.consent_at !== ""
                    && member.consent_version === consentVersion
                    && member.account_consent_at !== ""
                    && member.account_consent_version === accountConsentVersion
                      ? member.phone
                      : null
                }))
              };
            }
            if (sql.startsWith("SELECT u.name,u.grade,u.province,uni.canonical_name")) {
              return { results: [{ name: "同省队长", university: "另一所大学", province: "山东省" }] };
            }
            throw new Error("Unexpected all query: " + sql);
          }
        };
      }
    };
  }
};

const response = await worker.fetch(new Request("https://api.58er.eon21.space/api/directory", {
  headers: { origin: APP_ORIGIN, cookie }
}), { APP_ORIGIN, DB });
assert.equal(response.status, 200);
const result = await response.json();

assert.equal(result.members.length, candidates.length);
assert.equal(result.members[0].phone, "13800000001", "only an explicit, current opt-in may reveal a phone number");
for (const member of result.members.slice(1)) {
  assert.equal(member.phone, null, member.name + " must not expose a phone number");
}
assert.equal(result.provinceLeaders.length, 1);
assert.equal(Object.hasOwn(result.provinceLeaders[0], "phone"), false, "province leader list must never include phone numbers");

const memberQuery = state.queries.find(query => query.sql.includes("CASE WHEN u.phone_visible_to_team=1"));
assert.ok(memberQuery, "directory member query must apply phone disclosure policy in SQL");
for (const predicate of [
  "u.phone_visible_to_team=1",
  "u.consent_given=1",
  "u.consent_at<>''",
  "u.consent_version=?",
  "u.account_consent_at<>''",
  "u.account_consent_version=?"
]) assert.ok(memberQuery.sql.includes(predicate), "missing privacy predicate: " + predicate);

console.log("directory-phone-consent-smoke: all assertions passed");

import assert from "node:assert/strict";
import worker from "../src/worker.js";

const APP_ORIGIN = "https://58er.eon21.space";
const rows = [
  {
    catalog_id: "mainland:CN-10001", canonical_name: "青岛大学", name_en: "Qingdao University",
    category: "mainland", country_code: "CN", country_name_zh: "中国", country_name_en: "China",
    province_code: "CN-37", province_name_zh: "山东省", city_name_zh: "青岛市",
    official_school_code: "11065", degree_levels_json: '["undergraduate"]', ownership: "public",
    verified_at: "2026-11-21T00:00:00Z"
  },
  {
    catalog_id: "mainland:CN-10002", canonical_name: "中国海洋大学", name_en: "Ocean University of China",
    category: "mainland", country_code: "CN", country_name_zh: "中国", country_name_en: "China",
    province_code: "CN-37", province_name_zh: "山东省", city_name_zh: "青岛市",
    official_school_code: "10423", degree_levels_json: "not-json", ownership: "public",
    verified_at: "2026-11-21T00:00:00Z"
  },
  {
    catalog_id: "mainland:CN-10003", canonical_name: "山东大学", name_en: "Shandong University",
    category: "mainland", country_code: "CN", country_name_zh: "中国", country_name_en: "China",
    province_code: "CN-37", province_name_zh: "山东省", city_name_zh: "济南市",
    official_school_code: "10422", degree_levels_json: '["undergraduate","postgraduate"]', ownership: "public",
    verified_at: "2026-11-21T00:00:00Z"
  }
];

function makeDb(resultRows = []) {
  const state = { calls: 0, sql: "", bindings: [] };
  const DB = {
    prepare(sql) {
      return {
        bind(...bindings) {
          return {
            all: async () => {
              state.calls++;
              state.sql = sql;
              state.bindings = bindings;
              return { results: resultRows };
            }
          };
        }
      };
    }
  };
  return { DB, state };
}

async function get(path, db) {
  return worker.fetch(new Request("https://api.58er.eon21.space" + path, {
    method: "GET",
    headers: { origin: APP_ORIGIN }
  }), { APP_ORIGIN, DB: db });
}

const db = makeDb(rows);
const searched = await get("/api/universities?q=%E9%9D%92%E5%B2%9B-%E5%A4%A7%E5%AD%A6&category=mainland&countryCode=cn&provinceCode=CN-37&limit=2&offset=3", db.DB);
const searchedBody = await searched.json();
assert.equal(searched.status, 200);
assert.equal(searchedBody.universities.length, 2);
assert.equal(searchedBody.pagination.hasMore, true);
assert.deepEqual(searchedBody.pagination, { limit: 2, offset: 3, hasMore: true });
assert.equal(searchedBody.universities[0].id, "mainland:CN-10001");
assert.deepEqual(searchedBody.universities[0].degreeLevels, ["undergraduate"]);
assert.deepEqual(searchedBody.universities[1].degreeLevels, [], "malformed JSON metadata must fail closed");
assert.equal("phone" in searchedBody.universities[0], false);
assert.equal("phoneVisible" in searchedBody.universities[0], false);
assert.ok(db.state.sql.includes("u.catalog_id IS NOT NULL"));
assert.ok(db.state.sql.includes("u.catalog_status='active'"));
assert.ok(db.state.sql.includes("u.verification_status='verified'"));
assert.ok(db.state.sql.includes("u.verified_at IS NOT NULL"));
assert.ok(db.state.sql.includes("university_aliases"));
assert.ok(!/\bphone\b/i.test(db.state.sql), "catalog query must not select or filter personal phone data");
assert.deepEqual(db.state.bindings, [
  "mainland", "CN", "CN-37",
  "青岛大学", "青岛-大学", "青岛大学",
  3, 3
]);

const codeDb = makeDb([]);
const codeSearch = await get("/api/universities?q=110", codeDb.DB);
assert.equal(codeSearch.status, 200);
assert.ok(codeDb.state.sql.includes("u.official_school_code LIKE ?"));
assert.equal(codeDb.state.bindings[3], "110%");
assert.equal(codeDb.state.bindings.at(-2), 11);

const categoryDb = makeDb([]);
const categoryOnly = await get("/api/universities?category=overseas&limit=5", categoryDb.DB);
assert.equal(categoryOnly.status, 200);
assert.deepEqual(await categoryOnly.json(), {
  universities: [],
  pagination: { limit: 5, offset: 0, hasMore: false }
});
assert.ok(categoryDb.state.sql.includes("u.category=?"));

const provinceDb = makeDb([]);
const provinceOnly = await get("/api/universities?provinceCode=CN-37", provinceDb.DB);
assert.equal(provinceOnly.status, 200);
assert.deepEqual(provinceDb.state.bindings, ["mainland", "CN", "CN-37", 11, 0]);

for (const [path, expected] of [
  ["/api/universities", "catalog_filter_required"],
  ["/api/universities?category=invalid", "invalid_category"],
  ["/api/universities?countryCode=ZZZ", "invalid_country_code"],
  ["/api/universities?provinceCode=US-CA", "invalid_province_code"],
  ["/api/universities?category=overseas&provinceCode=CN-37", "catalog_filter_conflict"],
  ["/api/universities?category=mainland&countryCode=US", "catalog_filter_conflict"],
  ["/api/universities?q=%25", "invalid_query"],
  ["/api/universities?q=" + "a".repeat(81), "query_too_long"],
  ["/api/universities?category=mainland&limit=26", "invalid_pagination"],
  ["/api/universities?category=mainland&offset=1001", "invalid_pagination"]
]) {
  const invalidDb = makeDb([]);
  const response = await get(path, invalidDb.DB);
  const body = await response.json();
  assert.equal(response.status, 400, path);
  assert.equal(body.error, expected, path);
  assert.equal(invalidDb.state.calls, 0, "invalid query must not reach D1: " + path);
}

console.log("university-catalog-api-smoke: all assertions passed");

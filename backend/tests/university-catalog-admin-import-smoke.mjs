import assert from "node:assert/strict";
import worker from "../src/worker.js";
import { planCatalogImport } from "../../scripts/plan-university-catalog-import.mjs";
import {
  buildCatalogImportManifest,
  revalidateCatalogImportTargets
} from "../src/university-catalog-import.js";

const ORIGIN = "https://58er.eon21.space";
const SESSION_TOKEN = "a".repeat(64);
const SESSION_COOKIE = "__Host-qd58_admin=" + SESSION_TOKEN;

const record = {
  id: "mainland:CN-10001",
  official_school_code: "10001",
  name_zh: "示例大学",
  name_en: null,
  aliases: ["示例大"],
  category: "mainland",
  degree_levels: ["undergraduate"],
  ownership: "public",
  school_type_tags: ["comprehensive"],
  project_tags: ["project_985_legacy"],
  double_first_class_disciplines: [],
  location: {
    country_code: "CN",
    country_name_zh: "中国",
    country_name_en: "China",
    province_code: "CN-37",
    province_name_zh: "山东省",
    city_name_zh: "青岛市"
  },
  campus_structure: "multiple",
  has_branch_campus: null,
  campus_info_status: "partial",
  campuses: [{
    id: "main",
    name_zh: "主校区",
    name_en: null,
    is_main_campus: true,
    is_branch_campus: false,
    location: {
      country_code: "CN",
      country_name_zh: "中国",
      country_name_en: "China",
      province_code: "CN-37",
      province_name_zh: "山东省",
      city_name_zh: "青岛市"
    }
  }],
  source_records: [{
    source_type: "institution",
    publisher: "示例大学官网",
    title: "学校简介",
    url: "https://example.edu.cn/about",
    accessed_at: "2026-11-23",
    supports_fields: ["official_school_code", "name_zh", "category", "degree_levels", "location", "project_tags"]
  }],
  verification: {
    status: "verified",
    verified_at: "2026-11-23T00:00:00.000Z",
    verified_fields: ["official_school_code", "name_zh", "category", "degree_levels", "location", "project_tags"],
    notes: "synthetic test fixture"
  },
  status: "active",
  merged_into: null
};

function makeCatalog() {
  return {
    schema_version: "1.0.0",
    dataset_version: "2026-11-24",
    generated_at: null,
    universities: [record]
  };
}
function makeSnapshot(universities = [], imports = []) {
  return { schema_version: "1.0.0", exported_at: null, universities, imports };
}
async function makeManifest(snapshot = makeSnapshot()) {
  const catalog = makeCatalog();
  const sourceText = JSON.stringify(catalog);
  const plan = planCatalogImport(catalog, snapshot, sourceText);
  assert.equal(plan.requires_manual_review, false);
  return buildCatalogImportManifest(catalog, plan, sourceText);
}

class ImportRouteDB {
  constructor({ role = "owner", universities = [] } = {}) {
    this.role = role;
    this.universities = universities;
    this.importRow = null;
    this.stagingRows = [];
    this.auditRows = [];
    this.batches = [];
    this.queries = [];
  }
  prepare(sql) {
    const db = this;
    return {
      bind(...values) {
        return {
          sql,
          values,
          first: () => db.first(sql, values),
          all: () => db.all(sql, values),
          run: () => db.run(sql, values)
        };
      }
    };
  }
  async first(sql, values) {
    this.queries.push(sql);
    if (sql.startsWith("SELECT a.id,a.username,a.role FROM admin_sessions")) {
      return this.role ? { id: "owner-test", username: "owner", role: this.role } : null;
    }
    if (sql.includes("FROM university_catalog_imports")) return this.importRow;
    return null;
  }
  async all(sql, values) {
    this.queries.push(sql);
    if (sql.startsWith("SELECT id,catalog_id,catalog_normalized_name,official_school_code,category,country_code FROM universities")) {
      return { results: this.universities };
    }
    if (sql.includes("FROM university_catalog_import_staging")) {
      const version = values[0];
      return { results: this.stagingRows.filter(row => row.dataset_version === version) };
    }
    return { results: [] };
  }
  async run(sql, values) {
    this.queries.push(sql);
    if (sql.startsWith("INSERT INTO university_catalog_imports")) {
      if (!this.importRow) {
        this.importRow = {
          dataset_version: values[0],
          checksum_sha256: values[1],
          manifest_sha256: values[2],
          record_count: values[4],
          status: "validated"
        };
      }
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("INSERT INTO audit_logs")) {
      this.auditRows.push(values);
      return { meta: { changes: 1 } };
    }
    return { meta: { changes: 1 } };
  }
  async batch(statements) {
    this.batches.push(statements);
    if (statements[0]?.sql.startsWith("INSERT INTO university_catalog_import_staging")) {
      for (const statement of statements) {
        const values = statement.values;
        if (!this.stagingRows.some(row =>
          row.dataset_version === values[0] && row.catalog_id === values[2]
        )) {
          this.stagingRows.push({
            dataset_version: values[0],
            checksum_sha256: values[1],
            catalog_id: values[2],
            target_university_id: values[3],
            action: values[4],
            payload_json: values[5],
            payload_sha256: values[6]
          });
        }
      }
      return statements.map(() => ({ meta: { changes: 1 } }));
    }
    if (statements.length === 13) {
      this.importRow.status = "applied";
      this.stagingRows = [];
      return statements.map((statement, index) => ({ meta: { changes: index === 10 ? 1 : 0 } }));
    }
    throw new Error("unexpected_import_batch");
  }
}

function request(path, { method = "POST", body, cookie = SESSION_COOKIE, origin = ORIGIN } = {}) {
  const headers = { origin, cookie, "content-type": "application/json" };
  return new Request(ORIGIN + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}
function env(db, enabled = true) {
  return {
    APP_ORIGIN: ORIGIN,
    DB: db,
    UNIVERSITY_CATALOG_IMPORT_ENABLED: enabled ? "true" : "false"
  };
}

const manifest = await makeManifest();
assert.equal(manifest.record_count, 1);
assert.equal(manifest.records[0].action, "insert");

const unauthDb = new ImportRouteDB({ role: null });
const unauth = await worker.fetch(request("/api/admin/universities/import/stage", { cookie: "" }), env(unauthDb));
assert.equal(unauth.status, 401);
assert.equal(unauthDb.queries.some(sql => sql.startsWith("SELECT id,catalog_id")), false);

const adminDb = new ImportRouteDB({ role: "admin" });
const nonOwner = await worker.fetch(request("/api/admin/universities/import/stage", { body: { manifest } }), env(adminDb));
assert.equal(nonOwner.status, 403);
assert.equal(adminDb.stagingRows.length, 0);

const disabledDb = new ImportRouteDB();
const disabled = await worker.fetch(request("/api/admin/universities/import/stage", { body: { manifest } }), env(disabledDb, false));
assert.equal(disabled.status, 503);
assert.equal(disabledDb.stagingRows.length, 0);

const wrongOriginDb = new ImportRouteDB();
const wrongOrigin = await worker.fetch(request("/api/admin/universities/import/stage", { body: { manifest }, origin: "https://evil.example" }), env(wrongOriginDb));
assert.equal(wrongOrigin.status, 403);
assert.equal(wrongOriginDb.stagingRows.length, 0);

const staleDb = new ImportRouteDB({
  universities: [{
    id: record.id,
    catalog_id: null,
    catalog_normalized_name: null,
    official_school_code: null,
    category: "mainland",
    country_code: "CN"
  }]
});
const stale = await worker.fetch(request("/api/admin/universities/import/stage", { body: { manifest } }), env(staleDb));
assert.equal(stale.status, 409);
assert.equal(staleDb.stagingRows.length, 0);

const unverifiedManifest = structuredClone(manifest);
const unverifiedPayload = JSON.parse(unverifiedManifest.records[0].payload_json);
unverifiedPayload.record.verification.status = "needs_review";
unverifiedManifest.records[0].payload_json = JSON.stringify(unverifiedPayload);
const { createHash } = await import("node:crypto");
unverifiedManifest.records[0].payload_sha256 = createHash("sha256").update(unverifiedManifest.records[0].payload_json).digest("hex");
const manifestRows = unverifiedManifest.records.map(item => item.catalog_id + ":" + item.payload_sha256).sort();
unverifiedManifest.manifest_sha256 = createHash("sha256").update(unverifiedManifest.dataset_version + "\n" + manifestRows.join("\n") + "\n").digest("hex");
const unverifiedDb = new ImportRouteDB();
const unverified = await worker.fetch(request("/api/admin/universities/import/stage", { body: { manifest: unverifiedManifest } }), env(unverifiedDb));
assert.equal(unverified.status, 400);
assert.equal(unverifiedDb.stagingRows.length, 0);

const db = new ImportRouteDB();
const staged = await worker.fetch(request("/api/admin/universities/import/stage", { body: { manifest } }), env(db));
assert.equal(staged.status, 202);
const stagedBody = await staged.json();
assert.equal(stagedBody.stagedCount, 1);
assert.equal(db.importRow.status, "validated");
assert.equal(db.stagingRows.length, 1);
assert.equal(db.auditRows.length, 1);
assert.equal(db.auditRows[0][3], "admin.university_catalog.stage_requested");
assert.deepEqual(JSON.parse(db.auditRows[0][6]), {
  datasetVersion: manifest.dataset_version,
  checksumSha256: manifest.checksum_sha256,
  manifestSha256: manifest.manifest_sha256,
  recordCount: 1
});

const noConfirmation = await worker.fetch(request("/api/admin/universities/import/finalize", {
  body: { datasetVersion: manifest.dataset_version, manifestSha256: manifest.manifest_sha256 }
}), env(db));
assert.equal(noConfirmation.status, 400);
assert.equal(db.importRow.status, "validated");

const finalized = await worker.fetch(request("/api/admin/universities/import/finalize", {
  body: {
    datasetVersion: manifest.dataset_version,
    manifestSha256: manifest.manifest_sha256,
    confirmManifestSha256: manifest.manifest_sha256
  }
}), env(db));
assert.equal(finalized.status, 200);
assert.equal((await finalized.json()).record_count, 1);
assert.equal(db.importRow.status, "applied");
assert.equal(db.stagingRows.length, 0);
const finalBatch = db.batches.at(-1);
assert.equal(finalBatch.length, 13);
assert.ok(finalBatch.every(statement => !/\\b(?:FROM|INTO|UPDATE|DELETE FROM)\\s+(?:users|teams)\\b/i.test(statement.sql)));

const replay = await worker.fetch(request("/api/admin/universities/import/finalize", {
  body: {
    datasetVersion: manifest.dataset_version,
    manifestSha256: manifest.manifest_sha256,
    confirmManifestSha256: manifest.manifest_sha256
  }
}), env(db));
assert.equal(replay.status, 200);
assert.equal((await replay.json()).alreadyApplied, true);

const linkSnapshot = makeSnapshot([{
  id: "legacy-by-code",
  catalog_id: null,
  catalog_normalized_name: null,
  official_school_code: record.official_school_code,
  category: "mainland",
  canonical_name: "旧记录大学",
  normalized_name: "旧记录大学",
  country_code: "CN"
}]);
const linkManifest = await makeManifest(linkSnapshot);
const linkDb = new ImportRouteDB({ universities: [{
  id: "legacy-by-code",
  catalog_id: null,
  catalog_normalized_name: null,
  official_school_code: record.official_school_code,
  category: "mainland",
  country_code: "CN"
}] });
const linkCheck = await revalidateCatalogImportTargets(linkDb, linkManifest);
assert.equal(linkCheck.checked_count, 1);

console.log("university-catalog-admin-import-smoke: all assertions passed");

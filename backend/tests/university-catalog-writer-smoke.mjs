import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { planCatalogImport } from "../../scripts/plan-university-catalog-import.mjs";
import {
  buildCatalogImportManifest,
  stageCatalogImport,
  finalizeCatalogImport
} from "../src/university-catalog-import.js";

const baseRecord = {
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
    supports_fields: ["name_zh", "location"]
  }],
  verification: {
    status: "needs_review",
    verified_at: null,
    verified_fields: [],
    notes: "fixture"
  },
  status: "active",
  merged_into: null
};

function catalog(universities = [], datasetVersion = "2026-11-23") {
  return {
    schema_version: "1.0.0",
    dataset_version: datasetVersion,
    generated_at: null,
    universities
  };
}

function snapshot(universities = [], imports = []) {
  return { schema_version: "1.0.0", exported_at: null, universities, imports };
}

function makePlan(input, existing = [], imports = [], sourceText = JSON.stringify(input)) {
  return planCatalogImport(input, snapshot(existing, imports), sourceText);
}

function existingRow(overrides = {}) {
  return {
    id: "legacy-university-1",
    catalog_id: null,
    catalog_normalized_name: null,
    official_school_code: null,
    category: "mainland",
    canonical_name: "旧记录大学",
    normalized_name: "mainland:旧记录大学",
    country_code: "CN",
    ...overrides
  };
}

class FakeD1 {
  constructor() {
    this.importRow = null;
    this.stagingRows = [];
    this.batches = [];
    this.failFinalize = false;
  }

  prepare(sql) {
    const db = this;
    return {
      bind(...values) {
        return {
          sql,
          values,
          run: () => db.run(sql, values),
          first: () => db.first(sql, values),
          all: () => db.all(sql, values)
        };
      }
    };
  }

  async run(sql, values) {
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
    throw new Error("unexpected FakeD1 run: " + sql);
  }

  async first(sql, values) {
    if (sql.includes("FROM university_catalog_imports")) return this.importRow;
    throw new Error("unexpected FakeD1 first: " + sql);
  }

  async all(sql, values) {
    if (sql.includes("FROM university_catalog_import_staging")) {
      const version = values[0];
      const wanted = new Set(values.slice(1));
      return {
        results: this.stagingRows.filter(row =>
          row.dataset_version === version && (!wanted.size || wanted.has(row.catalog_id))
        )
      };
    }
    throw new Error("unexpected FakeD1 all: " + sql);
  }

  async batch(statements) {
    this.batches.push(statements);
    if (statements[0].sql.startsWith("INSERT INTO university_catalog_import_staging")) {
      for (const statement of statements) {
        const values = statement.values;
        if (!this.stagingRows.some(row =>
          row.dataset_version === values[0] && row.catalog_id === values[2]
        )) {
          this.stagingRows.push({
            dataset_version: values[0],
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
    if (this.failFinalize) throw new Error("simulated D1 batch failure");
    this.importRow.status = "applied";
    this.stagingRows = this.stagingRows.filter(row =>
      row.dataset_version !== this.importRow.dataset_version
    );
    return statements.map((statement, index) => ({
      meta: { changes: index === 10 ? 1 : 0 }
    }));
  }
}

const input = catalog([baseRecord]);
const raw = JSON.stringify(input);
const plan = makePlan(input, [], [], raw);
const manifest = await buildCatalogImportManifest(input, plan, raw);
assert.equal(manifest.record_count, 1);
assert.equal(manifest.records[0].action, "insert");
assert.equal(manifest.records[0].target_university_id, baseRecord.id);
assert.equal(manifest.records[0].payload_sha256.length, 64);
const payload = JSON.parse(manifest.records[0].payload_json);
assert.equal(payload.catalog_normalized_name, "mainland:CN:示例大学");
assert.equal(payload.aliases[0].normalized_alias, "示例大");
assert.ok(payload.tags.some(tag => tag.tag_group === "project" && tag.tag_code === "project_985_legacy"));
assert.equal(payload.tags.find(tag => tag.tag_group === "degree_level").tag_code, "undergraduate");

await assert.rejects(
  () => buildCatalogImportManifest(input, plan, raw + " "),
  /source_checksum_mismatch/
);
const conflictPlan = {
  ...plan,
  items: plan.items.map(item => ({ ...item, action: "manual_review" }))
};
await assert.rejects(
  () => buildCatalogImportManifest(input, conflictPlan, raw),
  /requires_manual_review/
);
const duplicateTargetPlan = {
  ...plan,
  items: plan.items.map(item => ({ ...item, target_university_id: "same-target" }))
};
await assert.rejects(
  () => buildCatalogImportManifest(input, duplicateTargetPlan, raw),
  /insert_id_mismatch|target_not_unique/
);

const existing = existingRow({
  id: "legacy-by-code",
  official_school_code: baseRecord.official_school_code
});
const linkedPlan = makePlan(input, [existing], [], raw);
const linkedManifest = await buildCatalogImportManifest(input, linkedPlan, raw);
assert.equal(linkedManifest.records[0].action, "link_existing");
assert.equal(linkedManifest.records[0].target_university_id, "legacy-by-code");

const exactExisting = existingRow({
  id: "catalog-existing",
  catalog_id: baseRecord.id,
  catalog_normalized_name: "mainland:CN:示例大学",
  official_school_code: baseRecord.official_school_code,
  canonical_name: baseRecord.name_zh
});
const updatePlan = makePlan(input, [exactExisting], [], raw);
const updateManifest = await buildCatalogImportManifest(input, updatePlan, raw);
assert.equal(updateManifest.records[0].action, "update");

const appliedChecksum = createHash("sha256").update(raw, "utf8").digest("hex");
const appliedPlan = makePlan(input, [exactExisting], [{
  dataset_version: input.dataset_version,
  checksum_sha256: appliedChecksum,
  record_count: 1,
  status: "applied"
}], raw);
const alreadyApplied = await buildCatalogImportManifest(input, appliedPlan, raw);
assert.equal(alreadyApplied.already_applied, true);
assert.deepEqual(await stageCatalogImport(new FakeD1(), alreadyApplied), { already_applied: true, staged_count: 0 });
assert.deepEqual(await finalizeCatalogImport(new FakeD1(), alreadyApplied, "admin-owner"), { already_applied: true });
await assert.rejects(
  () => buildCatalogImportManifest(catalog([]), makePlan(catalog([]), [], [], JSON.stringify(catalog([]))), JSON.stringify(catalog([]))),
  /catalog_invalid/
);

const db = new FakeD1();
const staged = await stageCatalogImport(db, manifest, { chunkSize: 1 });
assert.deepEqual(staged, { already_applied: false, staged_count: 1 });
assert.equal(db.importRow.status, "validated");
assert.equal(db.stagingRows.length, 1);
assert.equal(db.batches[0].length, 1);
await stageCatalogImport(db, manifest, { chunkSize: 1 });
assert.equal(db.stagingRows.length, 1, "replaying the same stage chunk is idempotent");

const finalized = await finalizeCatalogImport(db, manifest, "admin-owner");
assert.equal(finalized.inserted_count, 1);
assert.equal(finalized.updated_count, 0);
assert.equal(db.importRow.status, "applied");
assert.equal(db.stagingRows.length, 0);
const finalBatch = db.batches.at(-1);
assert.equal(finalBatch.length, 13);
assert.ok(finalBatch.some(statement => statement.sql.includes("INSERT INTO universities")));
assert.ok(finalBatch.some(statement => statement.sql.includes("UPDATE universities AS u")));
assert.ok(finalBatch.some(statement => statement.sql.includes("INSERT INTO university_campuses")));
assert.ok(finalBatch.some(statement => statement.sql.includes("INSERT INTO university_sources")));
assert.ok(finalBatch.every(statement => !/\b(?:FROM|INTO|UPDATE|DELETE FROM)\s+(?:users|teams)\b/i.test(statement.sql)));
assert.ok(finalBatch.every(statement => !/phone|otp_challenges|sessions/i.test(statement.sql)));
assert.deepEqual(await finalizeCatalogImport(db, manifest, "admin-owner"), { already_applied: true });

const failingDb = new FakeD1();
await stageCatalogImport(failingDb, manifest);
failingDb.failFinalize = true;
await assert.rejects(() => finalizeCatalogImport(failingDb, manifest, "admin-owner"), /simulated D1 batch failure/);
assert.equal(failingDb.importRow.status, "validated");
assert.equal(failingDb.stagingRows.length, 1, "failed final batch must leave only retryable staging rows");

const incompleteDb = new FakeD1();
await stageCatalogImport(incompleteDb, manifest);
incompleteDb.stagingRows = [];
await assert.rejects(
  () => finalizeCatalogImport(incompleteDb, manifest, "admin-owner"),
  /staging_incomplete/
);

const tamperedStageDb = new FakeD1();
await stageCatalogImport(tamperedStageDb, manifest);
tamperedStageDb.stagingRows[0].payload_json = "{}";
await assert.rejects(
  () => finalizeCatalogImport(tamperedStageDb, manifest, "admin-owner"),
  /staging_payload_tampered/
);

const badPayloadManifest = {
  ...manifest,
  records: manifest.records.map(item => ({ ...item, payload_json: item.payload_json + " " }))
};
await assert.rejects(
  () => stageCatalogImport(new FakeD1(), badPayloadManifest),
  /payload_checksum_mismatch/
);

console.log("university-catalog-writer-smoke: all assertions passed");

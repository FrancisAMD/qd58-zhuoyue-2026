import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { planCatalogImport } from "../../scripts/plan-university-catalog-import.mjs";

const baseRecord = {
  id: "mainland:CN-10001",
  official_school_code: "10001",
  name_zh: "示例大学",
  name_en: null,
  aliases: [],
  category: "mainland",
  degree_levels: ["undergraduate"],
  ownership: "public",
  school_type_tags: ["comprehensive"],
  project_tags: [],
  double_first_class_disciplines: [],
  location: {
    country_code: "CN",
    country_name_zh: "中国",
    country_name_en: "China",
    province_code: "CN-37",
    province_name_zh: "山东省",
    city_name_zh: "青岛市"
  },
  campus_structure: "unknown",
  has_branch_campus: null,
  campus_info_status: "unknown",
  campuses: [],
  source_records: [],
  verification: { status: "draft", verified_at: null, verified_fields: [], notes: "fixture" },
  status: "active",
  merged_into: null
};

function catalog(universities = [], datasetVersion = "2026-11-21") {
  return { schema_version: "1.0.0", dataset_version: datasetVersion, generated_at: null, universities };
}

function row(overrides = {}) {
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

function snapshot(universities = [], imports = []) {
  return { schema_version: "1.0.0", exported_at: null, universities, imports };
}

function plan(records, existing = [], imports = [], sourceText = null) {
  const input = catalog(records);
  return planCatalogImport(input, snapshot(existing, imports), sourceText ?? JSON.stringify(input));
}

const emptyPlan = plan([baseRecord]);
assert.equal(emptyPlan.counts.insert, 1);
assert.equal(emptyPlan.items[0].target_university_id, baseRecord.id);
assert.equal(emptyPlan.writes_performed, false);
assert.equal(emptyPlan.safety.user_rows_modified, 0);
assert.equal(emptyPlan.safety.team_rows_modified, 0);

const exactId = plan([baseRecord], [row({
  id: "stable-existing-id",
  catalog_id: baseRecord.id,
  category: "mainland",
  official_school_code: baseRecord.official_school_code,
  catalog_normalized_name: "mainland:CN:示例大学",
  canonical_name: "示例大学"
})]);
assert.equal(exactId.counts.update, 1);
assert.equal(exactId.items[0].target_university_id, "stable-existing-id");

const codeLink = plan([baseRecord], [row({
  id: "legacy-by-code",
  official_school_code: baseRecord.official_school_code
})]);
assert.equal(codeLink.counts.link_existing, 1);
assert.equal(codeLink.items[0].target_university_id, "legacy-by-code");

const normalizedLink = plan([baseRecord], [row({
  id: "legacy-by-catalog-name",
  catalog_normalized_name: "mainland:CN:示例大学"
})]);
assert.equal(normalizedLink.counts.link_existing, 1);

const splitMatch = plan([baseRecord], [
  row({ id: "code-row", official_school_code: baseRecord.official_school_code }),
  row({ id: "name-row", catalog_normalized_name: "mainland:CN:示例大学" })
]);
assert.equal(splitMatch.counts.conflict, 1);
assert.equal(splitMatch.requires_manual_review, true);

const legacyNameReview = plan([baseRecord], [
  row({ id: "legacy-name-only", canonical_name: "示例大学" })
]);
assert.equal(legacyNameReview.counts.manual_review, 1);
assert.equal(legacyNameReview.items[0].target_university_id, "legacy-name-only");

const input = catalog([baseRecord]);
const raw = JSON.stringify(input);
const exactChecksum = createHash("sha256").update(raw, "utf8").digest("hex");
const mismatchReplay = planCatalogImport(input, snapshot([], [{
  dataset_version: input.dataset_version,
  checksum_sha256: "b".repeat(64),
  record_count: 1,
  status: "applied"
}]), raw);
assert.equal(mismatchReplay.counts.conflict, 1);
assert.match(mismatchReplay.items[0].reason, /必须提升 dataset_version/);

const appliedReplay = planCatalogImport(input, snapshot([], [{
  dataset_version: input.dataset_version,
  checksum_sha256: exactChecksum,
  status: "applied"
}]), raw);
assert.equal(appliedReplay.counts.skip, 1);
assert.equal(appliedReplay.items[0].match_by, "import_batch");

const appliedCountMismatch = planCatalogImport(input, snapshot([], [{
  dataset_version: input.dataset_version,
  checksum_sha256: exactChecksum,
  record_count: 2,
  status: "applied"
}]), raw);
assert.equal(appliedCountMismatch.counts.conflict, 1);
assert.match(appliedCountMismatch.items[0].reason, /record_count/);
const badSnapshot = snapshot([{ ...row(), phone: "must-not-be-exported" }]);
assert.throws(() => planCatalogImport(input, badSnapshot, raw), /禁止导出个人信息/);

const duplicateSnapshot = snapshot([
  row({ id: "duplicate-a", official_school_code: "10001" }),
  row({ id: "duplicate-b", official_school_code: "10001" })
]);
assert.throws(() => planCatalogImport(input, duplicateSnapshot, raw), /重复唯一值/);

const invalidCatalog = catalog([{ ...baseRecord, id: "bad-id" }]);
assert.throws(() => planCatalogImport(invalidCatalog, snapshot(), JSON.stringify(invalidCatalog)), /高校目录校验失败/);

const mergedSource = {
  ...baseRecord,
  id: "mainland:CN-10002",
  official_school_code: "10002",
  name_zh: "待合并大学",
  status: "merged",
  merged_into: baseRecord.id
};
const mergedPlan = plan([baseRecord, mergedSource], [row({
  id: "existing-target",
  catalog_id: baseRecord.id,
  category: "mainland",
  official_school_code: baseRecord.official_school_code,
  catalog_normalized_name: "mainland:CN:示例大学",
  canonical_name: "示例大学"
})]);
assert.equal(mergedPlan.items.find(item => item.catalog_id === mergedSource.id).merged_into_university_id, "existing-target");

console.log("university-catalog-import-plan-smoke: all assertions passed");

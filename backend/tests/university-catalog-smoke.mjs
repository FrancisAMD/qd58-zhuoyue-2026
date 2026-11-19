import assert from "node:assert/strict";
import { normalizeUniversityName, validateCatalog } from "../../scripts/validate-university-catalog.mjs";

const mainlandLocation = {
  country_code: "CN",
  country_name_zh: "中国",
  country_name_en: "China",
  province_code: "CN-37",
  province_name_zh: "山东省",
  city_name_zh: "青岛市"
};

const mainland = {
  id: "mainland:CN-10001",
  official_school_code: "10001",
  name_zh: "示例大学",
  name_en: null,
  aliases: ["示例大"],
  category: "mainland",
  degree_levels: ["undergraduate"],
  ownership: "public",
  school_type_tags: ["comprehensive"],
  project_tags: [],
  double_first_class_disciplines: [],
  location: mainlandLocation,
  campus_structure: "single",
  campus_info_status: "complete",
  campuses: [{
    id: "main",
    name_zh: "主校区",
    name_en: null,
    is_main_campus: true,
    location: mainlandLocation
  }],
  source_records: [],
  verification: {
    status: "draft",
    verified_at: null,
    verified_fields: [],
    notes: "测试数据"
  },
  status: "active",
  merged_into: null
};

const hmt = {
  ...mainland,
  id: "hmt:HK:sample",
  official_school_code: null,
  name_zh: "样例香港大学",
  aliases: [],
  category: "hmt",
  project_tags: [],
  location: {
    country_code: "HK",
    country_name_zh: "中国香港",
    country_name_en: "Hong Kong",
    province_code: null,
    province_name_zh: null,
    city_name_zh: null
  },
  campus_structure: "unknown",
  campus_info_status: "not_collected",
  campuses: []
};

const overseas = {
  ...mainland,
  id: "overseas:JP:sample",
  official_school_code: null,
  name_zh: "样例日本大学",
  aliases: [],
  category: "overseas",
  project_tags: [],
  location: {
    country_code: "JP",
    country_name_zh: "日本",
    country_name_en: "Japan",
    province_code: null,
    province_name_zh: null,
    city_name_zh: null
  },
  campus_structure: "unknown",
  campus_info_status: "unknown",
  campuses: []
};

const base = {
  schema_version: "1.0.0",
  dataset_version: "2026-11-19",
  generated_at: null,
  universities: []
};

function assertInvalid(catalog, expectedMessage) {
  const result = validateCatalog(catalog);
  assert.equal(result.valid, false, "expected catalog to be rejected");
  if (expectedMessage) {
    assert.ok(result.errors.some(error => error.includes(expectedMessage)), result.errors.join("\n"));
  }
}

assert.equal(normalizeUniversityName(" 青岛-大学 "), "青岛大学");
assert.equal(validateCatalog(base).valid, true, "empty template should be valid");
const validCategories = validateCatalog({ ...base, universities: [mainland, hmt, overseas] });
if (!validCategories.valid) console.error(validCategories.errors);
assert.equal(validCategories.valid, true, "one valid record per category should pass");

assertInvalid({ ...base, universities: [mainland, { ...mainland, official_school_code: null }] }, "重复 ID");
assertInvalid({ ...base, universities: [mainland, { ...mainland, id: "mainland:CN-10002", official_school_code: null, name_zh: "示例-大学" }] }, "重复规范化名称");
assertInvalid({ ...base, universities: [{ ...mainland, degree_levels: ["postgraduate"] }] }, "必须包含 undergraduate");
assertInvalid({ ...base, universities: [{ ...overseas, location: { ...overseas.location, city_name_zh: "东京" } }] }, "海外高校地域只精确到国家");
assertInvalid({ ...base, universities: [{ ...hmt, project_tags: ["project_985_legacy"] }] }, "港澳台和海外高校不得使用");
assertInvalid({ ...base, universities: [{ ...mainland, verification: { status: "verified", verified_at: "2026-11-19T00:00:00Z", verified_fields: ["name_zh"], notes: "" } }] }, "必须有政府、教育主管部门或高校官方来源");
assertInvalid({ ...base, universities: [{ ...mainland, campus_structure: "multiple" }] }, "multiple 且 complete 时至少需要两个校区");
assertInvalid({ ...base, universities: [{ ...mainland, status: "merged", merged_into: "mainland:CN-missing" }] }, "目标记录不存在");
assertInvalid({ ...base, universities: [{ ...mainland, unexpected_sensitive_field: "should not be here" }] }, "未定义字段");

console.log("university-catalog-smoke: all assertions passed");

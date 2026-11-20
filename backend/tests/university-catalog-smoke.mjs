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
  has_branch_campus: false,
  campus_info_status: "complete",
  campuses: [{
    id: "main",
    name_zh: "主校区",
    name_en: null,
    is_main_campus: true,
    is_branch_campus: false,
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
  has_branch_campus: null,
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
  has_branch_campus: null,
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
const verifiedMainland = {
  ...mainland,
  source_records: [{
    source_type: "education_authority",
    publisher: "示例教育主管部门",
    title: "示例高校名录",
    url: "https://example.edu.cn/universities",
    accessed_at: "2026-11-20",
    supports_fields: ["official_school_code", "name_zh", "category", "degree_levels", "location", "campuses", "campus_structure", "has_branch_campus"]
  }],
  verification: {
    status: "verified",
    verified_at: "2026-11-20T00:00:00Z",
    verified_fields: ["official_school_code", "name_zh", "category", "degree_levels", "location", "campuses", "campus_structure", "has_branch_campus"],
    notes: "仅用于校验器测试"
  }
};
assert.equal(validateCatalog({ ...base, universities: [verifiedMainland] }).valid, true,
  "verified records must pass when official sources cover every verified and required field");
const branched = {
  ...mainland,
  id: "mainland:CN-10003",
  official_school_code: "10003",
  name_zh: "示例分校大学",
  campus_structure: "multiple",
  has_branch_campus: true,
  campuses: [
    { ...mainland.campuses[0], id: "main", is_main_campus: true, is_branch_campus: false },
    { ...mainland.campuses[0], id: "branch", name_zh: "分校区", is_main_campus: false, is_branch_campus: true }
  ]
};
assert.equal(validateCatalog({ ...base, universities: [branched] }).valid, true, "explicit branch campus should pass");
assertInvalid({ ...base, universities: [{ ...mainland, has_branch_campus: false, campus_info_status: "partial" }] }, "只有完整核实校区清单后才能确认没有分校");


assertInvalid({ ...base, universities: [mainland, { ...mainland, official_school_code: null }] }, "重复 ID");
assertInvalid({ ...base, universities: [mainland, { ...mainland, id: "mainland:CN-10002", official_school_code: null, name_zh: "示例-大学" }] }, "重复规范化名称");
assertInvalid({ ...base, universities: [{ ...mainland, degree_levels: ["postgraduate"] }] }, "必须包含 undergraduate");
assertInvalid({ ...base, universities: [{ ...overseas, location: { ...overseas.location, city_name_zh: "东京" } }] }, "海外高校地域只精确到国家");
assertInvalid({ ...base, universities: [{ ...hmt, project_tags: ["project_985_legacy"] }] }, "港澳台和海外高校不得使用");
assertInvalid({ ...base, universities: [{ ...mainland, verification: { status: "verified", verified_at: "2026-11-19T00:00:00Z", verified_fields: ["name_zh"], notes: "" } }] }, "必须有政府、教育主管部门或高校官方来源");
assertInvalid({ ...base, universities: [{ ...mainland, campus_structure: "multiple" }] }, "multiple 且 complete 时至少需要两个校区");
assertInvalid({ ...base, universities: [{ ...mainland, status: "merged", merged_into: "mainland:CN-missing" }] }, "目标记录不存在");
assertInvalid({ ...base, universities: [{ ...mainland, unexpected_sensitive_field: "should not be here" }] }, "未定义字段");

assertInvalid({ ...base, universities: [{ ...mainland, id: "hmt:MO:wrong-prefix", category: "hmt", location: { ...mainlandLocation, country_code: "HK", province_code: null, province_name_zh: null, city_name_zh: null }, campus_structure: "unknown", has_branch_campus: null, campus_info_status: "not_collected", campuses: [] }] }, "hmt 高校 ID 必须与 HK/MO/TW 地区代码一致");
assertInvalid({ ...base, universities: [{ ...mainland, source_records: [{ source_type: "institution", publisher: "学校官网", title: "学校简介", url: "https://example.edu.cn", accessed_at: "2026-11-20", supports_fields: ["not_a_catalog_field"] }] }] }, "不支持的值 not_a_catalog_field");
assertInvalid({ ...base, universities: [{ ...mainland, source_records: [{ source_type: "institution", publisher: "学校官网", title: "学校简介", url: "https://user:secret@example.edu.cn", accessed_at: "2026-11-20", supports_fields: ["name_zh"] }] }] }, "来源链接不能包含用户名或密码");
assertInvalid({ ...base, universities: [{ ...verifiedMainland, source_records: [{ ...verifiedMainland.source_records[0], supports_fields: ["name_zh", "category"] }] }] }, "官方来源未覆盖");
assertInvalid({ ...base, universities: [{ ...verifiedMainland, verification: { ...verifiedMainland.verification, verified_fields: ["name_zh", "category"] } }] }, "verified 缺少必需核验字段");
assertInvalid({ ...base, universities: [mainland, { ...mainland, id: "mainland:CN-10002", name_zh: "另一所示例大学" }] }, "重复学校代码");

console.log("university-catalog-smoke: all assertions passed");

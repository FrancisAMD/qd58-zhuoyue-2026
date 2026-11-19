import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CATEGORIES = new Set(["mainland", "hmt", "overseas"]);
const DEGREE_LEVELS = new Set(["undergraduate", "postgraduate", "doctoral", "other"]);
const OWNERSHIP = new Set(["public", "private", "cooperative", "other", "unknown"]);
const SCHOOL_TYPES = new Set(["comprehensive", "science_engineering", "normal", "agriculture_forestry", "medical", "finance_economics", "language", "law_politics", "sports", "arts", "ethnic", "military", "public_security", "vocational", "sino_foreign_cooperative", "religious", "other", "unknown"]);
const PROJECT_TAGS = new Set(["project_985_legacy", "project_211_legacy", "double_first_class_round1", "double_first_class_round2"]);
const SOURCE_TYPES = new Set(["government", "education_authority", "institution", "other"]);
const ROOT_KEYS = new Set(["$schema", "schema_version", "dataset_version", "generated_at", "universities"]);
const UNIVERSITY_KEYS = new Set(["id", "official_school_code", "name_zh", "name_en", "aliases", "category", "degree_levels", "ownership", "school_type_tags", "project_tags", "double_first_class_disciplines", "location", "campus_structure", "has_branch_campus", "campus_info_status", "campuses", "source_records", "verification", "status", "merged_into"]);
const LOCATION_KEYS = new Set(["country_code", "country_name_zh", "country_name_en", "province_code", "province_name_zh", "city_name_zh"]);
const CAMPUS_KEYS = new Set(["id", "name_zh", "name_en", "is_main_campus", "is_branch_campus", "location"]);
const SOURCE_KEYS = new Set(["source_type", "publisher", "title", "url", "accessed_at", "supports_fields"]);
const VERIFICATION_KEYS = new Set(["status", "verified_at", "verified_fields", "notes"]);

export function normalizeUniversityName(value) {
  return String(value ?? "").normalize("NFKC").toLocaleLowerCase("und").replace(/[\s\p{P}\p{S}]+/gu, "");
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validDateTime(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
}

function checkKeys(value, allowed, path, errors) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push(path + "." + key + ": 未定义字段");
  }
}

function checkStringArray(value, path, errors, allowed = null, minItems = 0) {
  if (!Array.isArray(value)) {
    errors.push(path + ": 必须是数组");
    return [];
  }
  if (value.length < minItems) errors.push(path + ": 至少需要 " + minItems + " 项");
  const seen = new Set();
  for (let i = 0; i < value.length; i += 1) {
    const item = value[i];
    if (!nonEmptyString(item)) {
      errors.push(path + "[" + i + "]: 必须是非空字符串");
      continue;
    }
    if (allowed && !allowed.has(item)) errors.push(path + "[" + i + "]: 不支持的值 " + item);
    if (seen.has(item)) errors.push(path + "[" + i + "]: 重复值 " + item);
    seen.add(item);
  }
  return value;
}

function checkLocation(location, category, path, errors) {
  if (!isObject(location)) {
    errors.push(path + ": 必须是对象");
    return;
  }
  checkKeys(location, LOCATION_KEYS, path, errors);
  if (!/^[A-Z]{2}$/.test(String(location.country_code ?? ""))) errors.push(path + ".country_code: 必须是大写 ISO alpha-2 代码");
  if (!nonEmptyString(location.country_name_zh)) errors.push(path + ".country_name_zh: 必填");
  if (!(location.country_name_en === null || nonEmptyString(location.country_name_en))) errors.push(path + ".country_name_en: 必须是非空字符串或 null");
  for (const key of ["province_code", "province_name_zh", "city_name_zh"]) {
    if (!(location[key] === null || nonEmptyString(location[key]))) errors.push(path + "." + key + ": 必须是非空字符串或 null");
  }

  if (category === "mainland") {
    if (location.country_code !== "CN") errors.push(path + ".country_code: 内地高校必须为 CN");
    if (!nonEmptyString(location.province_code) || !nonEmptyString(location.province_name_zh)) errors.push(path + ": 内地高校必须填写省代码和省名称");
  } else if (category === "hmt") {
    if (!["HK", "MO", "TW"].includes(location.country_code)) errors.push(path + ".country_code: 港澳台只能使用 HK、MO 或 TW");
    for (const key of ["province_code", "province_name_zh", "city_name_zh"]) {
      if (location[key] !== null) errors.push(path + "." + key + ": 港澳台目录只记录地区，不记录省市层级");
    }
  } else if (category === "overseas") {
    if (["CN", "HK", "MO", "TW"].includes(location.country_code)) errors.push(path + ".country_code: 海外高校不能使用 CN、HK、MO、TW");
    for (const key of ["province_code", "province_name_zh", "city_name_zh"]) {
      if (location[key] !== null) errors.push(path + "." + key + ": 海外高校地域只精确到国家");
    }
  }
}

function checkSource(source, path, errors) {
  if (!isObject(source)) {
    errors.push(path + ": 必须是对象");
    return;
  }
  checkKeys(source, SOURCE_KEYS, path, errors);
  if (!SOURCE_TYPES.has(source.source_type)) errors.push(path + ".source_type: 不支持的来源类型");
  for (const key of ["publisher", "title"]) if (!nonEmptyString(source[key])) errors.push(path + "." + key + ": 必填");
  try {
    const url = new URL(source.url);
    if (url.protocol !== "https:") errors.push(path + ".url: 来源链接必须使用 HTTPS");
  } catch {
    errors.push(path + ".url: 必须是有效的 HTTPS URL");
  }
  if (!validDate(source.accessed_at)) errors.push(path + ".accessed_at: 必须是有效的 YYYY-MM-DD 日期");
  checkStringArray(source.supports_fields, path + ".supports_fields", errors, null, 1);
}

function checkCampus(campus, category, path, errors) {
  if (!isObject(campus)) {
    errors.push(path + ": 必须是对象");
    return;
  }
  checkKeys(campus, CAMPUS_KEYS, path, errors);
  if (!/^[a-z0-9][a-z0-9._:-]{1,79}$/.test(String(campus.id ?? ""))) errors.push(path + ".id: 格式无效");
  if (!(nonEmptyString(campus.name_zh) || nonEmptyString(campus.name_en))) errors.push(path + ": name_zh 和 name_en 至少填写一个");
  if (typeof campus.is_main_campus !== "boolean") errors.push(path + ".is_main_campus: 必须是布尔值");
  if (!(typeof campus.is_branch_campus === "boolean" || campus.is_branch_campus === null)) errors.push(path + ".is_branch_campus: 必须是布尔值或 null");
  if (campus.is_main_campus === true && campus.is_branch_campus === true) errors.push(path + ": 主校区不能同时标记为分校");
  checkLocation(campus.location, category, path + ".location", errors);
}

function checkUniversity(university, index, errors, seen) {
  const path = "universities[" + index + "]";
  if (!isObject(university)) {
    errors.push(path + ": 必须是对象");
    return;
  }
  checkKeys(university, UNIVERSITY_KEYS, path, errors);

  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,119}$/.test(String(university.id ?? ""))) errors.push(path + ".id: 格式无效");
  if (seen.ids.has(university.id)) errors.push(path + ".id: 重复 ID " + university.id);
  seen.ids.add(university.id);

  if (university.official_school_code !== null && (!nonEmptyString(university.official_school_code) || !/^[A-Za-z0-9-]{2,32}$/.test(university.official_school_code))) {
    errors.push(path + ".official_school_code: 必须是 2-32 位字母、数字或连字符，或 null");
  } else if (university.official_school_code) {
    if (seen.codes.has(university.official_school_code)) errors.push(path + ".official_school_code: 重复学校代码");
    seen.codes.add(university.official_school_code);
  }

  if (!(nonEmptyString(university.name_zh) || nonEmptyString(university.name_en))) errors.push(path + ": name_zh 和 name_en 至少填写一个");
  for (const key of ["name_zh", "name_en"]) {
    if (!(university[key] === null || nonEmptyString(university[key]))) errors.push(path + "." + key + ": 必须是非空字符串或 null");
  }

  const aliases = checkStringArray(university.aliases, path + ".aliases", errors);
  const aliasKeys = aliases.map(normalizeUniversityName);
  if (new Set(aliasKeys).size !== aliasKeys.length) errors.push(path + ".aliases: 存在规范化后重复的别名");

  if (!CATEGORIES.has(university.category)) errors.push(path + ".category: 只能是 mainland、hmt 或 overseas");
  const category = CATEGORIES.has(university.category) ? university.category : "invalid";
  const degrees = checkStringArray(university.degree_levels, path + ".degree_levels", errors, DEGREE_LEVELS, 1);
  if (category === "mainland" && !degrees.includes("undergraduate")) errors.push(path + ".degree_levels: 内地目录只收本科高校，必须包含 undergraduate");
  if (!OWNERSHIP.has(university.ownership)) errors.push(path + ".ownership: 不支持的值");
  checkStringArray(university.school_type_tags, path + ".school_type_tags", errors, SCHOOL_TYPES);
  const projectTags = checkStringArray(university.project_tags, path + ".project_tags", errors, PROJECT_TAGS);
  const disciplines = checkStringArray(university.double_first_class_disciplines, path + ".double_first_class_disciplines", errors);
  if (category !== "mainland" && projectTags.length > 0) errors.push(path + ".project_tags: 港澳台和海外高校不得使用中国内地 985/211/双一流标签");
  if (disciplines.length > 0 && !projectTags.some(tag => tag.startsWith("double_first_class_"))) {
    errors.push(path + ".double_first_class_disciplines: 填写学科时必须具有对应双一流轮次标签");
  }

  checkLocation(university.location, category, path + ".location", errors);

  if (!["single", "multiple", "unknown"].includes(university.campus_structure)) errors.push(path + ".campus_structure: 不支持的值");
  if (!(typeof university.has_branch_campus === "boolean" || university.has_branch_campus === null)) errors.push(path + ".has_branch_campus: 必须是布尔值或 null");
  if (!["complete", "partial", "not_collected", "unknown"].includes(university.campus_info_status)) errors.push(path + ".campus_info_status: 不支持的值");
  if (!Array.isArray(university.campuses)) {
    errors.push(path + ".campuses: 必须是数组");
  } else {
    const campusIds = new Set();
    let mainCount = 0;
    university.campuses.forEach((campus, campusIndex) => {
      checkCampus(campus, category, path + ".campuses[" + campusIndex + "]", errors);
      if (isObject(campus)) {
        if (campusIds.has(campus.id)) errors.push(path + ".campuses[" + campusIndex + "].id: 重复校区 ID");
        campusIds.add(campus.id);
        if (campus.is_main_campus === true) mainCount += 1;
      }
    });
    if (university.campus_info_status === "not_collected" && university.campuses.length > 0) errors.push(path + ".campuses: not_collected 时必须为空数组");
    if (university.campus_info_status === "complete" && university.campuses.some(campus => !isObject(campus) || typeof campus.is_branch_campus !== "boolean")) errors.push(path + ".campuses: complete 时每个校区都必须核实是否为分校");
    if (university.has_branch_campus === false && university.campus_info_status !== "complete") errors.push(path + ".has_branch_campus: 只有完整核实校区清单后才能确认没有分校");
    if (university.has_branch_campus === true && !university.campuses.some(campus => isObject(campus) && campus.is_branch_campus === true)) errors.push(path + ".has_branch_campus: 标记有分校时至少需要一条分校记录");
    if (university.has_branch_campus === false && university.campuses.some(campus => isObject(campus) && campus.is_branch_campus === true)) errors.push(path + ".has_branch_campus: 与分校记录冲突");
    if (university.campus_info_status === "complete") {
      if (university.campuses.length === 0) errors.push(path + ".campuses: complete 时至少需要一个校区");
      if (mainCount !== 1) errors.push(path + ".campuses: complete 时必须且只能有一个主校区");
      if (university.campus_structure === "single" && university.campuses.length !== 1) errors.push(path + ".campuses: single 且 complete 时必须恰好一个校区");
      if (university.campus_structure === "multiple" && university.campuses.length < 2) errors.push(path + ".campuses: multiple 且 complete 时至少需要两个校区");
    } else if (mainCount > 1) {
      errors.push(path + ".campuses: 最多只能标记一个主校区");
    }
    if (university.campus_structure === "single" && university.campuses.length > 1) errors.push(path + ".campus_structure: single 不能包含多个校区");
  }

  if (!Array.isArray(university.source_records)) {
    errors.push(path + ".source_records: 必须是数组");
  } else {
    university.source_records.forEach((source, sourceIndex) => checkSource(source, path + ".source_records[" + sourceIndex + "]", errors));
  }

  const verification = university.verification;
  if (!isObject(verification)) {
    errors.push(path + ".verification: 必须是对象");
  } else {
    checkKeys(verification, VERIFICATION_KEYS, path + ".verification", errors);
    if (!["draft", "needs_review", "verified"].includes(verification.status)) errors.push(path + ".verification.status: 不支持的值");
    if (!(verification.verified_at === null || validDateTime(verification.verified_at))) errors.push(path + ".verification.verified_at: 必须是有效日期时间或 null");
    checkStringArray(verification.verified_fields, path + ".verification.verified_fields", errors);
    if (typeof verification.notes !== "string") errors.push(path + ".verification.notes: 必须是字符串");
    if (verification.status === "verified") {
      if (!validDateTime(verification.verified_at)) errors.push(path + ".verification: verified 必须填写 verified_at");
      if (!Array.isArray(verification.verified_fields) || verification.verified_fields.length === 0) errors.push(path + ".verification: verified 必须列出 verified_fields");
      const hasPrimarySource = Array.isArray(university.source_records) && university.source_records.some(source =>
        isObject(source) && ["government", "education_authority", "institution"].includes(source.source_type)
      );
      if (!hasPrimarySource) errors.push(path + ".verification: verified 必须有政府、教育主管部门或高校官方来源");
    }
  }

  if (!["active", "inactive", "merged"].includes(university.status)) errors.push(path + ".status: 不支持的值");
  if (university.status === "merged") {
    if (!nonEmptyString(university.merged_into) || university.merged_into === university.id) errors.push(path + ".merged_into: merged 记录必须指向另一条记录");
  } else if (university.merged_into !== null) {
    errors.push(path + ".merged_into: 非 merged 记录必须为 null");
  }

  const canonicalName = normalizeUniversityName(university.name_zh || university.name_en);
  if (category !== "invalid" && canonicalName) {
    const identity = category + ":" + (university.location?.country_code || "") + ":" + canonicalName;
    if (seen.names.has(identity)) errors.push(path + ": 同一分类和地区存在重复规范化名称");
    seen.names.add(identity);
  }
}

export function validateCatalog(catalog) {
  const errors = [];
  if (!isObject(catalog)) return { valid: false, errors: ["根节点必须是 JSON 对象"] };
  checkKeys(catalog, ROOT_KEYS, "$", errors);
  if (catalog.schema_version !== "1.0.0") errors.push("$.schema_version: 当前只支持 1.0.0");
  if (typeof catalog.dataset_version !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(catalog.dataset_version) || !validDate(catalog.dataset_version)) {
    errors.push("$.dataset_version: 必须是有效的 YYYY-MM-DD 日期");
  }
  if (!(catalog.generated_at === null || validDateTime(catalog.generated_at))) errors.push("$.generated_at: 必须是有效日期时间或 null");
  if (!Array.isArray(catalog.universities)) {
    errors.push("$.universities: 必须是数组");
  } else {
    const seen = { ids: new Set(), codes: new Set(), names: new Set() };
    catalog.universities.forEach((university, index) => checkUniversity(university, index, errors, seen));
    for (let i = 0; i < catalog.universities.length; i += 1) {
      const university = catalog.universities[i];
      if (isObject(university) && university.status === "merged" &&
          !catalog.universities.some(candidate => isObject(candidate) && candidate.id === university.merged_into)) {
        errors.push("universities[" + i + "].merged_into: 目标记录不存在");
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

function runCli() {
  const file = resolve(process.argv[2] || "data/university-catalog.json");
  let catalog;
  try {
    catalog = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    console.error("无法读取或解析 " + file + ": " + error.message);
    process.exitCode = 1;
    return;
  }
  const result = validateCatalog(catalog);
  if (!result.valid) {
    console.error("高校目录校验失败（" + result.errors.length + " 项）：");
    for (const error of result.errors) console.error("- " + error);
    process.exitCode = 1;
    return;
  }
  console.log("高校目录校验通过：" + catalog.universities.length + " 条记录，schema_version=" + catalog.schema_version + "，dataset_version=" + catalog.dataset_version);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runCli();

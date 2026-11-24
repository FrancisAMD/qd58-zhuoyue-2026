const encoder = new TextEncoder();
const STAGE_CHUNK_SIZE = 20;
const STAGE_ACTIONS = new Set(["insert", "update", "link_existing"]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeUniversityName(value) {
  return String(value ?? "").normalize("NFKC").toLocaleLowerCase("und")
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(String(value)));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function manifestDigest(datasetVersion, records) {
  const rows = records.map(record => record.catalog_id + ":" + record.payload_sha256)
    .sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  return sha256Hex(datasetVersion + "\n" + rows.join("\n") + "\n");
}

function buildTags(record) {
  const tags = [];
  for (const code of record.degree_levels || []) tags.push({ tag_group: "degree_level", tag_code: code });
  for (const code of record.school_type_tags || []) tags.push({ tag_group: "school_type", tag_code: code });
  for (const code of record.project_tags || []) tags.push({ tag_group: "project", tag_code: code });
  for (const code of record.double_first_class_disciplines || []) {
    tags.push({ tag_group: "double_first_class_discipline", tag_code: code });
  }
  return tags.sort((a, b) => {
    const left = a.tag_group + ":" + a.tag_code;
    const right = b.tag_group + ":" + b.tag_code;
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

function preparePayload(record, planItem) {
  if (!isObject(record) || !isObject(record.location) || !isObject(planItem)) {
    throw new Error("catalog_import_record_invalid");
  }
  if (!STAGE_ACTIONS.has(planItem.action)) throw new Error("catalog_import_plan_not_applicable");
  if (planItem.catalog_id !== record.id) throw new Error("catalog_import_plan_identity_mismatch");
  if (typeof planItem.target_university_id !== "string" || !planItem.target_university_id.trim()) {
    throw new Error("catalog_import_target_missing");
  }
  if (planItem.action === "insert" && planItem.target_university_id !== record.id) {
    throw new Error("catalog_import_insert_id_mismatch");
  }
  const canonicalName = record.name_zh || record.name_en;
  if (typeof canonicalName !== "string" || !canonicalName.trim()) throw new Error("catalog_import_name_missing");
  const countryCode = record.location.country_code;
  if (typeof countryCode !== "string" || !/^[A-Z]{2}$/.test(countryCode)) {
    throw new Error("catalog_import_country_invalid");
  }
  const normalizedName = normalizeUniversityName(canonicalName);
  if (!normalizedName) throw new Error("catalog_import_normalized_name_empty");
  const catalogNormalizedName = record.category + ":" + countryCode + ":" + normalizedName;
  const aliases = (record.aliases || []).map(alias => ({
    alias,
    normalized_alias: normalizeUniversityName(alias)
  })).sort((a, b) => a.normalized_alias < b.normalized_alias ? -1 : a.normalized_alias > b.normalized_alias ? 1 : 0);
  if (aliases.some(alias => !alias.normalized_alias)) throw new Error("catalog_import_alias_invalid");
  let mergedIntoUniversityId = null;
  if (record.status === "merged") {
    if (typeof planItem.merged_into_university_id !== "string" ||
        !planItem.merged_into_university_id.trim() ||
        planItem.merged_into_university_id === planItem.target_university_id) {
      throw new Error("catalog_import_merge_target_unresolved");
    }
    mergedIntoUniversityId = planItem.merged_into_university_id;
  } else if (planItem.merged_into_university_id) {
    throw new Error("catalog_import_unexpected_merge_target");
  }
  return {
    target_university_id: planItem.target_university_id,
    catalog_normalized_name: catalogNormalizedName,
    merged_into_university_id: mergedIntoUniversityId,
    record,
    aliases,
    tags: buildTags(record)
  };
}

export async function buildCatalogImportManifest(catalog, plan, catalogText) {
  if (!isObject(catalog) || !Array.isArray(catalog.universities) ||
      typeof catalog.dataset_version !== "string" || catalog.universities.length < 1) {
    throw new Error("catalog_import_catalog_invalid");
  }
  if (!isObject(plan) || plan.plan_version !== "1.0.0" || plan.mode !== "dry-run" ||
      plan.writes_performed !== false || plan.dataset_version !== catalog.dataset_version ||
      !Array.isArray(plan.items) || typeof plan.checksum_sha256 !== "string") {
    throw new Error("catalog_import_plan_invalid");
  }
  if (typeof catalogText !== "string") throw new Error("catalog_import_source_text_required");
  const checksum = await sha256Hex(catalogText);
  if (checksum !== plan.checksum_sha256) throw new Error("catalog_import_source_checksum_mismatch");
  if (plan.items.length !== catalog.universities.length) throw new Error("catalog_import_plan_count_mismatch");

  const planById = new Map();
  for (const item of plan.items) {
    if (!isObject(item) || typeof item.catalog_id !== "string" || planById.has(item.catalog_id)) {
      throw new Error("catalog_import_plan_duplicate_or_invalid_id");
    }
    planById.set(item.catalog_id, item);
  }
  const skipCount = plan.items.filter(item => item.action === "skip").length;
  if (skipCount === plan.items.length && skipCount > 0) {
    return {
      manifest_version: "1.0.0",
      already_applied: true,
      dataset_version: catalog.dataset_version,
      checksum_sha256: checksum,
      manifest_sha256: null,
      record_count: catalog.universities.length,
      records: []
    };
  }
  if (skipCount > 0 || plan.items.some(item => item.action === "manual_review" || item.action === "conflict")) {
    throw new Error("catalog_import_plan_requires_manual_review");
  }

  const targetIds = new Set();
  const records = [];
  for (const university of catalog.universities) {
    const item = planById.get(university.id);
    if (!item) throw new Error("catalog_import_plan_record_missing");
    if (targetIds.has(item.target_university_id)) throw new Error("catalog_import_target_not_unique");
    targetIds.add(item.target_university_id);
    if (university.status === "merged") {
      const mergeTarget = planById.get(university.merged_into);
      if (!mergeTarget || mergeTarget.target_university_id !== item.merged_into_university_id) {
        throw new Error("catalog_import_merge_target_mismatch");
      }
    }
    const payload = preparePayload(university, item);
    const payloadJson = JSON.stringify(payload);
    if (encoder.encode(payloadJson).byteLength > 1900000) throw new Error("catalog_import_record_too_large");
    records.push({
      catalog_id: university.id,
      target_university_id: item.target_university_id,
      action: item.action,
      payload_json: payloadJson,
      payload_sha256: await sha256Hex(payloadJson)
    });
  }
  const digest = await manifestDigest(catalog.dataset_version, records);
  return {
    manifest_version: "1.0.0",
    already_applied: false,
    dataset_version: catalog.dataset_version,
    checksum_sha256: checksum,
    manifest_sha256: digest,
    record_count: records.length,
    records
  };
}

async function validateManifest(manifest) {
  if (!isObject(manifest) || manifest.manifest_version !== "1.0.0" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(String(manifest.dataset_version || "")) ||
      !/^[0-9a-f]{64}$/.test(String(manifest.checksum_sha256 || "")) ||
      !Array.isArray(manifest.records) || !Number.isInteger(manifest.record_count) ||
      manifest.record_count < 1) {
    throw new Error("catalog_import_manifest_invalid");
  }
  if (manifest.already_applied === true) {
    if (manifest.records.length !== 0 || manifest.manifest_sha256 !== null) {
      throw new Error("catalog_import_applied_manifest_invalid");
    }
    return;
  }
  if (manifest.already_applied !== false ||
      manifest.record_count !== manifest.records.length ||
      !/^[0-9a-f]{64}$/.test(String(manifest.manifest_sha256 || ""))) {
    throw new Error("catalog_import_manifest_invalid");
  }
  const ids = new Set();
  const targets = new Set();
  for (const item of manifest.records) {
    if (!isObject(item) || typeof item.catalog_id !== "string" ||
        typeof item.target_university_id !== "string" || !STAGE_ACTIONS.has(item.action) ||
        typeof item.payload_json !== "string" || !/^[0-9a-f]{64}$/.test(String(item.payload_sha256 || ""))) {
      throw new Error("catalog_import_manifest_record_invalid");
    }
    if (ids.has(item.catalog_id) || targets.has(item.target_university_id)) {
      throw new Error("catalog_import_manifest_duplicate_identity");
    }
    ids.add(item.catalog_id);
    targets.add(item.target_university_id);
    if (await sha256Hex(item.payload_json) !== item.payload_sha256) {
      throw new Error("catalog_import_payload_checksum_mismatch");
    }
    const payload = JSON.parse(item.payload_json);
    if (!isObject(payload) || payload.target_university_id !== item.target_university_id ||
        !isObject(payload.record) || payload.record.id !== item.catalog_id) {
      throw new Error("catalog_import_manifest_payload_identity_mismatch");
    }
    const rebuilt = preparePayload(payload.record, {
      catalog_id: item.catalog_id,
      target_university_id: item.target_university_id,
      action: item.action,
      merged_into_university_id: payload.merged_into_university_id
    });
    if (JSON.stringify(rebuilt) !== JSON.stringify(payload)) {
      throw new Error("catalog_import_manifest_payload_not_canonical");
    }
  }
  if (await manifestDigest(manifest.dataset_version, manifest.records) !== manifest.manifest_sha256) {
    throw new Error("catalog_import_manifest_checksum_mismatch");
  }
}


function assertImportableRecord(record) {
  if (!isObject(record) || !isObject(record.location) || !isObject(record.verification)) {
    throw new Error("catalog_import_record_invalid");
  }
  const { category, id, location, verification } = record;
  const countryCode = location.country_code;
  if (!["mainland", "hmt", "overseas"].includes(category) ||
      typeof countryCode !== "string" || !/^[A-Z]{2}$/.test(countryCode)) {
    throw new Error("catalog_import_record_location_invalid");
  }
  if (category === "mainland" && (countryCode !== "CN" || !String(id).startsWith("mainland:CN-"))) {
    throw new Error("catalog_import_record_category_mismatch");
  }
  if (category === "hmt" && (!["HK", "MO", "TW"].includes(countryCode) || !String(id).startsWith("hmt:" + countryCode + ":"))) {
    throw new Error("catalog_import_record_category_mismatch");
  }
  if (category === "overseas" && (["CN", "HK", "MO", "TW"].includes(countryCode) || !String(id).startsWith("overseas:" + countryCode + ":"))) {
    throw new Error("catalog_import_record_category_mismatch");
  }
  if (category === "mainland" && (!Array.isArray(record.degree_levels) || !record.degree_levels.includes("undergraduate"))) {
    throw new Error("catalog_import_undergraduate_required");
  }
  if (!["active", "inactive", "merged"].includes(record.status)) {
    throw new Error("catalog_import_record_status_invalid");
  }
  if (verification.status !== "verified" ||
      typeof verification.verified_at !== "string" ||
      !Number.isFinite(Date.parse(verification.verified_at)) ||
      !Array.isArray(verification.verified_fields) ||
      verification.verified_fields.length === 0) {
    throw new Error("catalog_import_record_not_verified");
  }
  const officialSources = Array.isArray(record.source_records)
    ? record.source_records.filter(source => isObject(source) &&
      ["government", "education_authority", "institution"].includes(source.source_type))
    : [];
  if (!officialSources.length) throw new Error("catalog_import_official_source_required");
  const coverage = new Set();
  for (const source of officialSources) {
    if (typeof source.publisher !== "string" || !source.publisher.trim() ||
        typeof source.title !== "string" || !source.title.trim() ||
        !Array.isArray(source.supports_fields) ||
        typeof source.accessed_at !== "string" || !/^\\d{4}-\\d{2}-\\d{2}$/.test(source.accessed_at)) {
      throw new Error("catalog_import_source_invalid");
    }
    let url;
    try { url = new URL(source.url); } catch { throw new Error("catalog_import_source_url_invalid"); }
    if (url.protocol !== "https:" || url.username || url.password) {
      throw new Error("catalog_import_source_url_invalid");
    }
    for (const field of source.supports_fields) coverage.add(field);
  }
  const required = [
    typeof record.name_zh === "string" && record.name_zh.trim() ? "name_zh" : "name_en",
    "category", "degree_levels", "location"
  ];
  if (typeof record.official_school_code === "string" && record.official_school_code.trim()) {
    required.push("official_school_code");
  }
  if (Array.isArray(record.project_tags) && record.project_tags.length) required.push("project_tags");
  if (Array.isArray(record.double_first_class_disciplines) && record.double_first_class_disciplines.length) {
    required.push("double_first_class_disciplines");
  }
  if (record.campus_info_status === "complete") required.push("campuses", "campus_structure", "has_branch_campus");
  for (const field of verification.verified_fields) {
    if (!coverage.has(field)) throw new Error("catalog_import_evidence_incomplete");
  }
  for (const field of required) {
    if (!verification.verified_fields.includes(field) || !coverage.has(field)) {
      throw new Error("catalog_import_required_evidence_missing");
    }
  }
}

function addUniqueIndex(index, key, row) {
  if (typeof key !== "string" || !key) return;
  const rows = index.get(key) || [];
  rows.push(row);
  index.set(key, rows);
}

export async function revalidateCatalogImportTargets(db, manifest) {
  await validateManifest(manifest);
  if (manifest.already_applied) return { already_applied: true, checked_count: 0 };
  const targetIds = new Set(manifest.records.map(item => item.target_university_id));
  for (const item of manifest.records) {
    const payload = JSON.parse(item.payload_json);
    const record = payload.record;
    assertImportableRecord(record);
    const expectedName = record.category + ":" + record.location.country_code + ":" +
      normalizeUniversityName(record.name_zh || record.name_en);
    if (payload.catalog_normalized_name !== expectedName) {
      throw new Error("catalog_import_normalized_identity_mismatch");
    }
    if (payload.merged_into_university_id && !targetIds.has(payload.merged_into_university_id)) {
      throw new Error("catalog_import_merge_target_missing");
    }
  }

  // Only university-master identity columns are read. No users, teams, phones,
  // sessions, OTPs, or audit metadata are part of the import snapshot.
  const snapshot = await db.prepare(
    "SELECT id,catalog_id,catalog_normalized_name,official_school_code,category,country_code FROM universities"
  ).all();
  const rows = snapshot.results || [];
  const byId = new Map();
  const byCatalogId = new Map();
  const byCode = new Map();
  const byName = new Map();
  for (const row of rows) {
    byId.set(row.id, row);
    addUniqueIndex(byCatalogId, row.catalog_id, row);
    addUniqueIndex(byCode, row.official_school_code, row);
    addUniqueIndex(byName, row.catalog_normalized_name, row);
  }

  for (const item of manifest.records) {
    const payload = JSON.parse(item.payload_json);
    const record = payload.record;
    const target = byId.get(item.target_university_id);
    const codeMatches = record.official_school_code ? (byCode.get(record.official_school_code) || []) : [];
    const nameMatches = byName.get(payload.catalog_normalized_name) || [];
    const catalogMatches = byCatalogId.get(item.catalog_id) || [];
    const matchingRows = [...new Map([...codeMatches, ...nameMatches, ...catalogMatches].map(row => [row.id, row])).values()];
    const hasOtherMatch = matchingRows.some(row => row.id !== item.target_university_id);

    if (item.action === "insert") {
      if (item.target_university_id !== item.catalog_id || target || matchingRows.length) {
        throw new Error("catalog_import_target_changed");
      }
      continue;
    }
    if (!target || target.category !== record.category ||
        (target.country_code && target.country_code !== record.location.country_code) ||
        (target.official_school_code && target.official_school_code !== (record.official_school_code || null)) ||
        (target.catalog_normalized_name && target.catalog_normalized_name !== payload.catalog_normalized_name) ||
        hasOtherMatch) {
      throw new Error("catalog_import_target_changed");
    }
    if (item.action === "update") {
      if (target.catalog_id !== item.catalog_id ||
          target.country_code !== record.location.country_code ||
          target.catalog_normalized_name !== payload.catalog_normalized_name) {
        throw new Error("catalog_import_update_target_changed");
      }
    } else if (item.action === "link_existing") {
      const matchedByStableKey =
        (!!record.official_school_code && target.official_school_code === record.official_school_code) ||
        target.catalog_normalized_name === payload.catalog_normalized_name;
      if (target.catalog_id !== null && target.catalog_id !== undefined) {
        throw new Error("catalog_import_link_target_already_linked");
      }
      if (!matchedByStableKey) throw new Error("catalog_import_link_target_unmatched");
    }
  }
  return { already_applied: false, checked_count: manifest.records.length, snapshot_count: rows.length };
}

export async function loadStagedCatalogImportManifest(db, datasetVersion, manifestSha256) {
  if (typeof datasetVersion !== "string" || !/^\\d{4}-\\d{2}-\\d{2}$/.test(datasetVersion) ||
      typeof manifestSha256 !== "string" || !/^[0-9a-f]{64}$/.test(manifestSha256)) {
    throw new Error("catalog_import_confirmation_invalid");
  }
  const batch = await db.prepare(
    "SELECT dataset_version,checksum_sha256,manifest_sha256,record_count,status " +
    "FROM university_catalog_imports WHERE dataset_version=?"
  ).bind(datasetVersion).first();
  if (!batch || batch.manifest_sha256 !== manifestSha256) {
    throw new Error("catalog_import_batch_mismatch");
  }
  if (batch.status === "applied") return { already_applied: true, dataset_version: datasetVersion };
  if (batch.status !== "validated") throw new Error("catalog_import_batch_not_finalizable");
  const staged = await db.prepare(
    "SELECT catalog_id,target_university_id,action,payload_json,payload_sha256 " +
    "FROM university_catalog_import_staging WHERE dataset_version=? ORDER BY catalog_id"
  ).bind(datasetVersion).all();
  const records = staged.results || [];
  if (records.length !== Number(batch.record_count)) throw new Error("catalog_import_staging_incomplete");
  const manifest = {
    manifest_version: "1.0.0",
    already_applied: false,
    dataset_version: batch.dataset_version,
    checksum_sha256: batch.checksum_sha256,
    manifest_sha256: batch.manifest_sha256,
    record_count: Number(batch.record_count),
    records
  };
  await validateManifest(manifest);
  return { already_applied: false, manifest };
}

export async function beginCatalogImport(db, manifest, importedAt = new Date().toISOString()) {
  await validateManifest(manifest);
  if (manifest.already_applied) return { already_applied: true };
  await db.prepare(
    "INSERT INTO university_catalog_imports(dataset_version,checksum_sha256,manifest_sha256,imported_at,record_count,status,notes) " +
    "VALUES(?,?,?,?,?,'validated','staged by catalog writer') ON CONFLICT(dataset_version) DO NOTHING"
  ).bind(manifest.dataset_version, manifest.checksum_sha256, manifest.manifest_sha256,
    importedAt, manifest.record_count).run();

  const row = await db.prepare(
    "SELECT dataset_version,checksum_sha256,manifest_sha256,record_count,status " +
    "FROM university_catalog_imports WHERE dataset_version=?"
  ).bind(manifest.dataset_version).first();
  if (!row || row.checksum_sha256 !== manifest.checksum_sha256 ||
      row.manifest_sha256 !== manifest.manifest_sha256 ||
      Number(row.record_count) !== manifest.record_count) {
    throw new Error("catalog_import_version_conflict");
  }
  if (row.status === "applied") return { already_applied: true };
  if (row.status !== "validated") throw new Error("catalog_import_batch_not_resumable");
  return { already_applied: false, status: row.status };
}

export async function stageCatalogImport(db, manifest, options = {}) {
  const begun = await beginCatalogImport(db, manifest, options.createdAt || new Date().toISOString());
  if (begun.already_applied) return { already_applied: true, staged_count: 0 };
  const chunkSize = options.chunkSize === undefined ? STAGE_CHUNK_SIZE : options.chunkSize;
  if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > STAGE_CHUNK_SIZE) {
    throw new Error("catalog_import_chunk_size_invalid");
  }
  const createdAt = options.createdAt || new Date().toISOString();
  for (let offset = 0; offset < manifest.records.length; offset += chunkSize) {
    const chunk = manifest.records.slice(offset, offset + chunkSize);
    await db.batch(chunk.map(item => db.prepare(
      "INSERT INTO university_catalog_import_staging(" +
      "dataset_version,checksum_sha256,catalog_id,target_university_id,action,payload_json,payload_sha256,created_at" +
      ") VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(dataset_version,catalog_id) DO NOTHING"
    ).bind(manifest.dataset_version, manifest.checksum_sha256, item.catalog_id,
      item.target_university_id, item.action, item.payload_json, item.payload_sha256, createdAt)));

    const placeholders = chunk.map(() => "?").join(",");
    const rows = await db.prepare(
      "SELECT catalog_id,target_university_id,action,payload_json,payload_sha256 " +
      "FROM university_catalog_import_staging WHERE dataset_version=? AND catalog_id IN (" + placeholders + ")"
    ).bind(manifest.dataset_version, ...chunk.map(item => item.catalog_id)).all();
    const found = new Map((rows.results || []).map(row => [row.catalog_id, row]));
    for (const item of chunk) {
      const row = found.get(item.catalog_id);
      if (!row || row.target_university_id !== item.target_university_id ||
          row.action !== item.action || row.payload_json !== item.payload_json || row.payload_sha256 !== item.payload_sha256) {
        throw new Error("catalog_import_staging_replay_conflict");
      }
    }
  }
  return { already_applied: false, staged_count: manifest.records.length };
}

const INSERT_NEW_SQL =
  "WITH staged AS (" +
  " SELECT * FROM university_catalog_import_staging WHERE dataset_version=? AND action='insert'" +
  ") " +
  "INSERT INTO universities(" +
  "id,canonical_name,normalized_name,category,region_name,education_level,project_tags_json,partner_name," +
  "catalog_id,catalog_normalized_name,official_school_code,name_en,country_code,country_name_zh,country_name_en," +
  "province_code,province_name_zh,city_name_zh,degree_levels_json,ownership,campus_structure,has_branch_campus," +
  "campus_info_status,verification_status,verified_at,verified_fields_json,verification_notes,catalog_status," +
  "merged_into,catalog_dataset_version,catalog_updated_at,catalog_source_count" +
  ") " +
  "SELECT s.target_university_id," +
  "COALESCE(NULLIF(json_extract(s.payload_json,'$.record.name_zh'),''),json_extract(s.payload_json,'$.record.name_en'))," +
  "'catalog:'||s.catalog_id,json_extract(s.payload_json,'$.record.category')," +
  "COALESCE(NULLIF(json_extract(s.payload_json,'$.record.location.province_name_zh'),''),json_extract(s.payload_json,'$.record.location.country_name_zh'))," +
  "CASE WHEN EXISTS(SELECT 1 FROM json_each(s.payload_json,'$.record.school_type_tags') WHERE value='vocational') THEN 'vocational' " +
  "WHEN EXISTS(SELECT 1 FROM json_each(s.payload_json,'$.record.degree_levels') WHERE value='undergraduate') THEN 'undergraduate' ELSE '' END," +
  "json_extract(s.payload_json,'$.record.project_tags'),'',s.catalog_id," +
  "json_extract(s.payload_json,'$.catalog_normalized_name'),json_extract(s.payload_json,'$.record.official_school_code')," +
  "json_extract(s.payload_json,'$.record.name_en'),json_extract(s.payload_json,'$.record.location.country_code')," +
  "json_extract(s.payload_json,'$.record.location.country_name_zh'),json_extract(s.payload_json,'$.record.location.country_name_en')," +
  "json_extract(s.payload_json,'$.record.location.province_code'),json_extract(s.payload_json,'$.record.location.province_name_zh')," +
  "json_extract(s.payload_json,'$.record.location.city_name_zh'),json_extract(s.payload_json,'$.record.degree_levels')," +
  "json_extract(s.payload_json,'$.record.ownership'),json_extract(s.payload_json,'$.record.campus_structure')," +
  "json_extract(s.payload_json,'$.record.has_branch_campus'),json_extract(s.payload_json,'$.record.campus_info_status')," +
  "json_extract(s.payload_json,'$.record.verification.status'),json_extract(s.payload_json,'$.record.verification.verified_at')," +
  "json_extract(s.payload_json,'$.record.verification.verified_fields'),json_extract(s.payload_json,'$.record.verification.notes')," +
  "json_extract(s.payload_json,'$.record.status'),json_extract(s.payload_json,'$.merged_into_university_id')," +
  "s.dataset_version,?,json_array_length(s.payload_json,'$.record.source_records') FROM staged s";

const UPDATE_EXISTING_SQL =
  "WITH staged AS (" +
  " SELECT * FROM university_catalog_import_staging WHERE dataset_version=? AND action IN ('update','link_existing')" +
  ") " +
  "UPDATE universities AS u SET " +
  "canonical_name=COALESCE(NULLIF(json_extract(s.payload_json,'$.record.name_zh'),''),json_extract(s.payload_json,'$.record.name_en'))," +
  "category=json_extract(s.payload_json,'$.record.category')," +
  "region_name=COALESCE(NULLIF(json_extract(s.payload_json,'$.record.location.province_name_zh'),''),json_extract(s.payload_json,'$.record.location.country_name_zh'))," +
  "education_level=CASE WHEN EXISTS(SELECT 1 FROM json_each(s.payload_json,'$.record.school_type_tags') WHERE value='vocational') THEN 'vocational' " +
  "WHEN EXISTS(SELECT 1 FROM json_each(s.payload_json,'$.record.degree_levels') WHERE value='undergraduate') THEN 'undergraduate' ELSE '' END," +
  "project_tags_json=json_extract(s.payload_json,'$.record.project_tags')," +
  "catalog_id=s.catalog_id,catalog_normalized_name=json_extract(s.payload_json,'$.catalog_normalized_name')," +
  "official_school_code=json_extract(s.payload_json,'$.record.official_school_code')," +
  "name_en=json_extract(s.payload_json,'$.record.name_en'),country_code=json_extract(s.payload_json,'$.record.location.country_code')," +
  "country_name_zh=json_extract(s.payload_json,'$.record.location.country_name_zh')," +
  "country_name_en=json_extract(s.payload_json,'$.record.location.country_name_en')," +
  "province_code=json_extract(s.payload_json,'$.record.location.province_code')," +
  "province_name_zh=json_extract(s.payload_json,'$.record.location.province_name_zh')," +
  "city_name_zh=json_extract(s.payload_json,'$.record.location.city_name_zh')," +
  "degree_levels_json=json_extract(s.payload_json,'$.record.degree_levels')," +
  "ownership=json_extract(s.payload_json,'$.record.ownership')," +
  "campus_structure=json_extract(s.payload_json,'$.record.campus_structure')," +
  "has_branch_campus=json_extract(s.payload_json,'$.record.has_branch_campus')," +
  "campus_info_status=json_extract(s.payload_json,'$.record.campus_info_status')," +
  "verification_status=json_extract(s.payload_json,'$.record.verification.status')," +
  "verified_at=json_extract(s.payload_json,'$.record.verification.verified_at')," +
  "verified_fields_json=json_extract(s.payload_json,'$.record.verification.verified_fields')," +
  "verification_notes=json_extract(s.payload_json,'$.record.verification.notes')," +
  "catalog_status=json_extract(s.payload_json,'$.record.status')," +
  "merged_into=json_extract(s.payload_json,'$.merged_into_university_id')," +
  "catalog_dataset_version=s.dataset_version,catalog_updated_at=?," +
  "catalog_source_count=json_array_length(s.payload_json,'$.record.source_records') " +
  "FROM staged s WHERE u.id=s.target_university_id " +
  "AND ((s.action='update' AND u.catalog_id=s.catalog_id) OR (s.action='link_existing' AND u.catalog_id IS NULL)) " +
  "AND u.category=json_extract(s.payload_json,'$.record.category') " +
  "AND (u.country_code IS NULL OR u.country_code=json_extract(s.payload_json,'$.record.location.country_code')) " +
  "AND (u.official_school_code IS NULL OR u.official_school_code IS json_extract(s.payload_json,'$.record.official_school_code')) " +
  "AND (u.catalog_normalized_name IS NULL OR u.catalog_normalized_name IS json_extract(s.payload_json,'$.catalog_normalized_name'))";

const FINALIZE_SQL = [
  INSERT_NEW_SQL,
  UPDATE_EXISTING_SQL,
  "DELETE FROM university_aliases WHERE university_id IN (SELECT target_university_id FROM university_catalog_import_staging WHERE dataset_version=?)",
  "INSERT INTO university_aliases(university_id,alias,normalized_alias) " +
    "SELECT s.target_university_id,json_extract(a.value,'$.alias'),json_extract(a.value,'$.normalized_alias') " +
    "FROM university_catalog_import_staging s JOIN json_each(s.payload_json,'$.aliases') a " +
    "WHERE s.dataset_version=?",
  "DELETE FROM university_tags WHERE university_id IN (SELECT target_university_id FROM university_catalog_import_staging WHERE dataset_version=?)",
  "INSERT INTO university_tags(university_id,tag_group,tag_code) " +
    "SELECT s.target_university_id,json_extract(t.value,'$.tag_group'),json_extract(t.value,'$.tag_code') " +
    "FROM university_catalog_import_staging s JOIN json_each(s.payload_json,'$.tags') t " +
    "WHERE s.dataset_version=?",
  "DELETE FROM university_campuses WHERE university_id IN (SELECT target_university_id FROM university_catalog_import_staging WHERE dataset_version=?)",
  "INSERT INTO university_campuses(" +
    "university_id,campus_key,name_zh,name_en,is_main_campus,is_branch_campus,country_code,country_name_zh," +
    "country_name_en,province_code,province_name_zh,city_name_zh" +
    ") SELECT s.target_university_id,json_extract(c.value,'$.id'),json_extract(c.value,'$.name_zh')," +
    "json_extract(c.value,'$.name_en'),json_extract(c.value,'$.is_main_campus')," +
    "json_extract(c.value,'$.is_branch_campus'),json_extract(c.value,'$.location.country_code')," +
    "json_extract(c.value,'$.location.country_name_zh'),json_extract(c.value,'$.location.country_name_en')," +
    "json_extract(c.value,'$.location.province_code'),json_extract(c.value,'$.location.province_name_zh')," +
    "json_extract(c.value,'$.location.city_name_zh') " +
    "FROM university_catalog_import_staging s JOIN json_each(s.payload_json,'$.record.campuses') c " +
    "WHERE s.dataset_version=?",
  "DELETE FROM university_sources WHERE university_id IN (SELECT target_university_id FROM university_catalog_import_staging WHERE dataset_version=?)",
  "INSERT INTO university_sources(" +
    "university_id,source_type,publisher,title,url,accessed_at,supports_fields_json" +
    ") SELECT s.target_university_id,json_extract(r.value,'$.source_type'),json_extract(r.value,'$.publisher')," +
    "json_extract(r.value,'$.title'),json_extract(r.value,'$.url'),json_extract(r.value,'$.accessed_at')," +
    "json_extract(r.value,'$.supports_fields') " +
    "FROM university_catalog_import_staging s JOIN json_each(s.payload_json,'$.record.source_records') r " +
    "WHERE s.dataset_version=?",
  "UPDATE university_catalog_imports SET status='applied',imported_at=?," +
    "inserted_count=(SELECT COUNT(*) FROM university_catalog_import_staging WHERE dataset_version=? AND action='insert')," +
    "updated_count=(SELECT COUNT(*) FROM university_catalog_import_staging WHERE dataset_version=? AND action='update')," +
    "linked_existing_count=(SELECT COUNT(*) FROM university_catalog_import_staging WHERE dataset_version=? AND action='link_existing')," +
    "skipped_count=0 WHERE dataset_version=? AND checksum_sha256=? AND manifest_sha256=?",
  "DELETE FROM university_catalog_import_staging WHERE dataset_version=?",
  "INSERT INTO audit_logs(id,actor_type,actor_id,action,target_type,target_id,metadata_json) " +
    "SELECT ?,'admin',?,'admin.university_catalog.imported','university_catalog_import',dataset_version," +
    "json_object('datasetVersion',dataset_version,'checksumSha256',checksum_sha256," +
    "'manifestSha256',manifest_sha256,'recordCount',record_count,'insertedCount',inserted_count," +
    "'updatedCount',updated_count,'linkedExistingCount',linked_existing_count) " +
    "FROM university_catalog_imports WHERE dataset_version=? AND status='applied'"
];

function randomHex(bytes = 16) {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  return [...value].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function finalizeCatalogImport(db, manifest, actorAdminId, importedAt = new Date().toISOString()) {
  await validateManifest(manifest);
  if (manifest.already_applied) return { already_applied: true };
  if (typeof actorAdminId !== "string" || !actorAdminId.trim() || actorAdminId.length > 64) {
    throw new Error("catalog_import_actor_required");
  }
  const batch = await db.prepare(
    "SELECT checksum_sha256,manifest_sha256,record_count,status " +
    "FROM university_catalog_imports WHERE dataset_version=?"
  ).bind(manifest.dataset_version).first();
  if (!batch || batch.checksum_sha256 !== manifest.checksum_sha256 ||
      batch.manifest_sha256 !== manifest.manifest_sha256 ||
      Number(batch.record_count) !== manifest.record_count) {
    throw new Error("catalog_import_batch_mismatch");
  }
  if (batch.status === "applied") return { already_applied: true };
  if (batch.status !== "validated") throw new Error("catalog_import_batch_not_finalizable");

  const staged = await db.prepare(
    "SELECT catalog_id,payload_json,payload_sha256 FROM university_catalog_import_staging " +
    "WHERE dataset_version=? ORDER BY catalog_id"
  ).bind(manifest.dataset_version).all();
  const rows = staged.results || [];
  if (rows.length !== manifest.record_count) throw new Error("catalog_import_staging_incomplete");
  for (const row of rows) {
    if (await sha256Hex(row.payload_json) !== row.payload_sha256) {
      throw new Error("catalog_import_staging_payload_tampered");
    }
  }
  const stagedDigest = await manifestDigest(manifest.dataset_version, rows);
  if (stagedDigest !== manifest.manifest_sha256) throw new Error("catalog_import_staging_manifest_mismatch");

  const version = manifest.dataset_version;
  const statements = [
    db.prepare(FINALIZE_SQL[0]).bind(version, importedAt),
    db.prepare(FINALIZE_SQL[1]).bind(version, importedAt),
    db.prepare(FINALIZE_SQL[2]).bind(version),
    db.prepare(FINALIZE_SQL[3]).bind(version),
    db.prepare(FINALIZE_SQL[4]).bind(version),
    db.prepare(FINALIZE_SQL[5]).bind(version),
    db.prepare(FINALIZE_SQL[6]).bind(version),
    db.prepare(FINALIZE_SQL[7]).bind(version),
    db.prepare(FINALIZE_SQL[8]).bind(version),
    db.prepare(FINALIZE_SQL[9]).bind(version),
    db.prepare(FINALIZE_SQL[10]).bind(importedAt, version, version, version, version,
      manifest.checksum_sha256, manifest.manifest_sha256),
    db.prepare(FINALIZE_SQL[11]).bind(version),
    db.prepare(FINALIZE_SQL[12]).bind(randomHex(), actorAdminId, version)
  ];
  const results = await db.batch(statements);
  if ((results[10]?.meta?.changes || 0) !== 1) throw new Error("catalog_import_commit_not_applied");
  return {
    already_applied: false,
    dataset_version: version,
    record_count: manifest.record_count,
    inserted_count: manifest.records.filter(item => item.action === "insert").length,
    updated_count: manifest.records.filter(item => item.action === "update").length,
    linked_existing_count: manifest.records.filter(item => item.action === "link_existing").length
  };
}

export const CATALOG_IMPORT_STAGE_CHUNK_SIZE = STAGE_CHUNK_SIZE;

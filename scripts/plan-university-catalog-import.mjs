import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeUniversityName, validateCatalog } from "./validate-university-catalog.mjs";

const SNAPSHOT_KEYS = new Set(["schema_version", "exported_at", "universities", "imports"]);
const ROW_KEYS = new Set([
  "id", "catalog_id", "catalog_normalized_name", "official_school_code",
  "category", "canonical_name", "normalized_name", "country_code"
]);
const IMPORT_KEYS = new Set(["dataset_version", "checksum_sha256", "record_count", "status"]);
const ACTIONS = ["insert", "update", "link_existing", "skip", "manual_review", "conflict"];

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function addIndex(index, key, row) {
  if (typeof key !== "string" || key.length === 0) return;
  const rows = index.get(key) || [];
  rows.push(row);
  index.set(key, rows);
}

function validateSnapshot(snapshot) {
  const errors = [];
  if (!isObject(snapshot)) return ["快照根节点必须是对象"];
  for (const key of Object.keys(snapshot)) {
    if (!SNAPSHOT_KEYS.has(key)) errors.push("$." + key + ": 不允许的快照字段（快照不得包含用户或个人资料）");
  }
  if (snapshot.schema_version !== "1.0.0") errors.push("$.schema_version: 必须为 1.0.0");
  if (!(snapshot.exported_at === null || typeof snapshot.exported_at === "string")) errors.push("$.exported_at: 必须是字符串或 null");
  if (!Array.isArray(snapshot.universities)) errors.push("$.universities: 必须是数组");
  if (!Array.isArray(snapshot.imports)) errors.push("$.imports: 必须是数组");

  const seen = { ids: new Set(), catalogIds: new Set(), codes: new Set(), names: new Set() };
  if (Array.isArray(snapshot.universities)) {
    snapshot.universities.forEach((row, index) => {
      const path = "$.universities[" + index + "]";
      if (!isObject(row)) {
        errors.push(path + ": 必须是对象");
        return;
      }
      for (const key of Object.keys(row)) {
        if (!ROW_KEYS.has(key)) errors.push(path + "." + key + ": 不允许的快照字段（禁止导出个人信息）");
      }
      if (typeof row.id !== "string" || !row.id.trim()) errors.push(path + ".id: 必须是非空字符串");
      else if (seen.ids.has(row.id)) errors.push(path + ".id: 快照中存在重复 D1 主键");
      else seen.ids.add(row.id);
      if (!["unclassified", "mainland", "hmt", "sino_foreign", "overseas"].includes(row.category)) {
        errors.push(path + ".category: 不属于现有 D1 高校分类");
      }
      for (const key of ["catalog_id", "catalog_normalized_name", "official_school_code", "normalized_name", "country_code"]) {
        if (!(row[key] === null || typeof row[key] === "string")) errors.push(path + "." + key + ": 必须是字符串或 null");
      }
      if (row.country_code !== null && !/^[A-Z]{2}$/.test(row.country_code)) {
        errors.push(path + ".country_code: 必须是大写 ISO alpha-2 代码或 null");
      }
      if (typeof row.canonical_name !== "string" || !row.canonical_name.trim()) {
        errors.push(path + ".canonical_name: 必须是非空字符串");
      }
      for (const [field, set] of [
        ["catalog_id", seen.catalogIds],
        ["official_school_code", seen.codes],
        ["catalog_normalized_name", seen.names]
      ]) {
        const value = row[field];
        if (typeof value === "string" && value.length) {
          if (set.has(value)) errors.push(path + "." + field + ": 快照中存在重复唯一值");
          else set.add(value);
        }
      }
    });
  }
  if (Array.isArray(snapshot.imports)) {
    const versions = new Set();
    snapshot.imports.forEach((item, index) => {
      const path = "$.imports[" + index + "]";
      if (!isObject(item)) {
        errors.push(path + ": 必须是对象");
        return;
      }
      for (const key of Object.keys(item)) {
        if (!IMPORT_KEYS.has(key)) errors.push(path + "." + key + ": 不允许的导入批次字段");
      }
      if (typeof item.dataset_version !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(item.dataset_version)) {
        errors.push(path + ".dataset_version: 日期格式无效");
      } else if (versions.has(item.dataset_version)) {
        errors.push(path + ".dataset_version: 快照中存在重复版本");
      } else {
        versions.add(item.dataset_version);
      }
      if (typeof item.checksum_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(item.checksum_sha256)) {
        errors.push(path + ".checksum_sha256: 必须是 SHA-256 十六进制摘要");
      }
      if (!Number.isInteger(item.record_count) || item.record_count < 0) errors.push(path + ".record_count: 必须是非负整数");
      if (!["validated", "applied", "failed"].includes(item.status)) errors.push(path + ".status: 状态无效");
    });
  }
  return errors;
}

function buildIndexes(rows) {
  const indexes = { catalogId: new Map(), code: new Map(), catalogName: new Map() };
  for (const row of rows) {
    addIndex(indexes.catalogId, row.catalog_id, row);
    addIndex(indexes.code, row.official_school_code, row);
    addIndex(indexes.catalogName, row.catalog_normalized_name, row);
  }
  return indexes;
}

function uniqueRows(rows) {
  return [...new Map(rows.map(row => [row.id, row])).values()];
}

function emptyCounts() {
  return Object.fromEntries(ACTIONS.map(action => [action, 0]));
}

export function planCatalogImport(catalog, snapshot, sourceText = JSON.stringify(catalog)) {
  const catalogResult = validateCatalog(catalog);
  if (!catalogResult.valid) {
    throw new Error("高校目录校验失败：\n" + catalogResult.errors.join("\n"));
  }
  const snapshotErrors = validateSnapshot(snapshot);
  if (snapshotErrors.length) {
    throw new Error("现有高校快照无效：\n" + snapshotErrors.join("\n"));
  }

  const checksum = createHash("sha256").update(sourceText, "utf8").digest("hex");
  const indexes = buildIndexes(snapshot.universities);
  const priorImports = snapshot.imports.filter(item => item.dataset_version === catalog.dataset_version);
  const items = [];
  let batchConflict = null;
  if (priorImports.length > 1) {
    batchConflict = "现有快照包含重复 dataset_version 导入记录";
  } else if (priorImports.length === 1 && priorImports[0].checksum_sha256 !== checksum) {
    batchConflict = "dataset_version 已存在，但文件 SHA-256 不同；必须提升 dataset_version，不能覆盖历史批次";
  } else if (priorImports.length === 1 && priorImports[0].status === "applied" && priorImports[0].record_count !== catalog.universities.length) {
    batchConflict = "已应用批次的 record_count 与当前目录数量不一致；需人工核对快照完整性";
  } else if (priorImports.length === 1 && priorImports[0].status === "applied") {
    const missingOrChanged = catalog.universities.find(university => {
      const rows = indexes.catalogId.get(university.id) || [];
      if (rows.length !== 1) return true;
      const existing = rows[0];
      const expectedName = university.category + ":" + university.location.country_code + ":" +
        normalizeUniversityName(university.name_zh || university.name_en);
      return existing.category !== university.category ||
        existing.catalog_normalized_name !== expectedName ||
        existing.official_school_code !== university.official_school_code ||
        existing.country_code !== university.location.country_code;
    });
    if (missingOrChanged) {
      batchConflict = "已应用批次与当前 D1 快照不一致（目录记录缺失或身份字段变化）；必须人工核对，不能直接跳过";
    }
  }

  if (batchConflict) {
    for (const university of catalog.universities) {
      items.push({
        catalog_id: university.id,
        name: university.name_zh || university.name_en,
        action: "conflict",
        target_university_id: null,
        reason: batchConflict,
        match_by: null
      });
    }
  } else if (priorImports.length === 1 && priorImports[0].status === "applied") {
    for (const university of catalog.universities) {
      items.push({
        catalog_id: university.id,
        name: university.name_zh || university.name_en,
        action: "skip",
        target_university_id: null,
        reason: "相同 dataset_version 和 checksum 已标记为 applied",
        match_by: "import_batch"
      });
    }
  } else {
    for (const university of catalog.universities) {
      const catalogName = university.category + ":" + university.location.country_code + ":" +
        normalizeUniversityName(university.name_zh || university.name_en);
      const candidates = uniqueRows([
        ...(indexes.catalogId.get(university.id) || []),
        ...(university.official_school_code ? indexes.code.get(university.official_school_code) || [] : []),
        ...(indexes.catalogName.get(catalogName) || [])
      ]);
      const matchedBy = [];
      if ((indexes.catalogId.get(university.id) || []).length) matchedBy.push("catalog_id");
      if (university.official_school_code && (indexes.code.get(university.official_school_code) || []).length) matchedBy.push("official_school_code");
      if ((indexes.catalogName.get(catalogName) || []).length) matchedBy.push("catalog_normalized_name");

      let action;
      let targetId = null;
      let reason;
      let matchBy = matchedBy.join("+") || null;

      if (candidates.length > 1) {
        action = "conflict";
        reason = "目录 ID、学校代码或国家感知规范化名称分别命中不同的现有记录";
      } else if (candidates.length === 1) {
        const candidate = candidates[0];
        targetId = candidate.id;
        if (candidate.category !== university.category) {
          action = "conflict";
          reason = "匹配记录的高校分类不同；禁止自动合并或改写旧分类";
        } else if (candidate.country_code && candidate.country_code !== university.location.country_code) {
          action = "conflict";
          reason = "匹配记录的国家/地区代码不同；禁止跨国家或地区自动关联";
        } else if (
          matchedBy.includes("official_school_code") &&
          !matchedBy.includes("catalog_id") &&
          !matchedBy.includes("catalog_normalized_name") &&
          candidate.country_code === null
        ) {
          action = "manual_review";
          reason = "学校代码命中，但旧记录缺少国家/地区代码；无法排除跨国家代码重复，需人工核验";
        } else if (candidate.catalog_id && candidate.catalog_id !== university.id) {
          action = "conflict";
          reason = "现有记录已经绑定另一个 catalog_id";
        } else if (candidate.catalog_normalized_name && candidate.catalog_normalized_name !== catalogName) {
          action = "conflict";
          reason = "匹配记录的国家感知规范化名称与目录数据不一致";
        } else if (candidate.official_school_code && university.official_school_code && candidate.official_school_code !== university.official_school_code) {
          action = "conflict";
          reason = "匹配记录的学校代码与目录数据不一致";
        } else if (matchedBy.length === 0) {
          action = "conflict";
          reason = "无法确定匹配依据";
        } else if (candidate.catalog_id === university.id) {
          action = "update";
          reason = "catalog_id 已精确匹配；后续应用时保留现有 universities.id 和成员外键";
        } else {
          action = "link_existing";
          reason = "通过唯一学校代码或国家感知规范化名称匹配旧记录；保留旧 universities.id，不迁移用户/队伍外键";
        }
      } else {
        const normalizedName = normalizeUniversityName(university.name_zh || university.name_en);
        const legacyCandidates = snapshot.universities.filter(row =>
          !row.catalog_id &&
          normalizeUniversityName(row.canonical_name) === normalizedName &&
          (row.country_code === null || row.country_code === university.location.country_code)
        );
        if (legacyCandidates.length) {
          action = "manual_review";
          reason = "发现尚未绑定目录 ID 的同名旧记录；缺少足够稳定的唯一标识，需人工核对后才能决定链接或新增";
          matchBy = "legacy_canonical_name";
          targetId = legacyCandidates.length === 1 ? legacyCandidates[0].id : null;
        } else {
          action = "insert";
          targetId = university.id;
          reason = "未命中现有目录 ID、学校代码或国家感知规范化名称";
        }
      }

      items.push({
        catalog_id: university.id,
        name: university.name_zh || university.name_en,
        action,
        target_university_id: targetId,
        reason,
        match_by: matchBy
      });
    }

    // Resolve merged_into against the actual D1 row IDs, not assumed catalog IDs.
    const itemByCatalogId = new Map(items.map(item => [item.catalog_id, item]));
    for (const university of catalog.universities) {
      if (university.status !== "merged") continue;
      const item = itemByCatalogId.get(university.id);
      const target = itemByCatalogId.get(university.merged_into);
      if (!target || !["insert", "update", "link_existing", "skip"].includes(target.action) || !target.target_university_id) {
        item.action = "manual_review";
        item.reason = "合并目标尚未解析为稳定的 D1 universities.id，需人工确认";
      } else {
        item.merged_into_university_id = target.target_university_id;
      }
    }
  }

  const counts = emptyCounts();
  for (const item of items) counts[item.action] += 1;
  const reviewCount = counts.manual_review + counts.conflict;
  return {
    plan_version: "1.0.0",
    mode: "dry-run",
    writes_performed: false,
    dataset_version: catalog.dataset_version,
    checksum_sha256: checksum,
    existing_snapshot_universities: snapshot.universities.length,
    counts,
    requires_manual_review: reviewCount > 0,
    eligible_for_human_review: reviewCount === 0,
    safety: {
      deletes_planned: 0,
      user_rows_modified: 0,
      team_rows_modified: 0,
      membership_foreign_keys_changed: 0,
      note: "此工具只生成计划，不连接 D1、不生成可直接执行的 SQL，也不会修改数据库。"
    },
    items
  };
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!["--catalog", "--existing", "--out"].includes(key) || !argv[index + 1] || argv[index + 1].startsWith("--")) {
      throw new Error("用法：node scripts/plan-university-catalog-import.mjs --catalog <catalog.json> --existing <snapshot.json> [--out <plan.json>]");
    }
    values[key] = argv[index + 1];
    index += 1;
  }
  if (!values["--catalog"] || !values["--existing"]) {
    throw new Error("必须同时提供 --catalog 和 --existing；没有 D1 快照时不能生成可用于对账的导入计划");
  }
  return values;
}

function runCli() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const catalogText = readFileSync(resolve(args["--catalog"]), "utf8");
    const snapshotText = readFileSync(resolve(args["--existing"]), "utf8");
    const catalog = JSON.parse(catalogText);
    const snapshot = JSON.parse(snapshotText);
    const plan = planCatalogImport(catalog, snapshot, catalogText);
    const output = JSON.stringify(plan, null, 2) + "\n";
    if (args["--out"]) {
      writeFileSync(resolve(args["--out"]), output, { encoding: "utf8", flag: "wx" });
      console.log("Dry-run 计划已写入 " + resolve(args["--out"]));
    } else {
      process.stdout.write(output);
    }
    console.error("Dry-run 摘要：" + JSON.stringify(plan.counts) + "；未执行任何数据库写入。");
    if (plan.requires_manual_review) process.exitCode = 2;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runCli();

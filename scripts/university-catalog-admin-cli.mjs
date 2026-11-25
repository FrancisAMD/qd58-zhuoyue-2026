import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const MAX_BODY_BYTES = 8 * 1024 * 1024;
const hashHex = value => createHash("sha256").update(value).digest("hex");

export function parseArgs(argv) {
  const command = argv[0];
  if (!["status", "stage", "finalize"].includes(command)) throw new Error("命令必须是 status、stage 或 finalize");
  const options = {};
  for (let i = 1; i < argv.length; i++) {
    const key = argv[i];
    if (!["--api-base", "--app-origin", "--dataset-version", "--manifest", "--manifest-sha256"].includes(key) || !argv[i + 1] || argv[i + 1].startsWith("--")) throw new Error("参数无效：" + key);
    options[key] = argv[++i];
  }
  if (!options["--api-base"] || !options["--app-origin"]) throw new Error("必须明确指定 --api-base 和 --app-origin，避免误操作目标环境");
  if (command === "status" && !options["--dataset-version"]) throw new Error("status 需要 --dataset-version");
  if (command === "stage" && !options["--manifest"]) throw new Error("stage 需要 --manifest");
  if (command === "finalize" && (!options["--dataset-version"] || !options["--manifest-sha256"])) throw new Error("finalize 需要 --dataset-version 和 --manifest-sha256");
  return { command, options };
}

export function verifyManifest(manifest) {
  if (!manifest || manifest.manifest_version !== "1.0.0" || manifest.already_applied !== false ||
      !/^\d{4}-\d{2}-\d{2}$/.test(String(manifest.dataset_version || "")) ||
      !/^[0-9a-f]{64}$/.test(String(manifest.checksum_sha256 || "")) ||
      !/^[0-9a-f]{64}$/.test(String(manifest.manifest_sha256 || "")) ||
      !Array.isArray(manifest.records) || manifest.records.length < 1 ||
      manifest.record_count !== manifest.records.length || manifest.records.length > 5000) throw new Error("本地 Manifest 结构无效或记录数量超限");
  const ids = new Set(), targets = new Set(), rows = [];
  for (const item of manifest.records) {
    if (!item || typeof item.catalog_id !== "string" || typeof item.target_university_id !== "string" ||
        !["insert", "update", "link_existing"].includes(item.action) || typeof item.payload_json !== "string" ||
        !/^[0-9a-f]{64}$/.test(String(item.payload_sha256 || ""))) throw new Error("Manifest 记录格式无效");
    if (ids.has(item.catalog_id) || targets.has(item.target_university_id)) throw new Error("Manifest 存在重复目录 ID 或目标 ID");
    ids.add(item.catalog_id); targets.add(item.target_university_id);
    if (hashHex(item.payload_json) !== item.payload_sha256) throw new Error("高校 payload SHA-256 不匹配：" + item.catalog_id);
    let payload;
    try { payload = JSON.parse(item.payload_json); } catch { throw new Error("高校 payload JSON 无效：" + item.catalog_id); }
    if (payload?.target_university_id !== item.target_university_id || payload?.record?.id !== item.catalog_id) throw new Error("高校 payload 身份不匹配：" + item.catalog_id);
    rows.push(item.catalog_id + ":" + item.payload_sha256);
  }
  rows.sort();
  const expected = hashHex(manifest.dataset_version + "\n" + rows.join("\n") + "\n");
  if (expected !== manifest.manifest_sha256) throw new Error("Manifest SHA-256 不匹配");
  return { dataset_version: manifest.dataset_version, record_count: manifest.record_count, checksum_sha256: manifest.checksum_sha256, manifest_sha256: manifest.manifest_sha256 };
}

async function askVisible(promptText) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { return await new Promise(resolveAnswer => rl.question(promptText, resolveAnswer)); }
  finally { rl.close(); }
}

async function askHidden(promptText) {
  const input = process.stdin, output = process.stdout;
  if (!input.isTTY || typeof input.setRawMode !== "function") throw new Error("需要交互式终端才能安全输入密码；不支持通过命令行参数传密码");
  return new Promise((resolveAnswer, reject) => {
    let value = "";
    output.write(promptText);
    input.setRawMode(true); input.resume();
    const finish = (error) => {
      input.removeListener("data", onData); input.setRawMode(false); input.pause(); output.write("\n");
      if (error) reject(error); else resolveAnswer(value);
    };
    const onData = chunk => {
      const s = chunk.toString("utf8");
      if (s === "\u0003") return finish(new Error("已取消"));
      if (s === "\r" || s === "\n") return finish();
      if (s === "\u007f" || s === "\b") { value = value.slice(0, -1); return; }
      if (s >= " " && value.length < 128) value += s;
    };
    input.on("data", onData);
  });
}

async function promptCredentials() {
  const username = (await askVisible("管理员用户名: ")).trim();
  const password = await askHidden("管理员密码（不回显）: ");
  return { username, password };
}

async function promptConfirm(phrase) {
  const answer = await askVisible("请完整输入确认词（不会执行任何其他命令）：\n" + phrase + "\n> ");
  return answer === phrase;
}

function validateTarget(apiBase, appOrigin) {
  const api = new URL(apiBase), app = new URL(appOrigin);
  if ((api.protocol !== "https:" && !(api.protocol === "http:" && api.hostname === "localhost")) || api.username || api.password || api.search || api.hash || api.pathname !== "/") throw new Error("API Base 必须是无凭据、无路径的 HTTPS origin（本机测试可用 localhost HTTP）");
  if ((app.protocol !== "https:" && !(app.protocol === "http:" && app.hostname === "localhost")) || app.username || app.password || app.search || app.hash || app.pathname !== "/") throw new Error("App Origin 必须是无凭据、无路径的 HTTPS origin（本机测试可用 localhost HTTP）");
  return { api: api.origin, app: app.origin };
}

export async function runCommand({ argv, fetchImpl = fetch, promptCredentials: credentialPrompt = promptCredentials, promptConfirm: confirmPrompt = promptConfirm, readFileImpl = readFile, output = value => console.log(value) }) {
  const { command, options } = parseArgs(argv);
  const target = validateTarget(options["--api-base"], options["--app-origin"]);
  let manifest;
  if (command === "stage") {
    const text = await readFileImpl(resolve(options["--manifest"]), "utf8");
    if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) throw new Error("Manifest 文件超过 8 MiB，拒绝上传");
    manifest = JSON.parse(text);
    verifyManifest(manifest);
    if (Buffer.byteLength(JSON.stringify({ manifest }), "utf8") > MAX_BODY_BYTES) throw new Error("上传 JSON 包装后超过 Worker 8 MiB 限制，拒绝上传");
  }
  const credentials = await credentialPrompt();
  const loginUrl = target.api + "/api/admin/login";
  let login;
  try { login = await fetchImpl(loginUrl, { method: "POST", redirect: "error", headers: { "content-type": "application/json", Origin: target.app }, body: JSON.stringify(credentials) }); }
  finally { credentials.password = ""; }
  const loginBody = await login.json().catch(() => ({}));
  if (!login.ok) throw new Error("管理员登录失败：" + (loginBody.error || login.status));
  const cookieHeader = login.headers.get("set-cookie") || "";
  const match = cookieHeader.match(/__Host-qd58_admin=([^;]+)/);
  if (!match) throw new Error("登录响应未提供管理员 Session Cookie");
  const cookie = "__Host-qd58_admin=" + match[1];

  const request = async (path, method = "GET", bodyValue = undefined) => {
    const headers = { Origin: target.app, Cookie: cookie, Accept: "application/json", "Cache-Control": "no-store" };
    const init = { method, redirect: "error", headers };
    if (bodyValue !== undefined) { headers["content-type"] = "application/json"; init.body = JSON.stringify(bodyValue); }
    const response = await fetchImpl(target.api + path, init);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error("API 请求失败（" + response.status + "）：" + (data.error || "unknown"));
    return data;
  };
  const statusPath = version => "/api/admin/universities/import/status?datasetVersion=" + encodeURIComponent(version);
  let result;
  try {
    if (command === "status") {
      const data = await request(statusPath(options["--dataset-version"]));
      result = data.import;
    } else if (command === "stage") {
      await request("/api/admin/universities/import/stage", "POST", { manifest });
      const data = await request(statusPath(manifest.dataset_version));
      const status = data.import;
      if (status.checksumSha256 !== manifest.checksum_sha256 || status.manifestSha256 !== manifest.manifest_sha256 || status.recordCount !== manifest.record_count || status.stagingComplete !== true) throw new Error("上传后状态与本地 Manifest 不一致；停止后续操作");
      result = status;
    } else {
      const version = options["--dataset-version"], digest = options["--manifest-sha256"];
      if (!/^[0-9a-f]{64}$/.test(digest)) throw new Error("--manifest-sha256 必须是 64 位小写 SHA-256");
      const before = (await request(statusPath(version))).import;
      if (before.status === "applied" && before.manifestSha256 === digest && before.stagingComplete === true) result = before;
      else {
        if (before.status !== "validated" || before.stagingComplete !== true || before.manifestSha256 !== digest) throw new Error("批次未完整暂存或 SHA-256 不匹配；拒绝正式提交");
        const phrase = "APPLY " + digest;
        if (!(await confirmPrompt(phrase))) throw new Error("确认词不匹配；未执行正式提交");
        await request("/api/admin/universities/import/finalize", "POST", { datasetVersion: version, manifestSha256: digest, confirmManifestSha256: digest });
        const after = (await request(statusPath(version))).import;
        if (after.status !== "applied" || after.stagedCount !== 0 || after.stagingComplete !== true || after.manifestSha256 !== digest) throw new Error("提交后状态未达到 applied；请使用 status 命令核查");
        result = after;
      }
    }
  } finally {
    try { await request("/api/admin/logout", "POST", {}); } catch { /* best-effort session revocation; no token is written to disk */ }
  }
  output(JSON.stringify({ command, datasetVersion: result.datasetVersion, status: result.status, recordCount: result.recordCount, stagedCount: result.stagedCount, stagingComplete: result.stagingComplete, manifestSha256: result.manifestSha256, insertedCount: result.insertedCount, updatedCount: result.updatedCount, linkedExistingCount: result.linkedExistingCount }, null, 2));
  return result;
}

async function main() {
  try { await runCommand({ argv: process.argv.slice(2) }); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

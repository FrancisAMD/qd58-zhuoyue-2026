import { createHash } from "node:crypto";
import { createInterface } from "node:readline";
import { mkdir, lstat, writeFile } from "node:fs/promises";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath, pathToURL } from "node:url";

const hashHex = value => createHash("sha256").update(value).digest("hex");
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_RECORDS = 100000;
const MAX_PAGES = 1000;

export function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!["--api-base", "--app-origin", "--out"].includes(key) || !argv[i + 1] || argv[i + 1].startsWith("--")) {
      throw new Error("参数无效：" + key);
    }
    options[key] = argv[++i];
  }
  if (!options["--api-base"] || !options["--app-origin"] || !options["--out"]) {
    throw new Error("必须明确指定 --api-base、--app-origin 和 --out");
  }
  return options;
}

function validateTarget(apiBase, appOrigin) {
  const api = new URL(apiBase), app = new URL(appOrigin);
  const valid = value => (value.protocol === "https:" || (value.protocol === "http:" && value.hostname === "localhost")) &&
    !value.username && !value.password && !value.search && !value.hash && value.pathname === "/";
  if (!valid(api) || !valid(app)) throw new Error("目标必须是无凭据、无路径的 HTTPS origin（本机测试可用 localhost HTTP）");
  return { api: api.origin, app: app.origin };
}

function validateIntent(record) {
  if (!record || typeof record !== "object" || Array.isArray(record) ||
      Object.keys(record).sort().join(",") !== "eventId,payloadSha256,requestedAt,schemaVersion,userId" ||
      record.schemaVersion !== 1 || !/^[a-f0-9]{32}$/.test(String(record.userId || "")) ||
      !/^[a-f0-9]{32}$/.test(String(record.eventId || "")) ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(String(record.requestedAt || "")) ||
      !/^[a-f0-9]{64}$/.test(String(record.payloadSha256 || ""))) throw new Error("删除意图结构无效");
  const base = { schemaVersion: 1, userId: record.userId, requestedAt: record.requestedAt, eventId: record.eventId };
  if (hashHex(JSON.stringify(base)) !== record.payloadSha256) throw new Error("删除意图摘要不匹配");
  return base ? {
    schemaVersion: 1, userId: record.userId, requestedAt: record.requestedAt,
    eventId: record.eventId, payloadSha256: record.payloadSha256
  } : null;
}

async function askVisible(promptText) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { return await new Promise(resolveAnswer => rl.question(promptText, resolveAnswer)); }
  finally { rl.close(); }
}
async function askHidden(promptText) {
  const input = process.stdin, output = process.stdout;
  if (!input.isTTY || typeof input.setRawMode !== "function") throw new Error("需要交互式终端安全输入管理员密码");
  return new Promise((resolveAnswer, reject) => {
    let value = "";
    output.write(promptText);
    input.setRawMode(true); input.resume();
    const finish = error => {
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

export async function runExport({
  argv, fetchImpl = fetch, promptCredentials: credentialPrompt = promptCredentials,
  output = value => console.log(value), rootDir = ROOT,
  mkdirImpl = mkdir, lstatImpl = lstat, writeFileImpl = writeFile
}) {
  const options = parseArgs(argv), target = validateTarget(options["--api-base"], options["--app-origin"]);
  const privateDir = resolve(rootDir, "private-backups");
  const outPath = resolve(rootDir, options["--out"]);
  if (dirname(outPath) !== privateDir || relative(privateDir, outPath).startsWith("..")) {
    throw new Error("输出文件必须直接放在 private-backups 目录中");
  }
  await mkdirImpl(privateDir, { recursive: true });
  const directoryStat = await lstatImpl(privateDir);
  if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) throw new Error("private-backups 目录不安全");
  let cookie = "", pages = 0, records = [];
  try {
    const credentials = await credentialPrompt();
    const login = await fetchImpl(target.api + "/api/admin/login", {
      method: "POST", headers: { Origin: target.app, "content-type": "application/json" },
      body: JSON.stringify(credentials)
    });
    if (!login.ok) throw new Error("管理员认证失败");
    const setCookie = login.headers.get("set-cookie") || "";
    cookie = setCookie.split(";")[0];
    if (!cookie.startsWith("__Host-qd58_admin=") || cookie.endsWith("=")) throw new Error("管理员会话未正确建立");
    let cursor = null;
    do {
      if (++pages > MAX_PAGES) throw new Error("删除台账分页超限");
      const url = new URL(target.api + "/api/admin/account-deletion-ledger/export");
      url.searchParams.set("limit", "1000");
      if (cursor) url.searchParams.set("cursor", cursor);
      const pageResponse = await fetchImpl(url.toString(), { method: "GET", headers: { Origin: target.app, Cookie: cookie } });
      if (!pageResponse.ok) throw new Error("读取删除台账失败：" + pageResponse.status);
      const page = await pageResponse.json();
      if (page?.schemaVersion !== 1 || !Array.isArray(page.records) || typeof page.truncated !== "boolean") {
        throw new Error("删除台账分页响应无效");
      }
      for (const record of page.records) records.push(validateIntent(record));
      if (records.length > MAX_RECORDS) throw new Error("删除台账记录超限");
      if (page.truncated) {
        if (typeof page.cursor !== "string" || !page.cursor) throw new Error("分页游标缺失");
        cursor = page.cursor;
      } else {
        if (page.cursor !== null) throw new Error("最后一页游标应为空");
        cursor = null;
      }
    } while (cursor);
    records.sort((a, b) => a.userId.localeCompare(b.userId));
    const userIds = new Set(), eventIds = new Set();
    for (const record of records) {
      if (userIds.has(record.userId) || eventIds.has(record.eventId)) throw new Error("删除台账包含重复用户或事件 ID");
      userIds.add(record.userId); eventIds.add(record.eventId);
    }
    const snapshotSha256 = hashHex(JSON.stringify(records));
    const snapshot = {
      schemaVersion: 1, complete: true, pageCount: pages,
      recordCount: records.length, snapshotSha256, records
    };
    const bytes = JSON.stringify(snapshot, null, 2) + "\n";
    await writeFileImpl(outPath, bytes, { encoding: "utf8", flag: "wx", mode: 0o600 });
    output("已导出 " + records.length + " 条删除意图，分页 " + pages + " 页，SHA-256 " + snapshotSha256 + "。文件：" + outPath);
    return snapshot;
  } finally {
    if (cookie) {
      try { await fetchImpl(target.api + "/api/admin/logout", {
        method: "POST", headers: { Origin: target.app, Cookie: cookie }
      }); } catch { /* session expiry remains the fallback */ }
    }
  }
}

if (process.argv[1] && import.meta.url === pathToURL(resolve(process.argv[1])).href) {
  runExport({ argv: process.argv.slice(2) }).catch(error => {
    console.error(error?.message || "导出失败");
    process.exitCode = 1;
  });
}

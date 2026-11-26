import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCatalogImportManifest } from "../backend/src/university-catalog-import.js";

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!["--catalog", "--plan", "--out"].includes(key) ||
        !argv[index + 1] || argv[index + 1].startsWith("--")) {
      throw new Error(
        "用法：node scripts/prepare-university-catalog-import.mjs " +
        "--catalog <catalog.json> --plan <plan.json> --out <manifest.json>"
      );
    }
    values[key] = argv[index + 1];
    index += 1;
  }
  if (!values["--catalog"] || !values["--plan"] || !values["--out"]) {
    throw new Error("必须提供 --catalog、--plan 和 --out");
  }
  return values;
}

async function runCli() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const catalogText = readFileSync(resolve(args["--catalog"]), "utf8");
    const plan = JSON.parse(readFileSync(resolve(args["--plan"]), "utf8"));
    const catalog = JSON.parse(catalogText);
    const manifest = await buildCatalogImportManifest(catalog, plan, catalogText);
    if (manifest.already_applied) {
      console.log("该版本已在 dry-run 快照中标记为 applied；无需生成写入清单。");
      return;
    }
    const output = JSON.stringify(manifest, null, 2) + "\n";
    writeFileSync(resolve(args["--out"]), output, { encoding: "utf8", flag: "wx" });
    console.log("已生成高校目录导入清单：" + resolve(args["--out"]));
    console.log("记录数：" + manifest.record_count);
    console.log("原始文件 SHA-256：" + manifest.checksum_sha256);
    console.log("规范化清单 SHA-256：" + manifest.manifest_sha256);
    console.log("注意：该文件只包含高校目录数据，不包含用户、手机号、队伍或 Session；当前不会连接或写入 D1。");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runCli();
}

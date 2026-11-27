import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseSeedArgs } from "../../scripts/profile-catalog-seed-args.js";

assert.deepEqual(parseSeedArgs([]), { targetMode: "", apply: false, dryRun: true, confirmRemote: "" });
assert.deepEqual(parseSeedArgs(["--remote"]), { targetMode: "--remote", apply: false, dryRun: true, confirmRemote: "" });
assert.deepEqual(parseSeedArgs(["--local"]), { targetMode: "--local", apply: false, dryRun: true, confirmRemote: "" });
assert.deepEqual(parseSeedArgs(["--apply", "--local"]), { targetMode: "--local", apply: true, dryRun: false, confirmRemote: "" });
assert.deepEqual(parseSeedArgs(["--apply", "--remote", "--confirm-remote", "qd58-zhuoyue-db"]), { targetMode: "--remote", apply: true, dryRun: false, confirmRemote: "qd58-zhuoyue-db" });
assert.throws(() => parseSeedArgs(["--apply"]), /明确指定/);
assert.throws(() => parseSeedArgs(["--apply", "--remote"]), /confirm-remote/);
assert.throws(() => parseSeedArgs(["--apply", "--remote", "--confirm-remote", "other-db"]), /明确确认目标数据库/);
assert.throws(() => parseSeedArgs(["--remote", "--confirm-remote", "qd58-zhuoyue-db"]), /仅用于明确的写入模式/);
assert.throws(() => parseSeedArgs(["--confirm-remote", "qd58-zhuoyue-db", "--local"]), /只能与 --remote/);
assert.throws(() => parseSeedArgs(["--remote", "--local"]), /不能同时使用/);
assert.throws(() => parseSeedArgs(["--apply", "--dry-run", "--local"]), /不能同时使用/);
assert.throws(() => parseSeedArgs(["--remote", "--remote"]), /参数重复/);
assert.throws(() => parseSeedArgs(["--unknown"]), /不支持的参数/);

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const script=path.join(ROOT,"scripts/seed-profile-catalog.mjs");
const preview=spawnSync(process.execPath,[script,"--remote"],{cwd:ROOT,encoding:"utf8"});
assert.equal(preview.status,0,preview.stderr);
assert.match(preview.stdout,/未调用 Wrangler/);
assert.match(preview.stdout,/仅预览/);
assert.doesNotMatch(preview.stdout,/完成 \d+\//);
const unsafeRemote=spawnSync(process.execPath,[script,"--apply","--remote"],{cwd:ROOT,encoding:"utf8"});
assert.equal(unsafeRemote.status,2);
assert.match(unsafeRemote.stderr,/confirm-remote/);

console.log("profile-catalog-seed-safety-smoke: all assertions passed");

import { execFileSync } from "node:child_process";
import { mkdtemp, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import {
  decryptBackupPart, encryptBackupPart, getBackupMasterKey, signBackupManifest,
  unwrapBackupDataKey, verifyBackupManifest, wrapBackupDataKey
} from "../backend/src/d1-backup-crypto.js";
import { normalizeD1ExportResponse } from "../backend/src/d1-backup-export.js";

const API_ROOT = "https://api.cloudflare.com/client/v4";
const BUCKET = process.env.R2_BUCKET || "qd58-d1-backups";
const CHUNK_BYTES = 8 * 1024 * 1024;
const MANIFEST_PREFIX = "d1-backups/v1/manifests/";
const MAX_EXPORT_POLLS = 180;
const WAIT_MS = 10_000;

function fail(code) { throw new Error(code); }
function hex(bytes) { return Buffer.from(bytes).toString("hex"); }
function randomId() { return hex(randomBytes(16)); }
function safeError(error) {
  const message = String(error?.message || "");
  return /^backup_[a-z0-9_]{1,80}$/.test(message) ? message : "backup_action_failed";
}
function validateBackupId(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{32}$/.test(value)) fail("backup_id_invalid");
  return value;
}
function objectKey(backupId) {
  validateBackupId(backupId);
  return "d1-backups/v1/objects/" + backupId + ".qd58enc";
}
function manifestKey(backupId) {
  validateBackupId(backupId);
  return MANIFEST_PREFIX + backupId + ".json";
}
function s3Uri(key) {
  return "s3://" + BUCKET + "/" + key;
}
function endpoint() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || "";
  if (!/^[a-f0-9]{32}$/i.test(accountId)) fail("backup_account_id_invalid");
  return "https://" + accountId + ".r2.cloudflarestorage.com";
}
function requiredEnv(name) {
  const value = process.env[name];
  if (typeof value !== "string" || !value.trim()) fail("backup_" + name.toLowerCase() + "_missing");
  return value;
}
function aws(args) {
  try {
    return execFileSync("aws", [...args, "--endpoint-url", endpoint(), "--no-cli-pager"], {
      encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        AWS_DEFAULT_REGION: "auto",
        AWS_REGION: "auto",
        AWS_EC2_METADATA_DISABLED: "true"
      }
    });
  } catch {
    fail("backup_r2_command_failed");
  }
}
function awsUpload(filePath, key, contentType) {
  aws([
    "s3", "cp", filePath, s3Uri(key),
    "--only-show-errors",
    "--no-progress",
    "--content-type", contentType,
    "--cache-control", "no-store"
  ]);
}
function awsDownload(key, filePath) {
  aws(["s3", "cp", s3Uri(key), filePath, "--only-show-errors", "--no-progress"]);
}
function awsDelete(key) {
  aws(["s3api", "delete-object", "--bucket", BUCKET, "--key", key, "--output", "json"]);
}
function awsHead(key) {
  try {
    const output = execFileSync("aws", [
      "s3api", "head-object", "--bucket", BUCKET, "--key", key,
      "--endpoint-url", endpoint(), "--no-cli-pager", "--output", "json"
    ], {
      encoding: "utf8", maxBuffer: 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, AWS_DEFAULT_REGION: "auto", AWS_REGION: "auto", AWS_EC2_METADATA_DISABLED: "true" }
    });
    return JSON.parse(output);
  } catch {
    return null;
  }
}
async function postD1Export(bookmark) {
  const accountId = requiredEnv("CLOUDFLARE_ACCOUNT_ID");
  const apiToken = requiredEnv("CLOUDFLARE_API_TOKEN");
  const databaseId = requiredEnv("D1_DATABASE_ID");
  const body = {
    output_format: "polling",
    dump_options: { compatibility: "d1" },
    ...(bookmark ? { current_bookmark: bookmark } : {})
  };
  let response;
  try {
    response = await fetch(
      API_ROOT + "/accounts/" + encodeURIComponent(accountId) + "/d1/database/" + encodeURIComponent(databaseId) + "/export",
      {
        method: "POST",
        headers: {
          authorization: "Bearer " + apiToken,
          "content-type": "application/json",
          accept: "application/json"
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000)
      }
    );
  } catch {
    fail("backup_d1_export_network_error");
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) fail("backup_d1_export_http_error");
  return normalizeD1ExportResponse(payload);
}
async function wait(ms) {
  await new Promise(resolve => setTimeout(resolve, ms));
}
async function waitForD1Export() {
  let state = await postD1Export("");
  let polls = 0;
  while (state.status !== "complete") {
    if (state.status === "error") fail("backup_d1_export_failed");
    if (!state.bookmark) fail("backup_d1_export_bookmark_missing");
    if (polls >= MAX_EXPORT_POLLS) fail("backup_d1_export_timeout");
    await wait(WAIT_MS);
    state = await postD1Export(state.bookmark);
    polls++;
    console.info("D1 export polling", JSON.stringify({ poll: polls, status: state.status }));
  }
  if (!state.signedUrl || !state.signedUrl.startsWith("https://")) fail("backup_d1_export_download_url_missing");
  return state;
}
async function downloadExport(url, destination) {
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(30 * 60_000) });
  } catch {
    fail("backup_export_download_network_error");
  }
  if (!response.ok || !response.body) fail("backup_export_download_failed");
  const output = await open(destination, "wx", 0o600);
  try {
    for await (const chunk of response.body) {
      let offset = 0;
      const bytes = Buffer.from(chunk);
      while (offset < bytes.length) {
        const result = await output.write(bytes, offset, bytes.length - offset);
        if (!result.bytesWritten) fail("backup_export_file_write_failed");
        offset += result.bytesWritten;
      }
    }
    await output.sync();
  } finally {
    await output.close();
  }
}
async function writeAll(file, bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    const result = await file.write(bytes, offset, bytes.length - offset);
    if (!result.bytesWritten) fail("backup_encrypted_file_write_failed");
    offset += result.bytesWritten;
  }
}
async function encryptExportFile(sourcePath, destinationPath, backupId, dataKeyBytes) {
  const input = await open(sourcePath, "r");
  const output = await open(destinationPath, "wx", 0o600);
  const parts = [];
  let sourcePosition = 0;
  let plaintextBytes = 0;
  let ciphertextBytes = 0;
  try {
    const sourceInfo = await input.stat();
    while (sourcePosition < sourceInfo.size) {
      const length = Math.min(CHUNK_BYTES, sourceInfo.size - sourcePosition);
      const buffer = Buffer.allocUnsafe(length);
      const result = await input.read(buffer, 0, length, sourcePosition);
      if (result.bytesRead !== length) fail("backup_export_file_truncated");
      const plaintext = new Uint8Array(buffer);
      const partNumber = parts.length + 1;
      const encrypted = await encryptBackupPart(
        dataKeyBytes, backupId, partNumber, plaintext
      );
      await writeAll(output, Buffer.from(encrypted.ciphertext));
      parts.push({
        partNumber,
        plainBytes: encrypted.plainBytes,
        cipherBytes: encrypted.cipherBytes,
        nonce: encrypted.nonce,
        sha256: encrypted.sha256
      });
      sourcePosition += length;
      plaintextBytes += length;
      ciphertextBytes += encrypted.cipherBytes;
    }
    if (!parts.length) fail("backup_export_empty");
    await output.sync();
  } finally {
    await input.close();
    await output.close();
  }
  return { parts, plaintextBytes, ciphertextBytes };
}
async function verifyEncryptedFile(filePath, manifest, masterBytes) {
  const info = await stat(filePath);
  if (info.size !== Number(manifest.ciphertextBytes)) fail("backup_object_size_mismatch");
  const dataKeyBytes = await unwrapBackupDataKey(manifest.wrappedKey, manifest.backupId, masterBytes);
  const input = await open(filePath, "r");
  let position = 0;
  let plainTotal = 0;
  let cipherTotal = 0;
  try {
    for (let index = 0; index < manifest.parts.length; index++) {
      const part = manifest.parts[index];
      if (!part || part.partNumber !== index + 1 ||
          !Number.isSafeInteger(part.cipherBytes) || part.cipherBytes !== part.plainBytes + 16) {
        fail("backup_manifest_parts_invalid");
      }
      const encrypted = Buffer.allocUnsafe(part.cipherBytes);
      let offset = 0;
      while (offset < encrypted.length) {
        const result = await input.read(encrypted, offset, encrypted.length - offset, position + offset);
        if (!result.bytesRead) fail("backup_ciphertext_truncated");
        offset += result.bytesRead;
      }
      position += encrypted.length;
      const plaintext = await decryptBackupPart(dataKeyBytes, manifest.backupId, {
        ...part, ciphertext: new Uint8Array(encrypted)
      });
      plainTotal += plaintext.byteLength;
      cipherTotal += encrypted.byteLength;
    }
    const trailing = Buffer.alloc(1);
    const extra = await input.read(trailing, 0, 1, position);
    if (extra.bytesRead) fail("backup_ciphertext_trailing_data");
  } finally {
    await input.close();
  }
  if (plainTotal !== Number(manifest.plaintextBytes) ||
      cipherTotal !== Number(manifest.ciphertextBytes)) fail("backup_size_integrity_failed");
  return { partsVerified: manifest.parts.length, plaintextBytes: plainTotal, ciphertextBytes: cipherTotal };
}
async function currentMaster(keyVersion) {
  return getBackupMasterKey(process.env, keyVersion);
}
async function uploadManifest(manifest, tempDir) {
  const master = await currentMaster(manifest.keyVersion);
  const signed = await signBackupManifest(manifest, master);
  const path = join(tempDir, "manifest-" + manifest.backupId + ".json");
  await writeFile(path, JSON.stringify(signed), { mode: 0o600, flag: "w" });
  awsUpload(path, manifestKey(manifest.backupId), "application/json");
  return signed;
}
async function downloadManifest(backupId, tempDir) {
  const path = join(tempDir, "manifest-read-" + backupId + ".json");
  awsDownload(manifestKey(backupId), path);
  const manifest = JSON.parse(await readFile(path, "utf8"));
  if (manifest?.backupId !== backupId || manifest?.format !== "qd58-d1-backup" ||
      manifest?.schemaVersion !== 1 || manifestKey(backupId) !== manifestKey(manifest.backupId)) {
    fail("backup_manifest_invalid");
  }
  const master = await currentMaster(manifest.keyVersion);
  if (!(await verifyBackupManifest(manifest, master))) fail("backup_manifest_signature_invalid");
  return manifest;
}
async function readManifestEntries(tempDir) {
  const entries = [];
  let token = "";
  do {
    const args = [
      "s3api", "list-objects-v2", "--bucket", BUCKET,
      "--prefix", MANIFEST_PREFIX, "--max-keys", "1000", "--output", "json"
    ];
    if (token) args.push("--continuation-token", token);
    const parsed = JSON.parse(aws(args));
    for (const object of parsed.Contents || []) {
      if (typeof object.Key === "string" && object.Key.startsWith(MANIFEST_PREFIX) &&
          object.Key.endsWith(".json")) entries.push(object.Key);
    }
    token = parsed.IsTruncated ? String(parsed.NextContinuationToken || "") : "";
    if (parsed.IsTruncated && !token) fail("backup_r2_pagination_invalid");
  } while (token);
  return entries;
}
async function pruneExpiredBackups(tempDir, currentBackupId) {
  const configured = Number(process.env.BACKUP_RETENTION_DAYS || 30);
  const retentionDays = Number.isFinite(configured) ? Math.min(365, Math.max(7, Math.floor(configured))) : 30;
  const cutoff = Date.now() - retentionDays * 86_400_000;
  const entries = await readManifestEntries(tempDir);
  const manifests = [];
  for (let index = 0; index < entries.length; index++) {
    const key = entries[index];
    const backupId = key.slice(MANIFEST_PREFIX.length, -5);
    if (!/^[a-f0-9]{32}$/.test(backupId)) continue;
    try {
      const manifest = await downloadManifest(backupId, tempDir);
      const created = Date.parse(manifest.createdAt || "");
      if (!Number.isFinite(created)) continue;
      if (manifest.status === "running" && created < Date.now() - 86_400_000) {
        const stale = {
          ...manifest, status: "failed", failedAt: new Date().toISOString(),
          errorCode: "backup_runner_interrupted"
        };
        await uploadManifest(stale, tempDir);
        manifests.push(stale);
      } else {
        manifests.push(manifest);
      }
    } catch (error) {
      console.warn("Retention skipped an unreadable backup manifest", safeError(error));
    }
  }
  const validCompleted = manifests
    .filter(item => item.status === "completed" && item.backupId !== currentBackupId)
    .sort((a,b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const newestCompletedId = validCompleted[0]?.backupId || currentBackupId;
  let deleted = 0;
  for (const manifest of manifests) {
    const created = Date.parse(manifest.createdAt);
    if (!Number.isFinite(created) || created >= cutoff || manifest.status === "running") continue;
    if (manifest.status === "completed" && manifest.backupId === newestCompletedId) continue;
    if (manifest.objectKey) awsDelete(manifest.objectKey);
    awsDelete(manifestKey(manifest.backupId));
    deleted++;
  }
  return { deleted, retentionDays };
}
async function markFailed(manifest, error, tempDir) {
  if (!manifest) return;
  try {
    await uploadManifest({
      ...manifest,
      status: "failed",
      failedAt: new Date().toISOString(),
      errorCode: safeError(error)
    }, tempDir);
  } catch {
    console.error("Backup failure state could not be recorded in R2.");
  }
}
async function backup(tempDir, backupId, requestedBy, requestedAt) {
  const master = await currentMaster("v1");
  const manifest = {
    format: "qd58-d1-backup",
    schemaVersion: 1,
    backupId,
    status: "running",
    source: process.env.BACKUP_SOURCE === "manual" || requestedBy ? "manual" : "scheduled",
    requestedBy: requestedBy || null,
    workflowInstanceId: null,
    createdAt: requestedAt || new Date().toISOString(),
    keyVersion: "v1",
    databaseName: "qd58-zhuoyue-db",
    objectKey: objectKey(backupId),
    manifestVersion: 1,
    verification: { status: "not_checked" }
  };
  await uploadManifest(manifest, tempDir);
  try {
    console.info("Starting D1 export", JSON.stringify({ backupId, source: manifest.source }));
    const exportState = await waitForD1Export();
    const sqlPath = join(tempDir, "d1-export.sql");
    const encryptedPath = join(tempDir, "d1-export.qd58enc");
    await downloadExport(exportState.signedUrl, sqlPath);
    const dataKeyBytes = new Uint8Array(randomBytes(32));
    const encrypted = await encryptExportFile(sqlPath, encryptedPath, backupId, dataKeyBytes);
    const wrappedKey = await wrapBackupDataKey(dataKeyBytes, backupId, master, "v1");

    awsUpload(encryptedPath, manifest.objectKey, "application/octet-stream");
    const readBackPath = join(tempDir, "d1-export-readback.qd58enc");
    awsDownload(manifest.objectKey, readBackPath);
    const completedAt = new Date().toISOString();
    const completedManifest = {
      ...manifest,
      status: "completed",
      completedAt,
      plaintextBytes: encrypted.plaintextBytes,
      ciphertextBytes: encrypted.ciphertextBytes,
      partCount: encrypted.parts.length,
      parts: encrypted.parts,
      wrappedKey,
      sourceFilename: "d1-export.sql",
      verification: {
        status: "passed",
        checkedAt: completedAt,
        partsVerified: encrypted.parts.length,
        plaintextBytes: encrypted.plaintextBytes
      }
    };
    const verification = await verifyEncryptedFile(readBackPath, completedManifest, master);
    completedManifest.verification = {
      status: "passed",
      checkedAt: new Date().toISOString(),
      partsVerified: verification.partsVerified,
      plaintextBytes: verification.plaintextBytes
    };
    await uploadManifest(completedManifest, tempDir);
    const retention = await pruneExpiredBackups(tempDir, backupId);
    console.info("D1 backup completed", JSON.stringify({
      backupId,
      plaintextBytes: encrypted.plaintextBytes,
      ciphertextBytes: encrypted.ciphertextBytes,
      partCount: encrypted.parts.length,
      verification: "passed",
      retentionDeleted: retention.deleted
    }));
  } catch (error) {
    await markFailed(manifest, error, tempDir);
    throw error;
  }
}
async function verify(tempDir, backupId) {
  const manifest = await downloadManifest(backupId, tempDir);
  if (manifest.status !== "completed" || !manifest.wrappedKey || !Array.isArray(manifest.parts)) {
    fail("backup_not_ready_for_verification");
  }
  try {
    const encryptedPath = join(tempDir, "verify-" + backupId + ".qd58enc");
    awsDownload(manifest.objectKey, encryptedPath);
    const master = await currentMaster(manifest.keyVersion);
    const result = await verifyEncryptedFile(encryptedPath, manifest, master);
    await uploadManifest({
      ...manifest,
      verification: {
        status: "passed",
        checkedAt: new Date().toISOString(),
        partsVerified: result.partsVerified,
        plaintextBytes: result.plaintextBytes
      }
    }, tempDir);
    console.info("D1 backup verification passed", JSON.stringify({ backupId, partsVerified: result.partsVerified }));
  } catch (error) {
    await uploadManifest({
      ...manifest,
      verification: {
        status: "failed",
        checkedAt: new Date().toISOString(),
        errorCode: safeError(error)
      }
    }, tempDir).catch(() => {});
    throw error;
  }
}
async function main() {
  requiredEnv("R2_ACCESS_KEY_ID");
  requiredEnv("R2_SECRET_ACCESS_KEY");
  requiredEnv("CLOUDFLARE_ACCOUNT_ID");
  requiredEnv("BACKUP_MASTER_KEY_V1");
  const action = process.env.BACKUP_ACTION === "verify" ? "verify" : "backup";
  const backupId = validateBackupId(process.env.BACKUP_ID || randomId());
  const requestedBy = String(process.env.BACKUP_REQUESTED_BY || "").slice(0, 80);
  const requestedAt = String(process.env.BACKUP_REQUESTED_AT || "");
  const tempDir = await mkdtemp(join(tmpdir(), "qd58-d1-backup-"));
  try {
    if (action === "verify") await verify(tempDir, backupId);
    else await backup(tempDir, backupId, requestedBy, requestedAt);
  } finally {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
  }
}
const invoked = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invoked) {
  main().catch(error => {
    console.error("D1 backup action failed:", safeError(error));
    process.exitCode = 1;
  });
}

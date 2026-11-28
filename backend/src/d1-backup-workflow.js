import { WorkflowEntrypoint } from "cloudflare:workers";
import {
  backupManifestKey, backupObjectKey, decryptBackupPart, encryptBackupPart,
  getBackupMasterKey, signBackupManifest, unwrapBackupDataKey,
  wrapBackupDataKey, verifyBackupManifest
} from "./d1-backup-crypto.js";

const API_ROOT = "https://api.cloudflare.com/client/v4";
const CHUNK_BYTES = 8 * 1024 * 1024;
const MAX_PARTS = 6000;

function randomId() {
  return [...crypto.getRandomValues(new Uint8Array(16))]
    .map(value => value.toString(16).padStart(2, "0")).join("");
}
function safeErrorCode(error) {
  const value = String(error?.message || "");
  return /^backup_[a-z0-9_]{1,80}$/.test(value) ? value : "backup_workflow_failed";
}
function concatBytes(parts, size) {
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.byteLength; }
  return result;
}
function normalizeExportResult(payload) {
  const nested = payload?.result || {};
  return {
    status: payload?.status || "pending",
    bookmark: payload?.at_bookmark || "",
    error: payload?.error || "",
    signedUrl: nested.signed_url || "",
    filename: nested.filename || payload?.filename || ""
  };
}
async function cloudflareExport(env, body) {
  const url = API_ROOT + "/accounts/" + encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID) +
    "/d1/database/" + encodeURIComponent(env.D1_DATABASE_ID) + "/export";
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "authorization": "Bearer " + env.CLOUDFLARE_API_TOKEN,
      "content-type": "application/json",
      "accept": "application/json"
    },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success !== true) {
    throw new Error("backup_d1_export_api_failed");
  }
  return normalizeExportResult(payload);
}
async function writeManifest(env, manifest) {
  const master = await getBackupMasterKey(env, manifest.keyVersion);
  const signed = await signBackupManifest(manifest, master);
  await env.D1_BACKUPS.put(backupManifestKey(manifest.backupId), JSON.stringify(signed), {
    httpMetadata: { contentType: "application/json", cacheControl: "no-store" }
  });
  return signed;
}
async function readManifest(env, backupId) {
  const object = await env.D1_BACKUPS.get(backupManifestKey(backupId));
  if (!object) throw new Error("backup_manifest_not_found");
  const manifest = await object.json();
  if (manifest?.backupId !== backupId || manifest?.format !== "qd58-d1-backup" ||
      manifest?.schemaVersion !== 1) throw new Error("backup_manifest_invalid");
  const master = await getBackupMasterKey(env, manifest.keyVersion);
  if (!(await verifyBackupManifest(manifest, master))) throw new Error("backup_manifest_signature_invalid");
  return manifest;
}
async function readNextChunk(reader, state, limit) {
  const pieces = [];
  let size = 0;
  if (state.carry?.byteLength) {
    const take = Math.min(limit, state.carry.byteLength);
    pieces.push(state.carry.subarray(0, take));
    size += take;
    state.carry = state.carry.subarray(take);
  }
  while (size < limit && !state.done) {
    const result = await reader.read();
    if (result.done) { state.done = true; break; }
    const bytes = new Uint8Array(result.value);
    const needed = limit - size;
    if (bytes.byteLength > needed) {
      pieces.push(bytes.subarray(0, needed));
      state.carry = bytes.subarray(needed);
      size += needed;
    } else {
      pieces.push(bytes);
      size += bytes.byteLength;
    }
  }
  if (!size && state.done) return null;
  return concatBytes(pieces, size);
}
async function readExactly(reader, state, length) {
  const pieces = [];
  let size = 0;
  if (state.carry?.byteLength) {
    const take = Math.min(length, state.carry.byteLength);
    pieces.push(state.carry.subarray(0, take));
    state.carry = state.carry.subarray(take);
    size += take;
  }
  while (size < length) {
    if (state.done) throw new Error("backup_ciphertext_truncated");
    const result = await reader.read();
    if (result.done) { state.done = true; break; }
    const bytes = new Uint8Array(result.value);
    const needed = length - size;
    if (bytes.byteLength > needed) {
      pieces.push(bytes.subarray(0, needed));
      state.carry = bytes.subarray(needed);
      size += needed;
    } else {
      pieces.push(bytes);
      size += bytes.byteLength;
    }
  }
  if (size !== length) throw new Error("backup_ciphertext_truncated");
  return concatBytes(pieces, size);
}
async function ensureStreamEnd(reader, state) {
  if (state.carry?.byteLength) throw new Error("backup_ciphertext_trailing_data");
  if (!state.done) {
    const result = await reader.read();
    if (!result.done) throw new Error("backup_ciphertext_trailing_data");
  }
}
async function encryptAndUpload(env, manifest, signedUrl) {
  if (!env.D1_BACKUPS || typeof env.D1_BACKUPS.createMultipartUpload !== "function") {
    throw new Error("backup_r2_not_configured");
  }
  const master = await getBackupMasterKey(env, manifest.keyVersion);
  const dataKeyBytes = crypto.getRandomValues(new Uint8Array(32));
  const download = await fetch(signedUrl);
  if (!download.ok || !download.body) throw new Error("backup_export_download_failed");

  const upload = await env.D1_BACKUPS.createMultipartUpload(manifest.objectKey, {
    httpMetadata: { contentType: "application/octet-stream", cacheControl: "no-store" },
    customMetadata: { format: "qd58-d1-backup-v1", backupId: manifest.backupId }
  });
  const uploadedParts = [];
  const partMetadata = [];
  const reader = download.body.getReader();
  const state = { carry: new Uint8Array(0), done: false };
  let plaintextBytes = 0;
  let ciphertextBytes = 0;
  try {
    for (;;) {
      const plain = await readNextChunk(reader, state, CHUNK_BYTES);
      if (!plain) break;
      const partNumber = partMetadata.length + 1;
      if (partNumber > MAX_PARTS) throw new Error("backup_too_many_parts");
      const encrypted = await encryptBackupPart(dataKeyBytes, manifest.backupId, partNumber, plain);
      const uploaded = await upload.uploadPart(partNumber, encrypted.ciphertext);
      uploadedParts.push(uploaded);
      partMetadata.push({
        partNumber, plainBytes: encrypted.plainBytes, cipherBytes: encrypted.cipherBytes,
        nonce: encrypted.nonce, sha256: encrypted.sha256
      });
      plaintextBytes += encrypted.plainBytes;
      ciphertextBytes += encrypted.cipherBytes;
    }
    if (!partMetadata.length) {
      const encrypted = await encryptBackupPart(dataKeyBytes, manifest.backupId, 1, new Uint8Array(0));
      const uploaded = await upload.uploadPart(1, encrypted.ciphertext);
      uploadedParts.push(uploaded);
      partMetadata.push({
        partNumber: 1, plainBytes: 0, cipherBytes: encrypted.cipherBytes,
        nonce: encrypted.nonce, sha256: encrypted.sha256
      });
      ciphertextBytes = encrypted.cipherBytes;
    }
    await upload.complete(uploadedParts);
  } catch (error) {
    try { await upload.abort(); } catch {}
    throw error;
  } finally {
    try { await reader.cancel(); } catch {}
  }

  const wrappedKey = await wrapBackupDataKey(dataKeyBytes, manifest.backupId, master, manifest.keyVersion);
  const completedAt = new Date().toISOString();
  const completed = {
    ...manifest,
    status: "completed",
    completedAt,
    plaintextBytes,
    ciphertextBytes,
    partCount: partMetadata.length,
    parts: partMetadata,
    wrappedKey,
    sourceFilename: String(new URL(signedUrl).pathname.split("/").pop() || "d1-export.sql").slice(0, 120)
  };
  await writeManifest(env, completed);
  return { backupId: manifest.backupId, plaintextBytes, ciphertextBytes, partCount: partMetadata.length, completedAt };
}
async function pruneExpiredBackups(env) {
  const retentionDays = Math.min(365, Math.max(7, Number(env.BACKUP_RETENTION_DAYS || 30)));
  const cutoff = Date.now() - retentionDays * 86400000;
  let cursor;
  let deleted = 0;
  do {
    const page = await env.D1_BACKUPS.list({ prefix: "d1-backups/v1/manifests/", limit: 1000, ...(cursor ? { cursor } : {}) });
    for (const item of page.objects || []) {
      const object = await env.D1_BACKUPS.get(item.key);
      if (!object) continue;
      try {
        const manifest = await object.json();
        if (!manifest?.backupId || manifest.status === "running" ||
            !Number.isFinite(Date.parse(manifest.createdAt)) || Date.parse(manifest.createdAt) >= cutoff) continue;
        const master = await getBackupMasterKey(env, manifest.keyVersion);
        if (!(await verifyBackupManifest(manifest, master))) continue;
        if (manifest.objectKey) await env.D1_BACKUPS.delete(manifest.objectKey);
        await env.D1_BACKUPS.delete(item.key);
        deleted++;
      } catch (error) {
        console.error("Backup retention skipped an unreadable manifest", safeErrorCode(error));
      }
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return { deleted, retentionDays };
}
async function verifyStoredBackup(env, backupId) {
  const manifest = await readManifest(env, backupId);
  if (manifest.status !== "completed" || !manifest.wrappedKey || !Array.isArray(manifest.parts)) {
    throw new Error("backup_not_ready_for_verification");
  }
  const object = await env.D1_BACKUPS.get(manifest.objectKey);
  if (!object?.body || Number(object.size) !== Number(manifest.ciphertextBytes)) {
    throw new Error("backup_object_missing_or_size_mismatch");
  }
  const master = await getBackupMasterKey(env, manifest.keyVersion);
  const dataKeyBytes = await unwrapBackupDataKey(manifest.wrappedKey, backupId, master);
  const reader = object.body.getReader();
  const state = { carry: new Uint8Array(0), done: false };
  let totalPlain = 0;
  let totalCipher = 0;
  try {
    for (let index = 0; index < manifest.parts.length; index++) {
      const part = manifest.parts[index];
      if (part.partNumber !== index + 1 || part.cipherBytes !== part.plainBytes + 16) {
        throw new Error("backup_manifest_parts_invalid");
      }
      const ciphertext = await readExactly(reader, state, part.cipherBytes);
      const plaintext = await decryptBackupPart(dataKeyBytes, backupId, { ...part, ciphertext });
      totalPlain += plaintext.byteLength;
      totalCipher += ciphertext.byteLength;
    }
    await ensureStreamEnd(reader, state);
  } finally {
    try { await reader.cancel(); } catch {}
  }
  if (totalPlain !== Number(manifest.plaintextBytes) || totalCipher !== Number(manifest.ciphertextBytes)) {
    throw new Error("backup_size_integrity_failed");
  }
  const checkedAt = new Date().toISOString();
  const updated = {
    ...manifest,
    verification: { status: "passed", checkedAt, partsVerified: manifest.parts.length, plaintextBytes: totalPlain }
  };
  await writeManifest(env, updated);
  return { backupId, checkedAt, partsVerified: manifest.parts.length, plaintextBytes: totalPlain };
}
async function failManifest(env, backupId, error, action) {
  try {
    const manifest = await readManifest(env, backupId);
    if (action === "verify" && manifest.status === "completed") {
      await writeManifest(env, {
        ...manifest,
        verification: { status: "failed", checkedAt: new Date().toISOString(), errorCode: safeErrorCode(error) }
      });
    } else {
      await writeManifest(env, {
        ...manifest, status: "failed", failedAt: new Date().toISOString(), errorCode: safeErrorCode(error)
      });
    }
  } catch (writeError) {
    console.error("Backup failure status could not be recorded", safeErrorCode(writeError));
  }
}

export class D1BackupWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    const payload = event.payload || {};
    const action = payload.action === "verify" ? "verify" : "backup";
    const backupId = typeof payload.backupId === "string" && /^[a-f0-9]{32}$/.test(payload.backupId)
      ? payload.backupId : randomId();

    if (!this.env.D1_BACKUPS || !this.env.CLOUDFLARE_ACCOUNT_ID ||
        !this.env.CLOUDFLARE_API_TOKEN || !this.env.D1_DATABASE_ID) {
      throw new Error("backup_configuration_incomplete");
    }

    if (action === "verify") {
      try {
        return await step.do("verify-encrypted-backup", { timeout: "30 minutes" }, async () => {
          return await verifyStoredBackup(this.env, backupId);
        });
      } catch (error) {
        await failManifest(this.env, backupId, error, "verify");
        throw error;
      }
    }

    const keyVersion = String(this.env.BACKUP_ACTIVE_KEY_VERSION || "v1");
    const manifest = {
      format: "qd58-d1-backup",
      schemaVersion: 1,
      backupId,
      status: "running",
      source: event.schedule ? "scheduled" : (payload.source === "manual" ? "manual" : "system"),
      requestedBy: typeof payload.requestedBy === "string" ? payload.requestedBy : null,
      workflowInstanceId: event.instanceId,
      createdAt: event.schedule ? new Date(event.schedule.scheduledTime).toISOString() : new Date().toISOString(),
      keyVersion,
      databaseName: String(this.env.D1_DATABASE_NAME || "qd58-zhuoyue-db"),
      objectKey: backupObjectKey(backupId),
      manifestVersion: 1,
      verification: { status: "not_checked" }
    };
    try {
      await getBackupMasterKey(this.env, keyVersion);
      await step.do("create-running-manifest", async () => {
        await writeManifest(this.env, manifest);
        return { backupId, status: "running" };
      });

      let exportState = await step.do("start-d1-export", async () => {
        try {
          return { ok: true, value: await cloudflareExport(this.env, { output_format: "polling", dump_options: { compatibility: "d1" } }) };
        } catch {
          return { ok: false, errorCode: "backup_d1_export_start_failed" };
        }
      });
      if (!exportState.ok) throw new Error(exportState.errorCode);

      let pollCount = 0;
      while (exportState.value.status !== "complete") {
        if (exportState.value.status === "error") throw new Error("backup_d1_export_failed");
        if (!exportState.value.bookmark) throw new Error("backup_d1_export_bookmark_missing");
        if (pollCount >= 180) throw new Error("backup_d1_export_timeout");
        await step.sleep("wait-for-d1-export-" + pollCount, 10000);
        const bookmark = exportState.value.bookmark;
        exportState = await step.do("poll-d1-export-" + pollCount, async () => ({
          ok: true,
          value: await cloudflareExport(this.env, {
            output_format: "polling",
            current_bookmark: bookmark,
            dump_options: { compatibility: "d1" }
          })
        }));
        pollCount++;
      }
      if (!exportState.value.signedUrl || !exportState.value.signedUrl.startsWith("https://")) {
        throw new Error("backup_d1_export_download_url_missing");
      }
      await step.do("encrypt-and-store-d1-export", { timeout: "30 minutes", retries: { limit: 1, delay: "15 seconds", backoff: "constant" } }, async () => {
        return await encryptAndUpload(this.env, manifest, exportState.value.signedUrl);
      });
      const completed = await readManifest(this.env, backupId);
      const retention = await step.do("prune-expired-backups", async () => {
        try { return { ok: true, ...(await pruneExpiredBackups(this.env)) }; }
        catch (error) {
          console.error("Backup retention cleanup failed", safeErrorCode(error));
          return { ok: false, deleted: 0, errorCode: safeErrorCode(error) };
        }
      });
      return {
        backupId, status: completed.status,
        plaintextBytes: completed.plaintextBytes,
        ciphertextBytes: completed.ciphertextBytes,
        partCount: completed.partCount,
        retentionDeleted: retention.deleted,
        retentionWarning: retention.ok ? null : retention.errorCode
      };
    } catch (error) {
      await failManifest(this.env, backupId, error, "backup");
      throw error;
    }
  }
}

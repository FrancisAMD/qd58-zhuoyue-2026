const LOCK_KEY = "d1-backups/v1/locks/export.json";
const DEFAULT_LEASE_MS = 2 * 60 * 60 * 1000;

function lockError(code) { throw new Error(code); }
function etagCondition(etag) {
  if (typeof etag !== "string" || !etag) lockError("backup_export_lock_etag_missing");
  return new Headers({ "If-Match": '"' + etag.replace(/^"|"$/g,"") + '"' });
}
async function readLock(bucket) {
  const object = await bucket.get(LOCK_KEY);
  if (!object) return null;
  let record;
  try { record = await object.json(); } catch { lockError("backup_export_lock_corrupt"); }
  if (!record || record.schemaVersion !== 1 ||
      typeof record.ownerId !== "string" ||
      !Number.isFinite(record.leaseExpiresAt)) lockError("backup_export_lock_corrupt");
  return { object, record };
}
function lockRecord(ownerId, leaseExpiresAt, timestamp) {
  return JSON.stringify({
    schemaVersion:1,ownerId,leaseExpiresAt,updatedAt:new Date(timestamp).toISOString()
  });
}
export async function acquireD1ExportLock(bucket, ownerId, timestamp=Date.now(), leaseMs=DEFAULT_LEASE_MS) {
  if (!bucket || typeof bucket.put!=="function" || typeof bucket.get!=="function" ||
      typeof ownerId!=="string" || !ownerId ||
      !Number.isFinite(timestamp) || !Number.isFinite(leaseMs) || leaseMs<60000) {
    lockError("backup_export_lock_invalid");
  }
  const leaseExpiresAt = timestamp + leaseMs;
  const body = lockRecord(ownerId,leaseExpiresAt,timestamp);
  const created = await bucket.put(LOCK_KEY,body,{
    onlyIf:new Headers({"If-None-Match":"*"}),
    httpMetadata:{contentType:"application/json",cacheControl:"no-store"}
  });
  if (created) return {ownerId,leaseExpiresAt,etag:created.etag||""};

  const existing = await readLock(bucket);
  if (!existing) {
    const retry = await bucket.put(LOCK_KEY,body,{
      onlyIf:new Headers({"If-None-Match":"*"}),
      httpMetadata:{contentType:"application/json",cacheControl:"no-store"}
    });
    if (retry) return {ownerId,leaseExpiresAt,etag:retry.etag||""};
    lockError("backup_export_lock_busy");
  }
  if (existing.record.ownerId===ownerId && existing.record.leaseExpiresAt>timestamp) {
    return {ownerId,leaseExpiresAt:existing.record.leaseExpiresAt,etag:existing.object.etag||""};
  }
  if (existing.record.ownerId && existing.record.leaseExpiresAt>timestamp) {
    lockError("backup_export_already_running");
  }
  const replaced = await bucket.put(LOCK_KEY,body,{
    onlyIf:etagCondition(existing.object.etag),
    httpMetadata:{contentType:"application/json",cacheControl:"no-store"}
  });
  if (!replaced) lockError("backup_export_lock_busy");
  return {ownerId,leaseExpiresAt,etag:replaced.etag||""};
}
export async function renewD1ExportLock(bucket, ownerId, timestamp=Date.now(), leaseMs=DEFAULT_LEASE_MS) {
  const existing = await readLock(bucket);
  if (!existing || existing.record.ownerId!==ownerId || existing.record.leaseExpiresAt<=timestamp) {
    lockError("backup_export_lock_lost");
  }
  const leaseExpiresAt=timestamp+leaseMs;
  const updated=await bucket.put(LOCK_KEY,lockRecord(ownerId,leaseExpiresAt,timestamp),{
    onlyIf:etagCondition(existing.object.etag),
    httpMetadata:{contentType:"application/json",cacheControl:"no-store"}
  });
  if (!updated) lockError("backup_export_lock_lost");
  return {ownerId,leaseExpiresAt,etag:updated.etag||""};
}
export async function releaseD1ExportLock(bucket, ownerId, timestamp=Date.now()) {
  const existing = await readLock(bucket);
  if (!existing || existing.record.ownerId!==ownerId) return false;
  const released=await bucket.put(LOCK_KEY,lockRecord("",0,timestamp),{
    onlyIf:etagCondition(existing.object.etag),
    httpMetadata:{contentType:"application/json",cacheControl:"no-store"}
  });
  return !!released;
}

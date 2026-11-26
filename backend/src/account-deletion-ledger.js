const PREFIX = "account-deletion-intents/v1/";
const USER_ID = /^[a-f0-9]{32}$/;
const EVENT_ID = /^[a-f0-9]{32}$/;

function fail(code) { throw new Error(code); }
function hex(bytes) { return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, "0")).join(""); }
async function digest(value) {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}
function validTimestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) &&
    new Date(Date.parse(value)).toISOString() === value;
}
function keyFor(userId) { return PREFIX + userId + ".json"; }

async function validateStoredIntent(value, key) {
  let record;
  try { record = JSON.parse(value); } catch { fail("deletion_ledger_corrupt"); }
  if (!record || typeof record !== "object" || Array.isArray(record) ||
      Object.keys(record).sort().join(",") !== "eventId,payloadSha256,requestedAt,schemaVersion,userId" ||
      record.schemaVersion !== 1 || !USER_ID.test(record.userId || "") ||
      !EVENT_ID.test(record.eventId || "") || !validTimestamp(record.requestedAt) ||
      typeof record.payloadSha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(record.payloadSha256) ||
      key !== keyFor(record.userId)) fail("deletion_ledger_corrupt");
  const base = {
    schemaVersion: record.schemaVersion,
    userId: record.userId,
    requestedAt: record.requestedAt,
    eventId: record.eventId
  };
  if (await digest(JSON.stringify(base)) !== record.payloadSha256) fail("deletion_ledger_corrupt");
  return record;
}

export async function recordDeletionIntent(bucket, userId, requestedAt, eventId) {
  if (!bucket || typeof bucket.put !== "function" || typeof bucket.get !== "function") fail("deletion_ledger_unavailable");
  if (!USER_ID.test(userId || "") || !EVENT_ID.test(eventId || "") || !validTimestamp(requestedAt)) fail("deletion_ledger_invalid_input");
  const base = { schemaVersion: 1, userId, requestedAt, eventId };
  const record = { ...base, payloadSha256: await digest(JSON.stringify(base)) };
  const key = keyFor(userId);
  const written = await bucket.put(key, JSON.stringify(record), {
    onlyIf: { etagDoesNotMatch: "*" },
    httpMetadata: { contentType: "application/json", cacheControl: "no-store" }
  });
  if (written) return { record, created: true };
  const existing = await bucket.get(key);
  if (!existing || typeof existing.text !== "function") fail("deletion_ledger_unavailable");
  const stored = await validateStoredIntent(await existing.text(), key);
  if (stored.userId !== userId) fail("deletion_ledger_conflict");
  return { record: stored, created: false };
}

export async function listDeletionIntents(bucket, { limit = 500, cursor } = {}) {
  if (!bucket || typeof bucket.list !== "function" || typeof bucket.get !== "function") fail("deletion_ledger_unavailable");
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000 ||
      (cursor !== undefined && (typeof cursor !== "string" || !cursor))) fail("deletion_ledger_invalid_page");
  const listed = await bucket.list({ prefix: PREFIX, limit, ...(cursor ? { cursor } : {}) });
  const records = [];
  for (const item of listed.objects || []) {
    if (!item || typeof item.key !== "string" || !item.key.startsWith(PREFIX)) fail("deletion_ledger_corrupt");
    const object = await bucket.get(item.key);
    if (!object || typeof object.text !== "function") fail("deletion_ledger_entry_missing");
    records.push(await validateStoredIntent(await object.text(), item.key));
  }
  return {
    records,
    truncated: listed.truncated === true,
    cursor: listed.truncated === true && typeof listed.cursor === "string" ? listed.cursor : null
  };
}

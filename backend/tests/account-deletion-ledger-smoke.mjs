import assert from "node:assert/strict";
import { recordDeletionIntent, listDeletionIntents } from "../src/account-deletion-ledger.js";

function fakeBucket() {
  const objects = new Map();
  return {
    objects,
    async put(key, value, options = {}) {
      if (options.onlyIf?.etagDoesNotMatch === "*" && objects.has(key)) return null;
      objects.set(key, String(value));
      return { key };
    },
    async get(key) {
      const value = objects.get(key);
      return value === undefined ? null : { text: async () => value };
    },
    async list({ prefix = "", limit = 1000, cursor } = {}) {
      const keys = [...objects.keys()].filter(key => key.startsWith(prefix)).sort();
      const start = cursor ? Number(cursor) : 0;
      const page = keys.slice(start, start + limit);
      const next = start + page.length;
      return { objects: page.map(key => ({ key })), truncated: next < keys.length, cursor: next < keys.length ? String(next) : undefined };
    }
  };
}
const bucket = fakeBucket();
const id1 = "0123456789abcdef0123456789abcdef";
const id2 = "abcdef0123456789abcdef0123456789";
const event1 = "11111111111111111111111111111111";
const event2 = "22222222222222222222222222222222";
const time1 = "2026-11-26T02:00:00.000Z";

const first = await recordDeletionIntent(bucket, id1, time1, event1);
assert.equal(first.created, true);
assert.equal(first.record.userId, id1);
assert.equal(bucket.objects.size, 1);
assert.equal(JSON.stringify(first.record).includes("phone"), false);
assert.equal(JSON.stringify(first.record).includes("name"), false);

const retry = await recordDeletionIntent(bucket, id1, "2026-11-26T02:01:00.000Z", event2);
assert.equal(retry.created, false);
assert.deepEqual(retry.record, first.record, "a retry must reuse the create-once intent");

await recordDeletionIntent(bucket, id2, time1, event2);
const page1 = await listDeletionIntents(bucket, { limit: 1 });
assert.equal(page1.records.length, 1);
assert.equal(page1.truncated, true);
const page2 = await listDeletionIntents(bucket, { limit: 1, cursor: page1.cursor });
assert.equal(page2.records.length, 1);
assert.equal(page2.truncated, false);
assert.equal(page2.cursor, null);
assert.deepEqual(new Set([...page1.records, ...page2.records].map(item => item.userId)), new Set([id1, id2]));

await assert.rejects(() => recordDeletionIntent(bucket, "not-an-id", time1, event1), /deletion_ledger_invalid_input/);
await assert.rejects(() => listDeletionIntents(bucket, { limit: 0 }), /deletion_ledger_invalid_page/);
const corrupt = fakeBucket();
corrupt.objects.set("account-deletion-intents/v1/" + id1 + ".json", "{broken");
await assert.rejects(() => listDeletionIntents(corrupt), /deletion_ledger_corrupt/);
const missing = fakeBucket();
missing.objects.set("account-deletion-intents/v1/" + id1 + ".json", "{}");
await assert.rejects(() => listDeletionIntents(missing), /deletion_ledger_corrupt/);

console.log("Account deletion ledger tests: PASS (create-once, idempotent retry, checksummed schema, paginated listing, corruption and input rejection).");

import assert from "node:assert/strict";
import worker from "../src/worker.js";

async function runScheduled(env) {
  let pending;
  worker.scheduled({}, env, { waitUntil(promise) { pending = promise; } });
  assert(pending, "scheduled handler must register its work");
  await pending;
}
function mockDb() {
  const state = { batches: 0 };
  return {
    state,
    prepare() { return { bind() { return this; } }; },
    async batch() { state.batches++; return []; }
  };
}
{
  const DB = mockDb();
  const env = {
    DB,
    D1_BACKUPS: {
      async get() {
        return { async json() {
          return { schemaVersion: 1, ownerId: "github-123-1", leaseExpiresAt: Date.now() + 60000 };
        } };
      }
    }
  };
  await runScheduled(env);
  assert.equal(DB.state.batches, 0, "D1 maintenance must pause during active export lease");
}
{
  const DB = mockDb();
  const env = { DB, D1_BACKUPS: { async get() { return null; } } };
  await runScheduled(env);
  assert.equal(DB.state.batches, 2, "both maintenance batches should run when there is no export lease");
}
{
  const DB = mockDb();
  const env = { DB, D1_BACKUPS: { async get() { throw new Error("R2 unavailable"); } } };
  await runScheduled(env);
  assert.equal(DB.state.batches, 0, "maintenance must fail closed if lease state cannot be checked");
}
{
  const DB = mockDb();
  const env = {
    DB,
    D1_BACKUPS: {
      async get() {
        return { async json() {
          return { schemaVersion: 1, ownerId: "", leaseExpiresAt: 0 };
        } };
      }
    }
  };
  await runScheduled(env);
  assert.equal(DB.state.batches, 2, "an explicitly released/expired lease should allow maintenance");
}
console.log("Scheduled D1 maintenance lease tests: PASS (pause during export, run without lease, fail closed on R2 error, resume after lease release).");

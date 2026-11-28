import assert from "node:assert/strict";
import worker from "../src/worker.js";

async function runScheduled(env){
  let pending;
  worker.scheduled({},env,{waitUntil(promise){pending=promise;}});
  assert(pending,"scheduled handler must register its work with waitUntil");
  await pending;
}
function mockDb(){
  const state={prepared:0,batches:0};
  return {
    state,
    prepare(){state.prepared++;return {bind(){return this;},async run(){return {meta:{changes:0}};}};},
    async batch(statements){state.batches++;for(const statement of statements)await statement.run();return [];}
  };
}
{
  const DB=mockDb();
  const env={
    DB,
    D1_BACKUPS:{
      async get(){return {async json(){return {
        schemaVersion:1,ownerId:"workflow-active",leaseExpiresAt:Date.now()+60000
      };}};}
    }
  };
  await runScheduled(env);
  assert.equal(DB.state.prepared,0,"D1 maintenance must pause while an export lease is active");
  assert.equal(DB.state.batches,0);
}
{
  const DB=mockDb();
  const env={DB,D1_BACKUPS:{async get(){return null;}}};
  await runScheduled(env);
  assert.equal(DB.state.batches,2,"transfer expiry and security cleanup should run when no export lease exists");
}
{
  const DB=mockDb();
  const env={DB,D1_BACKUPS:{async get(){throw new Error("R2 temporarily unavailable");}}};
  await runScheduled(env);
  assert.equal(DB.state.prepared,0,"maintenance must fail closed if the export lease cannot be checked");
}
console.log("Scheduled maintenance lock tests: PASS (pause during export, resume without lease, fail closed when R2 lease read fails).");

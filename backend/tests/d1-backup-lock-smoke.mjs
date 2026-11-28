import assert from "node:assert/strict";
import {
  acquireD1ExportLock, releaseD1ExportLock, renewD1ExportLock
} from "../src/d1-backup-lock.js";

function createBucket(){
  const values=new Map();
  let sequence=0;
  return {
    values,
    async get(key){
      const item=values.get(key);
      if(!item)return null;
      return {
        etag:item.etag,
        async json(){return JSON.parse(item.body);},
        async text(){return item.body;}
      };
    },
    async put(key,body,options={}){
      const condition=options.onlyIf;
      const ifNone=condition?.get?.("if-none-match");
      const ifMatch=condition?.get?.("if-match");
      const current=values.get(key);
      if(ifNone==="*"&&current)return null;
      if(ifMatch){
        const expected=ifMatch.replace(/^"|"$/g,"");
        if(!current||current.etag!==expected)return null;
      }
      const etag="etag-"+(++sequence);
      values.set(key,{body:String(body),etag});
      return {etag};
    }
  };
}

const bucket=createBucket();
const now=1_900_000_000_000;
const first=await acquireD1ExportLock(bucket,"workflow-A",now,120000);
assert.equal(first.ownerId,"workflow-A");
assert.equal(first.leaseExpiresAt,now+120000);
await assert.rejects(
  ()=>acquireD1ExportLock(bucket,"workflow-B",now+1000,120000),
  /backup_export_already_running/
);
await assert.rejects(
  ()=>renewD1ExportLock(bucket,"workflow-B",now+2000,120000),
  /backup_export_lock_lost/
);
const renewed=await renewD1ExportLock(bucket,"workflow-A",now+30000,120000);
assert.equal(renewed.leaseExpiresAt,now+150000);
assert.equal(await releaseD1ExportLock(bucket,"workflow-B",now+31000),false);
assert.equal(await releaseD1ExportLock(bucket,"workflow-A",now+32000),true);
const second=await acquireD1ExportLock(bucket,"workflow-B",now+33000,120000);
assert.equal(second.ownerId,"workflow-B");

const staleOwner=await acquireD1ExportLock(bucket,"workflow-C",now+200000,120000);
assert.equal(staleOwner.ownerId,"workflow-C","expired leases may be atomically taken over");

const concurrentBucket=createBucket();
const outcomes=await Promise.allSettled([
  acquireD1ExportLock(concurrentBucket,"parallel-A",now,120000),
  acquireD1ExportLock(concurrentBucket,"parallel-B",now,120000)
]);
assert.equal(outcomes.filter(item=>item.status==="fulfilled").length,1);
assert.equal(outcomes.filter(item=>item.status==="rejected").length,1);
console.log("D1 backup lock tests: PASS (exclusive ownership, renew, owner-only release, stale lease takeover and concurrent acquisition).");

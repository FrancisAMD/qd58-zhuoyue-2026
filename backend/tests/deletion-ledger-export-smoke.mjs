import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import worker from "../src/worker.js";

const ORIGIN = "https://58er.eon21.space";
const API = "https://api.58er.eon21.space";
const TOKEN = "admin-session-token";
const COOKIE = "__Host-qd58_admin=" + TOKEN;
const hash = value => createHash("sha256").update(value).digest("hex");

function record(userId,eventId,requestedAt) {
  const base={schemaVersion:1,userId,requestedAt,eventId};
  return {...base,payloadSha256:hash(JSON.stringify(base))};
}
const records=[
  record("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","11111111111111111111111111111111","2026-11-27T01:00:00.000Z"),
  record("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","22222222222222222222222222222222","2026-11-27T01:01:00.000Z")
];

function fakeBucket(values) {
  const objects=new Map(values.map(value=>["account-deletion-intents/v1/"+value.userId+".json",JSON.stringify(value)]));
  return {
    objects,
    async list({prefix,limit,cursor}) {
      const keys=[...objects.keys()].filter(key=>key.startsWith(prefix)).sort();
      const offset=cursor==="page-2"?1:0;
      const page=keys.slice(offset,offset+limit);
      return {objects:page.map(key=>({key})),truncated:offset+page.length<keys.length,cursor:offset+page.length<keys.length?"page-2":null};
    },
    async get(key) { const value=objects.get(key); return value===undefined?null:{text:async()=>value}; }
  };
}
function fakeDb(role) {
  const audits=[];
  return {
    audits,
    prepare(sql) {
      let args=[];
      return {
        sql,bind(...values){args=values;return this;},
        async first() {
          if(sql.includes("FROM admin_sessions s JOIN admin_users a")) return {id:"admin-test",username:"owner",role};
          return null;
        },
        async run() {
          if(sql.startsWith("INSERT INTO audit_logs")) audits.push(args);
          return {meta:{changes:1}};
        }
      };
    }
  };
}
function request({origin=ORIGIN,cookie=COOKIE,query=""}={}) {
  const headers={origin};
  if(cookie) headers.cookie=cookie;
  return new Request(API+"/api/admin/account-deletion-ledger/export"+query,{method:"GET",headers});
}
async function call(role,flag,req,bucket) {
  return worker.fetch(req,{APP_ORIGIN:ORIGIN,ACCOUNT_DELETION_LEDGER_EXPORT_ENABLED:flag,
    DELETE_LEDGER:bucket,DB:fakeDb(role)});
}

const disabled=await call("owner","false",request(),fakeBucket(records));
assert.equal(disabled.status,503);
const wrongOrigin=await call("owner","true",request({origin:"https://evil.example"}),fakeBucket(records));
assert.equal(wrongOrigin.status,403);
const unauth=await call("owner","true",request({cookie:""}),fakeBucket(records));
assert.equal(unauth.status,401);
const ordinary=await call("admin","true",request(),fakeBucket(records));
assert.equal(ordinary.status,403);
const invalidLimit=await call("owner","true",request({query:"?limit=1001"}),fakeBucket(records));
assert.equal(invalidLimit.status,400);

const bucket=fakeBucket(records), db=fakeDb("owner");
const first=await worker.fetch(request({query:"?limit=1"}),{
  APP_ORIGIN:ORIGIN,ACCOUNT_DELETION_LEDGER_EXPORT_ENABLED:"true",DELETE_LEDGER:bucket,DB:db
});
assert.equal(first.status,200);
const firstBody=await first.json();
assert.equal(firstBody.schemaVersion,1);
assert.equal(firstBody.records.length,1);
assert.equal(firstBody.truncated,true);
assert.equal(firstBody.cursor,"page-2");
assert.equal(firstBody.records[0].userId,records[0].userId);
assert.equal(first.headers.get("cache-control"),"no-store");
assert.equal(db.audits.length,1);
assert.equal(db.audits[0][3],"admin.account_deletion_ledger.export_page");
assert.ok(!db.audits[0][6].includes(records[0].userId));

const second=await worker.fetch(request({query:"?limit=1&cursor=page-2"}),{
  APP_ORIGIN:ORIGIN,ACCOUNT_DELETION_LEDGER_EXPORT_ENABLED:"true",DELETE_LEDGER:bucket,DB:db
});
assert.equal(second.status,200);
const secondBody=await second.json();
assert.equal(secondBody.records.length,1);
assert.equal(secondBody.truncated,false);
assert.equal(secondBody.cursor,null);

const corruptBucket=fakeBucket(records);
corruptBucket.objects.set("account-deletion-intents/v1/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json","{}");
const corrupt=await call("owner","true",request(),corruptBucket);
assert.equal(corrupt.status,503);

console.log("Deletion ledger export route tests: PASS (flag, origin, owner-only, pagination, no-store, audit minimization, fail-closed corruption).");

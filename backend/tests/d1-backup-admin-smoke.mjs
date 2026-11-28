import assert from "node:assert/strict";
import worker from "../src/worker.js";
import { signBackupManifest, getBackupMasterKey } from "../src/d1-backup-crypto.js";

const ORIGIN="https://58er.eon21.space";
const API="https://api.58er.eon21.space";
const MASTER="c".repeat(64);
const BACKUP_A="11111111111111111111111111111111";
const BACKUP_B="22222222222222222222222222222222";
const FAILED="33333333333333333333333333333333";
const bucketObjects=new Map();
const audits=[];
const workflowCalls=[];
let activeAdmin={id:"owner-1",username:"rootops",role:"owner"};

function objectFor(key,value,bytes=null){
  const raw=bytes||new TextEncoder().encode(JSON.stringify(value));
  return {
    key,size:raw.byteLength,etag:"mock-etag",
    body:new Response(raw).body,
    async json(){return JSON.parse(new TextDecoder().decode(raw));},
    async text(){return new TextDecoder().decode(raw)},
    async arrayBuffer(){return raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength);}
  };
}
const bucket={
  async get(key){return bucketObjects.get(key)||null;},
  async put(key,value){const raw=typeof value==="string"?new TextEncoder().encode(value):new Uint8Array(value);bucketObjects.set(key,objectFor(key,null,raw));return {key};},
  async delete(key){bucketObjects.delete(key);},
  async head(key){return bucketObjects.get(key)||null;},
  async list({prefix,limit=100}){return {objects:[...bucketObjects.keys()].filter(key=>key.startsWith(prefix)).slice(0,limit).map(key=>({key})),truncated:false,cursor:null};}
};
const db={
  prepare(sql){
    return {
      args:[],
      bind(...args){this.args=args;return this;},
      async first(){
        if(sql.includes("FROM admin_sessions"))return activeAdmin;
        return null;
      },
      async run(){audits.push({sql,args:this.args});return {meta:{changes:1}};}
    };
  }
};
const workflow={
  async create(options){workflowCalls.push(options);return {id:options.id,status:async()=>"queued"};}
};
async function putManifest(id,status,createdAt) {
  const master=await getBackupMasterKey({BACKUP_MASTER_KEY_V1:MASTER},"v1");
  const manifest={
    format:"qd58-d1-backup",schemaVersion:1,backupId:id,status,
    source:"manual",createdAt,completedAt:status==="completed"?createdAt:"",
    keyVersion:"v1",databaseName:"qd58-zhuoyue-db",
    objectKey:"d1-backups/v1/objects/"+id+".qd58enc",
    plaintextBytes:20,ciphertextBytes:36,partCount:1,
    parts:status==="completed"?[{partNumber:1,plainBytes:20,cipherBytes:36,nonce:"AAAAAAAAAAAAAAAA",sha256:"a".repeat(64)}]:[],
    wrappedKey:status==="completed"?{keyVersion:"v1",nonce:"AAAAAAAAAAAAAAAA",ciphertext:"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="}:null,
    verification:{status:"not_checked"}
  };
  const signed=await signBackupManifest(manifest,master);
  const key="d1-backups/v1/manifests/"+id+".json";
  bucketObjects.set(key,objectFor(key,signed));
  if(status==="completed")bucketObjects.set(manifest.objectKey,objectFor(manifest.objectKey,null,new Uint8Array(36).fill(7)));
}
function request(path,method="GET",body,role="owner"){
  activeAdmin={...activeAdmin,role};
  return new Request(API+path,{
    method,headers:{
      origin:ORIGIN,cookie:"__Host-qd58_admin="+("a".repeat(64)),
      ...(body!==undefined?{"content-type":"application/json"}:{})
    },
    ...(body!==undefined?{body:JSON.stringify(body)}:{})
  });
}
const env={
  APP_ORIGIN:ORIGIN,DB:db,D1_BACKUPS:bucket,D1_BACKUP_WORKFLOW:workflow,
  CLOUDFLARE_ACCOUNT_ID:"account-test",CLOUDFLARE_API_TOKEN:"not-a-real-token",
  D1_DATABASE_ID:"database-test",BACKUP_MASTER_KEY_V1:MASTER
};
const oldFetch=globalThis.fetch;
try{
  await putManifest(BACKUP_A,"completed","2026-11-28T18:00:00.000Z");
  await putManifest(BACKUP_B,"completed","2026-11-27T18:00:00.000Z");
  await putManifest(FAILED,"failed","2026-11-26T18:00:00.000Z");

  const forbidden=await worker.fetch(request("/api/admin/backups","GET",undefined,"admin"),env);
  assert.equal(forbidden.status,403,"ordinary admins must not read backups");
  const forbiddenStart=await worker.fetch(request("/api/admin/backups","POST",{},"admin"),env);
  assert.equal(forbiddenStart.status,403,"ordinary admins must not trigger backups");

  const listed=await worker.fetch(request("/api/admin/backups"),env);
  assert.equal(listed.status,200);
  const listing=await listed.json();
  assert.equal(listing.items.length,3);
  assert.equal(listing.items[0].backupId,BACKUP_A);
  assert.equal(listing.items[0].status,"completed");
  assert.equal(listing.items[0].plaintextBytes,20);

  const start=await worker.fetch(request("/api/admin/backups","POST",{}),env);
  assert.equal(start.status,202);
  const started=await start.json();
  assert.match(started.backupId,/^[a-f0-9]{32}$/);
  assert.equal(workflowCalls.at(-1).params.source,"manual");
  assert.equal(workflowCalls.at(-1).params.requestedBy,"owner-1");

  const manifestResponse=await worker.fetch(request("/api/admin/backups/"+BACKUP_A+"/manifest"),env);
  assert.equal(manifestResponse.status,200);
  assert.equal((await manifestResponse.json()).manifest.backupId,BACKUP_A);

  const download=await worker.fetch(request("/api/admin/backups/"+BACKUP_A+"/download"),env);
  assert.equal(download.status,200);
  assert.match(download.headers.get("content-disposition"),/\.qd58enc/);
  assert.equal((await download.arrayBuffer()).byteLength,36);

  const verify=await worker.fetch(request("/api/admin/backups/"+BACKUP_A+"/verify","POST",{}),env);
  assert.equal(verify.status,202);
  assert.equal(workflowCalls.at(-1).params.action,"verify");
  assert.equal(workflowCalls.at(-1).params.backupId,BACKUP_A);

  const deleteOne=await worker.fetch(request("/api/admin/backups/"+BACKUP_B,"DELETE"),env);
  assert.equal(deleteOne.status,200);
  assert.equal(bucketObjects.has("d1-backups/v1/manifests/"+BACKUP_B+".json"),false);

  const protectLast=await worker.fetch(request("/api/admin/backups/"+BACKUP_A,"DELETE"),env);
  assert.equal(protectLast.status,409);
  assert.equal((await protectLast.json()).error,"backup_last_successful_protected");

  const deleteFailed=await worker.fetch(request("/api/admin/backups/"+FAILED,"DELETE"),env);
  assert.equal(deleteFailed.status,200);
  assert(audits.some(item=>item.args?.[3]==="admin.backup.started"));
  assert(audits.some(item=>item.args?.[3]==="admin.backup.verification_started"));
  assert(audits.some(item=>item.args?.[3]==="admin.backup.deleted"));
  console.log("D1 backup admin tests: PASS (owner-only access, manual trigger, signed manifest, encrypted download, verification trigger, audited deletion and last-good protection).");
} finally {
  globalThis.fetch=oldFetch;
}

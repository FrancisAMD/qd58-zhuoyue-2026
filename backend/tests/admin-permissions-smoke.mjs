import assert from "node:assert/strict";
import worker from "../src/worker.js";

const ORIGIN="https://58er.eon21.space";
const COOKIE="__Host-qd58_admin="+"f".repeat(64);
const OWNER_ID="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const TARGET_ID="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function makeDb({actorRole="owner",target={id:TARGET_ID,role:"viewer"},targetExists=true,deleteChanges=1}={}) {
  const state={queries:[],writes:[],audits:[]};
  const DB={
    prepare(sql){
      let bindings=[];
      return {
        sql,
        bind(...values){bindings=values;return this;},
        async first(){
          state.queries.push({sql,bindings});
          if(sql.startsWith("SELECT a.id,a.username,a.role FROM admin_sessions")) {
            return {id:OWNER_ID,username:"rootops",role:actorRole};
          }
          if(sql.startsWith("SELECT id,role FROM admin_users WHERE id=?")) {
            if(!targetExists)return null;
            if(bindings[0]===OWNER_ID)return {id:OWNER_ID,role:"owner"};
            return target;
          }
          throw new Error("Unexpected first query: "+sql);
        },
        async all(){
          state.queries.push({sql,bindings});
          if(sql.startsWith("SELECT id,username,role,active,created_at AS createdAt")) {
            return {results:[{id:OWNER_ID,username:"rootops",role:"owner",active:1,lastLoginAt:""},{id:TARGET_ID,username:"legacyviewer",role:"viewer",active:1,lastLoginAt:""}]};
          }
          throw new Error("Unexpected all query: "+sql);
        },
        async run(){
          state.writes.push({sql,bindings});
          if(sql.startsWith("DELETE FROM admin_users"))return {meta:{changes:deleteChanges}};
          if(sql.startsWith("INSERT INTO audit_logs"))state.audits.push({sql,bindings});
          return {meta:{changes:1}};
        }
      };
    }
  };
  return {DB,state};
}
function request(path,{method="GET",body}={}) {
  const headers=new Headers({origin:ORIGIN,cookie:COOKIE});
  if(body!==undefined)headers.set("content-type","application/json");
  return new Request(ORIGIN+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
}
async function call(db,path,options={}) {
  return worker.fetch(request(path,options),{APP_ORIGIN:ORIGIN,DB:db});
}

const ownerDb=makeDb();
const ownerMe=await call(ownerDb.DB,"/api/admin/me");
assert.equal(ownerMe.status,200);
const ownerPermissions=(await ownerMe.json()).admin.permissions;
for(const permission of ["people:read","people:export","people:delete","audit:read","admins:manage","universities:import","universities:review","group-chat:manage","donations:manage"]) {
  assert.ok(ownerPermissions.includes(permission),"owner must retain "+permission);
}

const ordinaryDb=makeDb({actorRole:"admin"});
const ordinaryMe=await call(ordinaryDb.DB,"/api/admin/me");
assert.equal(ordinaryMe.status,200);
assert.deepEqual((await ordinaryMe.json()).admin.permissions,["overview","universities:review","group-chat:manage"]);
const deniedList=await call(ordinaryDb.DB,"/api/admin/admins");
assert.equal(deniedList.status,403,"ordinary admins must not manage administrator accounts");
const deniedDelete=await call(ordinaryDb.DB,"/api/admin/admins/"+TARGET_ID,{method:"DELETE"});
assert.equal(deniedDelete.status,403,"ordinary admins must not delete administrator accounts");
assert.equal(ordinaryDb.state.writes.length,0);

const legacyList=await call(ownerDb.DB,"/api/admin/admins");
assert.equal(legacyList.status,200);
assert.ok((await legacyList.json()).items.some(item=>item.role==="viewer"),"owner must be able to see the legacy viewer account to delete it");

const deleteLegacy=await call(ownerDb.DB,"/api/admin/admins/"+TARGET_ID,{method:"DELETE"});
assert.equal(deleteLegacy.status,200);
assert.deepEqual(await deleteLegacy.json(),{ok:true,deleted:true,id:TARGET_ID});
assert.ok(ownerDb.state.writes.some(item=>item.sql.startsWith("DELETE FROM admin_users WHERE id=? AND role IN ('admin','viewer')")));
assert.equal(ownerDb.state.audits.at(-1).bindings[3],"admin.account.deleted");

const ownerTargetDb=makeDb({target:{id:OWNER_ID,role:"owner"}});
const protectedOwner=await call(ownerTargetDb.DB,"/api/admin/admins/"+OWNER_ID,{method:"DELETE"});
assert.equal(protectedOwner.status,403,"owner accounts must never be deletable through this endpoint");
assert.equal(ownerTargetDb.state.writes.length,0);

const missingDb=makeDb({targetExists:false});
const missing=await call(missingDb.DB,"/api/admin/admins/"+TARGET_ID,{method:"DELETE"});
assert.equal(missing.status,404);

const conflictDb=makeDb({deleteChanges:0});
const conflict=await call(conflictDb.DB,"/api/admin/admins/"+TARGET_ID,{method:"DELETE"});
assert.equal(conflict.status,409);

const viewerCreateDb=makeDb();
const viewerCreate=await call(viewerCreateDb.DB,"/api/admin/admins",{method:"POST",body:{username:"newviewer",password:"Very-Strong-Admin-Password",role:"viewer"}});
assert.equal(viewerCreate.status,400,"new viewer roles must no longer be creatable");
assert.equal(viewerCreateDb.state.writes.length,0);

console.log("admin-permissions-smoke: owner-only account management, legacy-viewer deletion, protected owners and reduced ordinary-admin permissions passed");

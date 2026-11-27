import assert from "node:assert/strict";
import worker from "../src/worker.js";

const ORIGIN="https://58er.eon21.space";
const COOKIE="__Host-qd58_admin="+"e".repeat(64);
const USER_ID="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const ADMIN_ID="admin-owner";

function makeDb({role="admin",target=true,otherMembers=0,updateChanges=1}={}){
  const state={queries:[],batches:[]};
  const admin={id:ADMIN_ID,username:"rootops",role};
  const targetUser={id:USER_ID,phone:"13800000000",name:"测试垃圾数据",university_id:"university-1"};
  const DB={
    prepare(sql){
      let bindings=[];
      return {
        sql,
        bind(...values){bindings=values;this.bindings=values;return this;},
        first:async()=>{
          state.queries.push({sql,bindings});
          if(sql.startsWith("SELECT a.id,a.username,a.role FROM admin_sessions"))return admin;
          if(sql.startsWith("SELECT id,phone,university_id,name FROM users WHERE id=?"))return target?targetUser:null;
          if(sql.startsWith("SELECT t.id,")&&sql.includes("AS otherMembers"))return otherMembers===null?null:{id:"team-1",otherMembers};
          throw new Error("Unexpected first query: "+sql);
        }
      };
    },
    async batch(statements){
      state.batches.push(statements.map(item=>({sql:item.sql,bindings:item.bindings})));
      return statements.map((_,index)=>({meta:{changes:index===4?updateChanges:1}}));
    }
  };
  return {DB,state};
}
async function remove(db){
  return worker.fetch(new Request(ORIGIN+"/api/admin/people/"+USER_ID,{
    method:"DELETE",headers:{origin:ORIGIN,cookie:COOKIE}
  }),{APP_ORIGIN:ORIGIN,DB:db});
}

const preflight=await worker.fetch(new Request(ORIGIN+"/api/admin/people/"+USER_ID,{
  method:"OPTIONS",headers:{origin:ORIGIN,"access-control-request-method":"DELETE"}
}),{APP_ORIGIN:ORIGIN});
assert.equal(preflight.status,204);
assert.match(preflight.headers.get("access-control-allow-methods")||"",/DELETE/);

const successDb=makeDb();
const success=await remove(successDb.DB);
assert.equal(success.status,200);
assert.deepEqual(await success.json(),{ok:true,deleted:true,transferHistoryPreserved:true});
const statements=successDb.state.batches[0];
assert.equal(statements.length,7);
assert.ok(statements[0].sql.includes("UPDATE leader_transfers SET status='expired'"));
assert.ok(statements[1].sql.includes("UPDATE teams SET leader_user_id=NULL"));
assert.ok(statements[2].sql.includes("DELETE FROM sessions"));
assert.ok(statements[3].sql.includes("DELETE FROM otp_challenges"));
assert.ok(statements[4].sql.includes("UPDATE users SET"));
assert.ok(statements[4].sql.includes("deleted_at=?"));
assert.ok(statements[4].sql.includes("phone='deleted:'||id"));
assert.ok(statements[4].sql.includes("password_hash=NULL"));
assert.ok(statements[4].sql.includes("university_id=NULL"));
assert.ok(statements[4].sql.includes("auth_version=auth_version+1"));
assert.ok(statements[5].sql.includes("admin.user.deleted"));
assert.ok(statements[6].sql.includes("DELETE FROM group_chat_confirmations"));
assert.deepEqual(statements[6].bindings,[USER_ID]);
assert.ok(!statements.some(item=>/DELETE FROM leader_transfers/i.test(item.sql)),"transfer history rows must be preserved");

const blockedDb=makeDb({otherMembers:2});
const blocked=await remove(blockedDb.DB);
assert.equal(blocked.status,409);
assert.equal((await blocked.json()).error,"team_leader_transfer_required");
assert.equal(blockedDb.state.batches.length,0);

const notFoundDb=makeDb({target:false});
const notFound=await remove(notFoundDb.DB);
assert.equal(notFound.status,404);
assert.equal((await notFound.json()).error,"person_not_found");

const viewerDb=makeDb({role:"viewer"});
const viewer=await remove(viewerDb.DB);
assert.equal(viewer.status,403);
assert.equal((await viewer.json()).error,"forbidden");
assert.equal(viewerDb.state.batches.length,0);

const conflictDb=makeDb({updateChanges:0});
const conflict=await remove(conflictDb.DB);
assert.equal(conflict.status,409);
assert.equal((await conflict.json()).error,"admin_delete_conflict");
console.log("admin-person-delete-smoke: permissions, account anonymization, leadership guard and transfer preservation passed");

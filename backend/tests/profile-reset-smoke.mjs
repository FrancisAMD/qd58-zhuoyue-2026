import assert from "node:assert/strict";
import worker from "../src/worker.js";

const ORIGIN="https://58er.eon21.space";
const COOKIE="__Host-qd58_session="+"a".repeat(64);
const USER_ID="11111111111111111111111111111111";
const TEAM_ID="22222222222222222222222222222222";

function makeDb({userUniversity="old-university",leaderUserId=USER_ID,memberCount=1}={}){
  const state={queries:[],batches:[]};
  const user={
    id:USER_ID,phone:"13800000000",name:"测试同学",high_school:"青岛五十八中",
    university_id:userUniversity,grade:"大一",province:"上海市",city:"上海市",
    greeting:"原有寄语",consent_given:1,consent_at:"2026-11-27T00:00:00Z",
    consent_version:"2026-11-27-v5",account_consent_at:"2026-11-27T00:00:00Z",
    account_consent_version:"2026-11-27-v5",gender:"male",profile_review_status:"approved",deleted_at:""
  };
  const DB={
    prepare(sql){
      return {
        sql,bindings:[],
        bind(...bindings){this.bindings=bindings;return this;},
        first:async()=>{
          state.queries.push({sql,bindings:this.bindings});
          if(sql.startsWith("SELECT u.id,u.phone,u.name"))return user;
          if(sql.startsWith("SELECT t.id,t.leader_user_id AS leaderUserId")) {
            return userUniversity?{id:TEAM_ID,leaderUserId,memberCount}:null;
          }
          throw new Error("Unexpected first query: "+sql);
        }
      };
    },
    async batch(statements){
      state.batches.push(statements.map(item=>({sql:item.sql,bindings:item.bindings})));
      return statements.map(()=>({meta:{changes:1}}));
    }
  };
  return {DB,state,user};
}
async function reset(db){
  return worker.fetch(new Request(ORIGIN+"/api/profile/reset",{
    method:"POST",headers:{origin:ORIGIN,cookie:COOKIE,"content-type":"application/json"},body:"{}"
  }),{APP_ORIGIN:ORIGIN,DB:db});
}

const soleLeaderDb=makeDb();
const soleLeaderResponse=await reset(soleLeaderDb.DB);
assert.equal(soleLeaderResponse.status,200);
assert.deepEqual(await soleLeaderResponse.json(),{ok:true,profileReset:true,transferHistoryPreserved:true});
const statements=soleLeaderDb.state.batches[0];
const expireIndex=statements.findIndex(item=>item.sql.includes("UPDATE leader_transfers SET status='expired'"));
const releaseIndex=statements.findIndex(item=>item.sql.includes("UPDATE teams SET leader_user_id=NULL"));
const resetUserIndex=statements.findIndex(item=>item.sql.includes("UPDATE users SET")&&item.sql.includes("university_id=NULL"));
const auditIndex=statements.findIndex(item=>item.sql.includes("profile.university_removed"));
assert.ok(expireIndex>=0,"pending transfer rows must be expired, not deleted");
assert.ok(releaseIndex>=0,"sole-member leader slot must be released");
assert.ok(resetUserIndex>=0,"personal profile and university membership must be reset");
assert.ok(auditIndex>resetUserIndex,"profile reset must leave an audit record");
assert.ok(expireIndex<resetUserIndex&&releaseIndex<resetUserIndex,"team/transfer state must be settled before clearing user profile");
assert.match(statements[expireIndex].sql,/status='pending'/);
assert.match(statements[releaseIndex].sql,/NOT EXISTS/);
assert.ok(!statements.some(item=>/DELETE FROM leader_transfers/i.test(item.sql)),"historical transfer rows must never be deleted by profile reset");
const resetSql=statements[resetUserIndex].sql;
for(const field of ["name=NULL","university_id=NULL","grade=NULL","greeting=''","major_discipline_code=''","secondary_phone=''","wechat_id=''","consent_given=0","account_consent_at=''"]){
  assert.ok(resetSql.includes(field),"profile reset should clear "+field);
}
assert.equal(resetSql.includes("password_hash="),false,"password credentials must remain intact");
assert.equal(resetSql.includes(",phone="),false,"account phone must remain intact");

const blockedDb=makeDb({userUniversity:"old-university",leaderUserId:USER_ID,memberCount:3});
const blocked=await reset(blockedDb.DB);
assert.equal(blocked.status,409);
assert.equal((await blocked.json()).error,"team_leader_transfer_required");
assert.equal(blockedDb.state.batches.length,0,"a leader with active teammates cannot detach before transferring leadership");

const ordinaryMemberDb=makeDb({userUniversity:"old-university",leaderUserId:"other-leader",memberCount:3});
const ordinaryMember=await reset(ordinaryMemberDb.DB);
assert.equal(ordinaryMember.status,200,"ordinary team members can clear their own profile");
assert.ok(ordinaryMemberDb.state.batches[0].some(item=>item.sql.includes("UPDATE users SET")&&item.sql.includes("university_id=NULL")));

const unassignedDb=makeDb({userUniversity:"",leaderUserId:null,memberCount:0});
const unassigned=await reset(unassignedDb.DB);
assert.equal(unassigned.status,200,"profile reset also works before university assignment");
assert.equal(unassignedDb.state.batches[0].filter(item=>item.sql.includes("UPDATE users SET")).length,1);
console.log("profile-reset-smoke: profile wipe, account preservation, transfer history and leader guards passed");

import assert from "node:assert/strict";
import worker from "../src/worker.js";

const ORIGIN="https://58er.eon21.space";
const COOKIE="__Host-qd58_session="+"c".repeat(64);
const USER_ID="11111111111111111111111111111111";
const TARGET_ID="22222222222222222222222222222222";
const TRANSFER_ID="33333333333333333333333333333333";

function makeDb({currentUniversity="uni-new",transferUniversity="uni-old"}={}){
  const state={queries:[],batches:[],allQueries:[]};
  const user={id:USER_ID,phone:"13800000000",name:"新学校成员",university_id:currentUniversity,deleted_at:"",auth_version:1};
  const DB={
    prepare(sql){
      return {
        sql,bindings:[],
        bind(...bindings){this.bindings=bindings;return this;},
        first:async()=>{
          state.queries.push({sql,bindings:this.bindings});
          if(sql.startsWith("SELECT u.id,u.phone,u.name"))return user;
          if(sql.startsWith("SELECT id,university_id FROM teams WHERE leader_user_id=?"))return {id:"team-new",university_id:currentUniversity};
          if(sql.startsWith("SELECT id FROM users WHERE id=? AND university_id=?"))return {id:TARGET_ID};
          if(sql.startsWith("SELECT lt.id,lt.to_user_id,lt.status,t.university_id AS transferUniversityId"))return {
            id:TRANSFER_ID,to_user_id:USER_ID,status:"pending",transferUniversityId:transferUniversity
          };
          throw new Error("Unexpected first query: "+sql);
        },
        all:async function(){
          state.allQueries.push({sql,bindings:this.bindings});
          if(sql.includes("from_name_snapshot")&&sql.includes("AS isCurrentTeam")){
            return {results:currentUniversity?[{
              id:TRANSFER_ID,team_id:"team-current",from_user_id:"other-user-1",to_user_id:"other-user-2",status:"accepted",
              created_at:"2026-11-20T00:00:00Z",fromName:"历史组长",toName:"历史接收人",
              university:"当前高校",universityId:currentUniversity,isCurrentTeam:1
            }]:[]};
          }
          throw new Error("Unexpected all query: "+sql);
        }
      };
    },
    async batch(statements){
      state.batches.push(statements.map(item=>({sql:item.sql,bindings:item.bindings})));
      const isCreate=statements.some(item=>item.sql.includes("from_name_snapshot"));
      return statements.map((_,index)=>({meta:{changes:isCreate&&index===0?1:0}}));
    }
  };
  return {DB,state};
}
function request(path,{method="GET",body}={}){
  return new Request(ORIGIN+path,{
    method,headers:{origin:ORIGIN,cookie:COOKIE,...(body?{"content-type":"application/json"}:{})},
    body:body?JSON.stringify(body):undefined
  });
}

const createDb=makeDb({currentUniversity:"uni-new"});
const created=await worker.fetch(request("/api/teams/transfer",{method:"POST",body:{toUserId:TARGET_ID}}),{APP_ORIGIN:ORIGIN,DB:createDb.DB});
assert.equal(created.status,201,JSON.stringify(await created.clone().json()));
const createBatch=createDb.state.batches.at(-1);
const insert=createBatch[0];
assert.match(insert.sql,/from_name_snapshot/);
assert.match(insert.sql,/to_name_snapshot/);
assert.match(insert.sql,/university_id_snapshot/);
assert.match(insert.sql,/university_name_snapshot/);
assert.match(insert.sql,/sender\.name,recipient\.name,t\.university_id,uni\.canonical_name/);
assert.equal(insert.bindings[1],USER_ID);
assert.equal(insert.bindings[2],TARGET_ID);

const historyDb=makeDb({currentUniversity:"uni-new"});
const history=await worker.fetch(request("/api/teams/transfers"),{APP_ORIGIN:ORIGIN,DB:historyDb.DB});
assert.equal(history.status,200);
const result=await history.json();
assert.equal(result.transfers[0].fromName,"历史组长");
assert.equal(result.transfers[0].toName,"历史接收人");
assert.equal(result.transfers[0].university,"当前高校");
assert.equal(result.transfers[0].universityId,"uni-new");
assert.equal(result.transfers[0].isCurrentTeam,1,"all members of the current school can see that school history, even when not participants");
const historySql=historyDb.state.allQueries[0].sql;
assert.match(historySql,/COALESCE\(NULLIF\(lt\.from_name_snapshot/);
assert.match(historySql,/COALESCE\(NULLIF\(lt\.university_name_snapshot/);
assert.match(historySql,/AS isCurrentTeam/);
assert.match(historySql,/WHERE COALESCE\(NULLIF\(lt\.university_id_snapshot/);
assert.doesNotMatch(historySql,/WHERE lt\.from_user_id=\? OR lt\.to_user_id=\?/);
assert.deepEqual(historyDb.state.allQueries[0].bindings,["11111111111111111111111111111111","11111111111111111111111111111111"]);


const unassignedDb=makeDb({currentUniversity:null});
const unassignedHistory=await worker.fetch(request("/api/teams/transfers"),{APP_ORIGIN:ORIGIN,DB:unassignedDb.DB});
assert.equal(unassignedHistory.status,200);
assert.deepEqual((await unassignedHistory.json()).transfers,[],"users who removed their school must not see old-school history");

const mismatchDb=makeDb({currentUniversity:"uni-new",transferUniversity:"uni-old"});
const mismatch=await worker.fetch(request("/api/teams/transfer/"+TRANSFER_ID+"/accept",{method:"POST",body:{}}),{APP_ORIGIN:ORIGIN,DB:mismatchDb.DB});
assert.equal(mismatch.status,409);
assert.equal((await mismatch.json()).error,"transfer_school_mismatch");
assert.equal(mismatchDb.state.batches.length,0,"a historical transfer from another university cannot be accepted");
console.log("team-transfer-history-smoke: immutable school/name snapshots and same-school response checks passed");

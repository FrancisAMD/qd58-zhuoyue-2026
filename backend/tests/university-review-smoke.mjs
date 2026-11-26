import assert from "node:assert/strict";
import worker from "../src/worker.js";

const ORIGIN="https://58er.eon21.space";
const ADMIN_COOKIE="__Host-qd58_admin="+"b".repeat(64);
const USER_ID="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function makeDb({role="admin",pending=true,existing=[]}={}) {
  const state={queries:[],batchStatements:[],batchBindings:[],audit:[],updates:[]};
  const admin={id:"admin-1",username:"reviewer",role};
  const DB={
    prepare(sql){
      let args=[];
      return {
        sql,bindings:[],
        bind(...values){args=values;this.bindings=values;return this;},
        first:async()=>{
          state.queries.push({method:"first",sql,args});
          if(sql.startsWith("SELECT a.id,a.username,a.role FROM admin_sessions"))return admin;
          if(sql.startsWith("SELECT id,name,overseas_university_name,profile_review_status FROM users")) {
            return pending?{id:USER_ID,name:"海外同学",overseas_university_name:"Example University",profile_review_status:"pending"}:null;
          }
          return null;
        },
        all:async()=>{
          state.queries.push({method:"all",sql,args});
          if(sql.startsWith("SELECT u.id,u.name,u.high_school"))return {results:pending?[{id:USER_ID,name:"海外同学",submittedName:"Example University"}]:[]};
          if(sql.startsWith("SELECT id,canonical_name,normalized_name FROM universities WHERE category='overseas'"))return {results:existing};
          return {results:[]};
        },
        run:async()=>{
          state.updates.push({sql,args});
          if(sql.startsWith("INSERT INTO audit_logs"))state.audit.push(args);
          return {meta:{changes:1}};
        }
      };
    },
    async batch(statements){
      state.batchStatements=statements.map(statement=>statement.sql);
      state.batchBindings=statements.map(statement=>statement.bindings||[]);
      return statements.map(()=>({meta:{changes:1}}));
    }
  };
  return {DB,state};
}
function request(path,{method="GET",body,role="admin",db}={}) {
  return worker.fetch(new Request(ORIGIN+path,{
    method,headers:{origin:ORIGIN,cookie:ADMIN_COOKIE,...(body?{"content-type":"application/json"}:{})},
    body:body?JSON.stringify(body):undefined
  }),{APP_ORIGIN:ORIGIN,DB:db});
}

const queueDb=makeDb();
const queue=await request("/api/admin/universities/review/pending",{db:queueDb.DB});
assert.equal(queue.status,200);
assert.equal((await queue.json()).items.length,1);
assert.ok(queueDb.state.queries.some(q=>q.sql.includes("profile_review_status='pending'")));

const approvedDb=makeDb();
const approved=await request("/api/admin/universities/review/"+USER_ID+"/approve",{
  method:"POST",body:{canonicalName:"Example University"},db:approvedDb.DB
});
assert.equal(approved.status,200,JSON.stringify(await approved.clone().json()));
const approvedBody=await approved.json();
assert.equal(approvedBody.status,"approved");
assert.equal(approvedBody.mergedExisting,false);
assert.ok(approvedDb.state.batchStatements[0].startsWith("INSERT INTO universities"));
assert.ok(approvedDb.state.batchStatements.some(sql=>sql.includes("UPDATE users SET university_id=?")));
assert.ok(approvedDb.state.batchStatements.some(sql=>sql.startsWith("UPDATE teams SET leader_user_id=?")));
assert.ok(approvedDb.state.batchStatements.some(sql=>sql.startsWith("INSERT OR IGNORE INTO teams")));
assert.equal(approvedDb.state.batchBindings[1][0],approvedBody.universityId);
assert.equal(approvedDb.state.batchBindings[1][4],USER_ID);
assert.equal(approvedDb.state.audit.at(-1)?.[3],"admin.overseas_university.approved");

const mergeDb=makeDb({existing:[{id:"existing-overseas",canonical_name:"Example University",normalized_name:"overseas:exampleuniversity"}]});
const merged=await request("/api/admin/universities/review/"+USER_ID+"/approve",{
  method:"POST",body:{canonicalName:" Example   University "},db:mergeDb.DB
});
assert.equal(merged.status,200);
const mergedBody=await merged.json();
assert.equal(mergedBody.mergedExisting,true);
assert.equal(mergedBody.universityId,"existing-overseas");
assert.equal(mergeDb.state.batchStatements.some(sql=>sql.startsWith("INSERT INTO universities")),false);
assert.equal(mergeDb.state.batchBindings[0][0],"existing-overseas");

const rejectedDb=makeDb();
const rejected=await request("/api/admin/universities/review/"+USER_ID+"/reject",{
  method:"POST",body:{reason:"无法核实学校信息"},db:rejectedDb.DB
});
assert.equal(rejected.status,200);
assert.equal((await rejected.json()).status,"rejected");
assert.ok(rejectedDb.state.updates.some(entry=>entry.sql.includes("profile_review_status='rejected'")));

const viewerDb=makeDb({role:"viewer"});
const viewer=await request("/api/admin/universities/review/pending",{db:viewerDb.DB});
assert.equal(viewer.status,403,"viewer role cannot read or action the overseas review queue");

const notPendingDb=makeDb({pending:false});
const conflict=await request("/api/admin/universities/review/"+USER_ID+"/approve",{
  method:"POST",body:{canonicalName:"Example University"},db:notPendingDb.DB
});
assert.equal(conflict.status,404);
console.log("university-review-smoke: queue, approval, canonical merge, rejection and viewer RBAC passed");

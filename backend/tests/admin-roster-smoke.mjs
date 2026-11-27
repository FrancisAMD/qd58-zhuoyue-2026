import assert from "node:assert/strict";
import worker from "../src/worker.js";

const ORIGIN="https://58er.eon21.space";
const COOKIE="__Host-qd58_admin="+"d".repeat(64);
const admin={id:"admin-1",username:"review-admin",role:"admin"};
const queries=[];
const DB={
  prepare(sql){
    let bindings=[];
    return {
      sql,
      bind(...values){bindings=values;return this;},
      first:async()=>{
        queries.push({kind:"first",sql,bindings});
        if(sql.startsWith("SELECT a.id,a.username,a.role FROM admin_sessions"))return admin;
        if(sql.startsWith("SELECT COUNT(*) AS total FROM users u"))return {total:2};
        if(sql.startsWith("SELECT COUNT(*) AS total FROM teams t"))return {total:1};
        if(sql.startsWith("SELECT COUNT(*) AS total, SUM"))return {total:2,completed:1,consented:1};
        if(sql.startsWith("SELECT COUNT(*) AS total FROM audit_logs"))return {total:15};
        throw new Error("Unexpected first query: "+sql);
      },
      all:async()=>{
        queries.push({kind:"all",sql,bindings});
        if(sql.startsWith("SELECT u.id,u.name,u.high_school")){
          return {results:[{
            id:"user-1",name:"测试同学",highSchool:"青岛五十八中",university:null,universityCategory:null,
            grade:"大一",province:null,city:null,gender:"female",majorDisciplineCode:"08",majorDiscipline:"工学",
            admissionCategoryId:"C04",admissionCategory:"强基计划",campusName:null,campusTag:null,
            greeting:"一路顺风",profileReviewStatus:"approved",overseasUniversityName:"",
            consentVersion:"2026-11-27-v5",accountConsentVersion:"2026-11-27-v5",
            createdAt:"2026-11-20T00:00:00Z",updatedAt:"2026-11-27T00:00:00Z",consentGiven:1
          }]};
        }
        if(sql.startsWith("SELECT t.id,uni.canonical_name AS university")){
          assert.match(sql,/HAVING COUNT\(u.id\)>0/);
          return {results:[{id:"team-active",university:"上海交通大学",memberCount:2,leaderName:"组长",leaderProvince:"上海市"}]};
        }
        if(sql.startsWith("SELECT l.id,l.actor_type")){
          return {results:Array.from({length:Number(bindings[0]||0)},(_,index)=>({
            id:"audit-"+index,actorType:"admin",actorUsername:"review-admin",action:"admin.test",
            targetType:"test",targetId:"target-"+index,metadata:"{}",createdAt:"2026-11-27T00:00:00Z"
          }))};
        }
        throw new Error("Unexpected all query: "+sql);
      },
      run:async()=>({meta:{changes:1}})
    };
  }
};
async function get(path){
  return worker.fetch(new Request(ORIGIN+path,{headers:{origin:ORIGIN,cookie:COOKIE}}),{APP_ORIGIN:ORIGIN,DB});
}
const roster=await get("/api/admin/people?page=1&pageSize=50");
assert.equal(roster.status,200);
const rosterBody=await roster.json();
assert.equal(rosterBody.items.length,1);
assert.equal(rosterBody.items[0].majorDiscipline,"工学");
assert.equal(rosterBody.items[0].admissionCategory,"强基计划");
assert.equal(rosterBody.items[0].greeting,"一路顺风");
assert.equal(rosterBody.items[0].university,null,"university-cleared accounts must not retain the old school association");
const rosterSql=queries.find(item=>item.kind==="all"&&item.sql.startsWith("SELECT u.id,u.name,u.high_school")).sql;
assert.match(rosterSql,/major\.label AS majorDiscipline/);
assert.match(rosterSql,/admission\.label AS admissionCategory/);
for(const privateField of ["u.phone","u.secondary_phone","u.wechat_id","password_hash"])assert.equal(rosterSql.includes(privateField),false,"admin profile output must not include "+privateField);

const overview=await get("/api/admin/overview");
assert.equal(overview.status,200);
const overviewBody=await overview.json();
assert.equal(overviewBody.teamCount,1);
assert.equal(overviewBody.teams.length,1);
const teamCountSql=queries.find(item=>item.kind==="first"&&item.sql.startsWith("SELECT COUNT(*) AS total FROM teams")).sql;
assert.match(teamCountSql,/EXISTS\(SELECT 1 FROM users active_member/);
const teamsSql=queries.find(item=>item.kind==="all"&&item.sql.startsWith("SELECT t.id,uni.canonical_name")).sql;
assert.match(teamsSql,/HAVING COUNT\(u.id\)>0/);

const audit=await get("/api/admin/audit?page=1&pageSize=100");
assert.equal(audit.status,200);
const auditBody=await audit.json();
assert.equal(auditBody.items.length,10,"admin audit UI/API should return only the latest 10 entries");
assert.equal(auditBody.pagination.pageSize,10);
const auditQuery=queries.find(item=>item.kind==="all"&&item.sql.startsWith("SELECT l.id,l.actor_type"));
assert.deepEqual(auditQuery.bindings,[10,0],"the server must cap audit page size at ten, even if a client asks for more");
console.log("admin-roster-smoke: expanded profile API, empty-team filtering and latest-10 audit cap passed");

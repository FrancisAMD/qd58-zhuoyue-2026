import assert from "node:assert/strict";
import worker from "../src/worker.js";

const ORIGIN="https://58er.eon21.space";
const COOKIE="__Host-qd58_admin="+"d".repeat(64);
const admin={id:"admin-1",username:"review-admin",role:"owner"};
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
          return {results:[
            {
              id:"user-1",name:"未选高校同学",highSchool:"青岛五十八中",university:null,universityCategory:null,
              grade:"大一",province:null,city:null,gender:"female",majorDisciplineCode:"08",majorDiscipline:"工学",
              admissionCategoryId:"C04",admissionCategory:"强基计划",campusName:null,campusTag:null,
              greeting:"一路顺风",profileReviewStatus:"approved",overseasUniversityName:"",
              consentVersion:"2026-11-27-v5",accountConsentVersion:"2026-11-27-v5",
              createdAt:"2026-11-22T00:00:00Z",updatedAt:"2026-11-27T00:00:00Z",consentGiven:1,
              universityMainProvince:"",profileCatalogProvince:"",universityLegacyRegion:""
            },
            {
              id:"user-2",name:"威海校区同学",highSchool:"青岛五十八中",university:"哈尔滨工业大学",universityCategory:"mainland",
              grade:"大一",province:"山东省",city:"威海市",gender:"male",majorDisciplineCode:"08",majorDiscipline:"工学",
              admissionCategoryId:"C04",admissionCategory:"强基计划",campusName:"威海校区",campusTag:"异地校区",
              greeting:"一路顺风",profileReviewStatus:"approved",overseasUniversityName:"",
              consentVersion:"2026-11-27-v5",accountConsentVersion:"2026-11-27-v5",
              createdAt:"2026-11-21T00:00:00Z",updatedAt:"2026-11-27T00:00:00Z",consentGiven:1,
              universityMainProvince:"黑龙江省",profileCatalogProvince:"",universityLegacyRegion:"黑龙江省"
            }
          ]};
        }
        if(sql.includes("FROM group_chat_confirmations WHERE user_id IN (")){
          return {results:[{userId:"user-2",regionKey:"heilongjiang",universityIdSnapshot:"university-2",qrUploadedAtSnapshot:"2026-11-27T11:00:00.000Z",confirmedAt:"2026-11-27T11:20:00.000Z"}]};
        }
        if(sql.startsWith("SELECT t.id,uni.canonical_name AS university")){
          assert.match(sql,/HAVING COUNT\(u.id\)>0/);
          assert.match(sql,/COALESCE\(NULLIF\(uni\.province_name_zh,''\),NULLIF\(profile_catalog\.province_name,''\),NULLIF\(uni\.region_name,''\),''\) AS leaderProvince/);
          assert.equal(sql.includes("leader.province"),false,"team province must never use first registrant or leader profile province");
          return {results:[{id:"team-active",university:"哈尔滨工业大学",memberCount:2,leaderName:"威海校区组长",leaderProvince:"黑龙江省"}]};
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
const GROUP_QR={async head(key){
  assert.equal(key,"group-chat-qr/heilongjiang");
  return {size:1234,customMetadata:{uploadedAt:"2026-11-27T11:00:00.000Z"},httpMetadata:{contentType:"image/png"}};
}};
async function get(path){
  return worker.fetch(new Request(ORIGIN+path,{headers:{origin:ORIGIN,cookie:COOKIE}}),{APP_ORIGIN:ORIGIN,DB,GROUP_QR});
}
const roster=await get("/api/admin/people?page=1&pageSize=50");
assert.equal(roster.status,200);
const rosterBody=await roster.json();
assert.equal(rosterBody.items.length,2);
assert.equal(rosterBody.items[0].majorDiscipline,"工学");
assert.equal(rosterBody.items[0].admissionCategory,"强基计划");
assert.equal(rosterBody.items[0].greeting,"一路顺风");
assert.equal(rosterBody.items[0].university,null,"university-cleared accounts must not retain the old school association");
assert.equal(rosterBody.items[1].groupChatRegionLabel,"黑龙江省","Weihai campus must use Harbin Institute of Technology's main-campus province");
assert.equal(rosterBody.items[1].groupChatStatus,"confirmed");
assert.equal(rosterBody.items[1].groupChatStatusLabel,"已确认加入");
assert.equal(rosterBody.items[1].groupChatConfirmedAt,"2026-11-27T11:20:00.000Z");
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

const provinceGradeFilter = await get("/api/admin/people?province=%E5%B1%B1%E4%B8%9C%E7%9C%81&grade=%E5%A4%A7%E4%B8%80");
assert.equal(provinceGradeFilter.status,200);
const filteredSelect=queries.filter(item=>item.kind==="all"&&item.sql.startsWith("SELECT u.id,u.name,u.high_school")).at(-1);
assert.match(filteredSelect.sql,/u\.province=\?/);
assert.match(filteredSelect.sql,/u\.grade=\?/);
assert.ok(filteredSelect.bindings.includes("山东省"));
assert.ok(filteredSelect.bindings.includes("大一"));
const emptyProvinceFilter=await get("/api/admin/people?province=__empty__");
assert.equal(emptyProvinceFilter.status,200);
const emptyFilterQuery=queries.filter(item=>item.kind==="all"&&item.sql.startsWith("SELECT u.id,u.name,u.high_school")).at(-1);
assert.match(emptyFilterQuery.sql,/COALESCE\(u\.province,''\)=''/);

admin.role="admin";
const forbiddenRoster=await get("/api/admin/people?page=1&pageSize=50");
assert.equal(forbiddenRoster.status,403,"ordinary admins must not access registration records or profiles");
const forbiddenAudit=await get("/api/admin/audit?page=1&pageSize=10");
assert.equal(forbiddenAudit.status,403,"ordinary admins must not read the admin audit trail");
const teamOverview=await get("/api/admin/overview");
assert.equal(teamOverview.status,200,"ordinary admins retain high-level overview access");
const teamOverviewBody=await teamOverview.json();
assert.equal(teamOverviewBody.teams.length,1,"ordinary admins may see team-level summary without individual roster access");
console.log("admin-roster-smoke: ordinary-admin access restrictions and team overview passed");

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
        if(sql.startsWith("SELECT COUNT(*) AS total FROM ("))return {total:1};
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
        if(sql.startsWith("SELECT teams.* FROM (")){
          return {results:[{
            id:"team-filtered",universityId:"university-2",university:"哈尔滨工业大学",
            memberCount:2,leaderName:"威海校区组长",region:"黑龙江省",
            universityCategory:"mainland",educationLevel:"undergraduate",
            degreeLevelsJson:'["undergraduate"]',
            projectTagsJson:'["project_985_legacy","project_211_legacy"]'
          }]};
        }
        if(sql.startsWith("SELECT DISTINCT active_teams.region")){
          return {results:[{region:"黑龙江省"},{region:"山东省"},{region:"上海市"}]};
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
const defaultRoster=await get("/api/admin/people");
assert.equal(defaultRoster.status,200);
const defaultRosterBody=await defaultRoster.json();
assert.equal(defaultRosterBody.pagination.pageSize,10,"roster API defaults to ten records per page");
assert.equal(defaultRosterBody.pagination.totalPages,1);
const defaultRosterQuery=queries.filter(item=>item.kind==="all"&&item.sql.startsWith("SELECT u.id,u.name,u.high_school")).at(-1);
assert.deepEqual(defaultRosterQuery.bindings.slice(-2),[10,0],"default roster query must fetch ten rows from the first page");

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

const teamList=await get("/api/admin/teams");
assert.equal(teamList.status,200);
const teamListBody=await teamList.json();
assert.equal(teamListBody.items.length,1);
assert.equal(teamListBody.items[0].university,"哈尔滨工业大学");
assert.equal(teamListBody.items[0].region,"黑龙江省");
assert.deepEqual(teamListBody.filterOptions.regions,["黑龙江省","山东省","上海市"]);
assert.equal(teamListBody.pagination.pageSize,20);
const teamListSql=queries.find(item=>item.kind==="all"&&item.sql.startsWith("SELECT teams.* FROM ("));
assert.match(teamListSql.sql,/province_name_zh/,"region must come from university catalog location metadata");
assert.match(teamListSql.sql,/project_tags_json/,"tier filters must use catalog project tags");
assert.match(teamListSql.sql,/degree_levels_json/,"cards must include catalog degree-level metadata");
assert.match(teamListSql.sql,/COUNT\(u\.id\) AS memberCount/,"team size must count active users");
assert.equal(teamListSql.bindings.slice(-2)[0],20,"team directory should page twenty teams by default");

const filteredTeamList=await get("/api/admin/teams?q=%E5%B7%A5%E4%B8%9A&region=%E9%BB%91%E9%BE%99%E6%B1%9F%E7%9C%81&level=985&minMembers=2&maxMembers=20");
assert.equal(filteredTeamList.status,200);
const filteredTeamSql=queries.filter(item=>item.kind==="all"&&item.sql.startsWith("SELECT teams.* FROM (")).at(-1);
assert.match(filteredTeamSql.sql,/teams\.region=\?/);
assert.match(filteredTeamSql.sql,/json_each\(CASE WHEN json_valid\(teams\.projectTagsJson\)/);
assert.match(filteredTeamSql.sql,/teams\.memberCount>=\?/);
assert.match(filteredTeamSql.sql,/teams\.memberCount<=\?/);
for(const value of ["工业","黑龙江省","project_985_legacy",2,20])assert.ok(filteredTeamSql.bindings.includes(value));

const invalidTeamRange=await get("/api/admin/teams?minMembers=20&maxMembers=2");
assert.equal(invalidTeamRange.status,400);

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

const csvExport=await get("/api/admin/people?format=csv&province=%E5%B1%B1%E4%B8%9C%E7%9C%81&page=2&pageSize=10");
assert.equal(csvExport.status,200,"authenticated CSV export should succeed when the exact app Origin is present");
assert.match(csvExport.headers.get("content-type")||"",/text\/csv/);
assert.match(csvExport.headers.get("content-disposition")||"",/zhuoyue-2026-roster\.csv/);
const csvText=await csvExport.text();
assert.ok(csvText.startsWith("\uFEFF"),"CSV export should retain its UTF-8 BOM");
assert.ok(csvText.includes("威海校区同学"),"CSV export should contain filtered roster rows");
const csvSelect=queries.filter(item=>item.kind==="all"&&item.sql.startsWith("SELECT u.id,u.name,u.high_school")).at(-1);
assert.deepEqual(csvSelect.bindings.slice(-2),[5000,0],"CSV export should return all filtered records, not only the current UI page");

const xlsxExport=await get("/api/admin/people?format=xlsx&province=%E5%B1%B1%E4%B8%9C%E7%9C%81");
assert.equal(xlsxExport.status,200,"authenticated XLSX export should succeed when the exact app Origin is present");
assert.match(xlsxExport.headers.get("content-type")||"",/spreadsheetml\.sheet/);
assert.match(xlsxExport.headers.get("content-disposition")||"",/zhuoyue-2026-roster\.xlsx/);
const xlsxBytes=new Uint8Array(await xlsxExport.arrayBuffer());
assert.ok(xlsxBytes.length>4&&xlsxBytes[0]===0x50&&xlsxBytes[1]===0x4b,"XLSX export must produce a ZIP-based workbook");

const originlessExport=await worker.fetch(new Request(ORIGIN+"/api/admin/people?format=csv",{headers:{cookie:COOKIE}}),{APP_ORIGIN:ORIGIN,DB,GROUP_QR});
assert.equal(originlessExport.status,403,"originless direct API navigation must remain blocked");
assert.equal((await originlessExport.json()).error,"origin_forbidden","strict origin checks must not be relaxed to fix browser downloads");

admin.role="admin";
const forbiddenRoster=await get("/api/admin/people?page=1&pageSize=50");
assert.equal(forbiddenRoster.status,403,"ordinary admins must not access registration records or profiles");
const forbiddenAudit=await get("/api/admin/audit?page=1&pageSize=10");
assert.equal(forbiddenAudit.status,403,"ordinary admins must not read the admin audit trail");
const ordinaryAdminTeams=await get("/api/admin/teams?region=%E9%BB%91%E9%BE%99%E6%B1%9F%E7%9C%81");
assert.equal(ordinaryAdminTeams.status,200,"ordinary admins with overview permission may filter team summaries");
const teamOverview=await get("/api/admin/overview");
assert.equal(teamOverview.status,200,"ordinary admins retain high-level overview access");
const teamOverviewBody=await teamOverview.json();
assert.equal(teamOverviewBody.teams.length,1,"ordinary admins may see team-level summary without individual roster access");
console.log("admin-roster-smoke: ordinary-admin access restrictions and team overview passed");

import assert from "node:assert/strict";
import worker from "../src/worker.js";

const APP_ORIGIN="https://58er.eon21.space";
const SESSION_TOKEN="a".repeat(64);
const PRIVACY_NOTICE_VERSION="2026-11-27-v5";
const cookie="__Host-qd58_session="+SESSION_TOKEN;

const currentUser={
  id:"viewer-1",phone:"13800000000",name:"当前用户",university_id:"university-1",province:"山东省",
  phone_visible_to_team:0,consent_given:1,consent_at:"2026-11-26T00:00:00.000Z",
  consent_version:PRIVACY_NOTICE_VERSION,account_consent_at:"2026-11-26T00:00:00.000Z",
  account_consent_version:PRIVACY_NOTICE_VERSION,deleted_at:"",auth_version:1
};
const candidates=[
  {
    id:"member-1",name:"新版同意成员",phone:"13800000001",secondary_phone:"13900000001",wechat_id:"wechat-1",
    phone_visible_to_team:0,consent_given:1,consent_at:"2026-11-26T00:00:00.000Z",
    consent_version:PRIVACY_NOTICE_VERSION,account_consent_at:"2026-11-26T00:00:00.000Z",
    account_consent_version:PRIVACY_NOTICE_VERSION
  },
  {
    id:"member-2",name:"旧版隐私同意",phone:"13800000002",secondary_phone:"13900000002",wechat_id:"wechat-2",
    phone_visible_to_team:1,consent_given:1,consent_at:"2026-11-20T00:00:00.000Z",
    consent_version:"2026-11-15-v3",account_consent_at:"2026-11-20T00:00:00.000Z",
    account_consent_version:"2026-11-15-v3"
  },
  {
    id:"member-3",name:"缺少同意时间",phone:"13800000003",secondary_phone:"",wechat_id:"",
    phone_visible_to_team:1,consent_given:1,consent_at:"",consent_version:PRIVACY_NOTICE_VERSION,
    account_consent_at:"2026-11-26T00:00:00.000Z",account_consent_version:PRIVACY_NOTICE_VERSION
  }
];
const state={queries:[]};
const DB={
  prepare(sql){
    return {sql,bind(...bindings){return {
      sql,bindings,
      first:async()=>{
        state.queries.push({method:"first",sql,bindings});
        if(sql.startsWith("SELECT u.id,u.phone"))return currentUser;
        if(sql.startsWith("SELECT university_id,province FROM users WHERE id=?"))return {university_id:"university-1",province:"山东省"};
        if(sql.startsWith("SELECT t.id,t.leader_user_id AS leaderUserId"))return {
          id:"team-1",leaderUserId:"viewer-1",leaderName:"当前用户",leaderGrade:"大一",memberCount:4,university:"示例大学"
        };
        throw new Error("Unexpected first query: "+sql);
      },
      all:async()=>{
        state.queries.push({method:"all",sql,bindings});
        if(sql.includes("CASE WHEN u.consent_given=1")){
          assert.deepEqual(bindings.slice(0,6),Array(6).fill(PRIVACY_NOTICE_VERSION));
          assert.equal(bindings[6],"university-1");
          assert.equal(bindings[7],"viewer-1");
          return {results:candidates.map(member=>({
            id:member.id,name:member.name,highSchool:"青岛五十八中",grade:"大一",province:"山东省",
            majorDisciplineCode:"08",campusName:"主校区",campusTag:"主校区",
            phone:member.consent_given===1&&member.consent_at!==""&&member.consent_version===PRIVACY_NOTICE_VERSION&&member.account_consent_at!==""&&member.account_consent_version===PRIVACY_NOTICE_VERSION?member.phone:null,
            secondaryPhone:member.consent_given===1&&member.consent_at!==""&&member.consent_version===PRIVACY_NOTICE_VERSION&&member.account_consent_at!==""&&member.account_consent_version===PRIVACY_NOTICE_VERSION?member.secondary_phone:null,
            wechatId:member.consent_given===1&&member.consent_at!==""&&member.consent_version===PRIVACY_NOTICE_VERSION&&member.account_consent_at!==""&&member.account_consent_version===PRIVACY_NOTICE_VERSION?member.wechat_id:null
          }))};
        }
        if(sql.startsWith("SELECT u.name,u.grade,u.province,uni.canonical_name"))return {results:[{name:"同省队长",university:"另一所大学",province:"山东省"}]};
        throw new Error("Unexpected all query: "+sql);
      }
    };}};
  }
};

const response=await worker.fetch(new Request("https://api.58er.eon21.space/api/directory",{headers:{origin:APP_ORIGIN,cookie}}),{APP_ORIGIN,DB});
assert.equal(response.status,200);
const result=await response.json();
assert.equal(result.members.length,candidates.length);
assert.equal(result.members[0].phone,"13800000001","new privacy v5 consent shares primary phone within same university");
assert.equal(result.members[0].secondaryPhone,"13900000001");
assert.equal(result.members[0].wechatId,"wechat-1");
assert.equal(Object.hasOwn(result.members[0],"gender"),false,"gender is private to the profile owner");
for(const member of result.members.slice(1)){
  assert.equal(member.phone,null,member.name+" must not expose primary phone before v5 re-consent");
  assert.equal(member.secondaryPhone,null);
  assert.equal(member.wechatId,null);
}
assert.equal(result.team.isLeader,true,"the directory must expose the current user's leader status");
assert.equal(result.team.leaderUserId,"viewer-1");
assert.equal(result.currentUserId,"viewer-1");
assert.equal(result.provinceLeaders.length,1);
assert.equal(Object.hasOwn(result.provinceLeaders[0],"phone"),false,"province leader list must never include contact data");

const memberQuery=state.queries.find(query=>query.method==="all"&&query.sql.includes("CASE WHEN u.consent_given=1"));
assert.ok(memberQuery,"directory query must apply v5 consent policy in SQL");
for(const predicate of ["u.consent_given=1","u.consent_at<>''","u.consent_version=?","u.account_consent_at<>''","u.account_consent_version=?"])
  assert.ok(memberQuery.sql.includes(predicate),"missing privacy predicate: "+predicate);
assert.equal(memberQuery.sql.includes("u.phone_visible_to_team=1"),false,"old optional phone sharing flag is not used by v5 consent");

console.log("directory-phone-consent-smoke: all assertions passed");

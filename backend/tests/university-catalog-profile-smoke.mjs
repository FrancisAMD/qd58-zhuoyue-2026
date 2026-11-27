import assert from "node:assert/strict";
import worker from "../src/worker.js";
const APP_ORIGIN="https://58er.eon21.space";
const SESSION_TOKEN="a".repeat(64),cookie="__Host-qd58_session="+SESSION_TOKEN;
const NOTICE="2026-11-27-v5";
const baseUser={
  id:"user-1",phone:"13800000000",name:null,high_school:"青岛五十八中",class_name:null,university_id:null,
  grade:null,province:null,city:null,bio:null,greeting:"",phone_visible_to_team:0,consent_given:0,consent_at:"",
  consent_version:"",account_consent_at:"",account_consent_version:"",gender:"undisclosed",major_group:"",
  major_discipline_code:"",admission_category_id:"",admission_type_id:"",campus_id:"",campus_name:"",
  campus_tag:"",secondary_phone:"",wechat_id:"",profile_review_status:"approved",overseas_university_name:"",
  profile_review_submitted_at:"",profile_reviewed_at:"",deleted_at:"",auth_version:1
};
const campus={id:"CN-10001-MAIN",name:"主校区",tag:"主校区",country:"中国",province:"山东省",city:"青岛市",status:"active",branches:[
  {id:"CN-10001-BRANCH-1",name:"即墨校区",tag:"异地校区",country:"中国",province:"山东省",city:"青岛市",status:"active"},
  {id:"CN-10001-BRANCH-2",name:"海外合作校区",tag:"海外合作校区",country:"英国",province:"英格兰",city:"伦敦",status:"active"}
]};
const profileCatalog={
  source_id:"CN-10001",university_id:"profile-CN-10001",category:"mainland",canonical_name:"示例大学",
  region_name:"山东省",province_name:"山东省",city_name:"青岛市",tags_json:'["ordinary_undergraduate","public"]',
  campuses_json:JSON.stringify([campus])
};
const university={id:"profile-CN-10001",canonical_name:"示例大学",category:"mainland",region_name:"山东省",
  education_level:"undergraduate",partner_name:"",project_tags_json:'["ordinary_undergraduate"]',catalog_id:null};
function makeDb({
  user={...baseUser},catalog=profileCatalog,uni=university,validMajor=true,validAdmission=true,batchChanges=1,
  oldTeam=null,pendingTransfer=null
}={}){
  const state={queries:[],batchCalls:0,statements:[],batchBindings:[]};
  const DB={
    prepare(sql){return {sql,bind(...bindings){return {sql,bindings,
      first:async()=>{
        state.queries.push({method:"first",sql,bindings});
        if(sql.startsWith("SELECT u.id,u.phone"))return user;
        if(sql.startsWith("SELECT t.leader_user_id AS leaderUserId"))return oldTeam;
        if(sql.startsWith("SELECT source_id,university_id,category,canonical_name"))return catalog;
        if(sql.startsWith("SELECT id,canonical_name,category,region_name,education_level,partner_name FROM universities"))return uni;
        if(sql.startsWith("SELECT code FROM profile_option_codes WHERE option_type='major_discipline'"))return validMajor?{code:bindings[0]}:null;
        if(sql.startsWith("SELECT code FROM profile_option_codes WHERE option_type='admission_category'"))return validAdmission&&bindings[0]?{code:bindings[0]}:null;
        if(sql.startsWith("SELECT canonical_name,category,region_name,education_level,partner_name,project_tags_json,catalog_id FROM universities"))return uni;
        if(sql.startsWith("SELECT source_id FROM profile_university_catalog"))return catalog?{source_id:catalog.source_id}:null;
        return null;
      },
      all:async()=>({results:[]}),
      run:async()=>({meta:{changes:1}})
    };}}},
    async batch(statements){
      state.batchCalls++;
      state.statements=statements.map(statement=>statement.sql);
      state.batchBindings=statements.map(statement=>statement.bindings);
      const userIndex=statements.findIndex(item=>item.sql.includes("UPDATE users SET"));
      return statements.map((_,index)=>({meta:{changes:index===userIndex?batchChanges:1}}));
    }
  };
  return {DB,state};
}
async function save(db,payload){
  return worker.fetch(new Request("https://api.58er.eon21.space/api/profile",{
    method:"PUT",headers:{origin:APP_ORIGIN,"content-type":"application/json",cookie},
    body:JSON.stringify({
      name:"测试同学",highSchool:"青岛五十八中",grade:"大一",gender:"undisclosed",greeting:"一路顺风",
      majorDisciplineCode:"08",province:"山东省",city:"青岛市",consent:true,universityCategory:"mainland",
      profileUniversityId:"CN-10001",campusId:"CN-10001-MAIN",admissionCategoryId:"C04",
      ...payload
    })
  }),{APP_ORIGIN,DB:db,RATE_LIMIT_HMAC_SECRET:"test-rate-limit-secret-0123456789abcdef"});
}
const selectedDb=makeDb();
const selected=await save(selectedDb.DB,{});
assert.equal(selected.status,200,JSON.stringify(await selected.clone().json()));
assert.equal((await selected.json()).reviewStatus,"approved");
assert.equal(selectedDb.state.batchCalls,1);
assert.ok(selectedDb.state.statements.some(sql=>sql.includes("DELETE FROM group_chat_confirmations")),"first school assignment also clears any orphaned confirmation rows");
assert.ok(selectedDb.state.queries.some(q=>q.sql.includes("FROM profile_university_catalog WHERE source_id=?")));
assert.ok(selectedDb.state.statements.some(sql=>sql.includes("UPDATE users SET")&&sql.includes("campus_id=?")&&sql.includes("admission_type_id=''")&&sql.includes("major_discipline_code=?")&&sql.includes("greeting=?")));
assert.ok(selectedDb.state.statements.some(sql=>sql.includes("INSERT OR IGNORE INTO teams")));
const userUpdate=selectedDb.state.batchBindings[1];
assert.ok(userUpdate.includes("CN-10001-MAIN"));
assert.ok(userUpdate.includes("主校区"));
assert.ok(userUpdate.includes("山东省"));
assert.ok(userUpdate.includes("13900000000")===false);

const overseasCampusDb=makeDb();
const overseasCampus=await save(overseasCampusDb.DB,{campusId:"CN-10001-BRANCH-2"});
assert.equal(overseasCampus.status,200,"a mainland university overseas branch remains attached to the parent school");
const overseasCampusUpdate=overseasCampusDb.state.batchBindings[1];
assert.equal(overseasCampusUpdate[10],"CN-10001-BRANCH-2");
assert.equal(overseasCampusUpdate[4],"英国 · 英格兰","the selected foreign campus must retain its country and region");
assert.equal(overseasCampusUpdate[5],"伦敦");


const invalidCampusDb=makeDb();
const invalidCampus=await save(invalidCampusDb.DB,{campusId:"fake-campus"});
assert.equal(invalidCampus.status,400);
assert.equal((await invalidCampus.json()).error,"campus_selection_required");
assert.equal(invalidCampusDb.state.batchCalls,0);

const invalidAdmissionDb=makeDb({validAdmission:false});
const invalidAdmission=await save(invalidAdmissionDb.DB,{});
assert.equal(invalidAdmission.status,400);
assert.equal((await invalidAdmission.json()).error,"admission_category_required");
assert.equal(invalidAdmissionDb.state.batchCalls,0);

const noAdmissionDb=makeDb();
const noAdmission=await save(noAdmissionDb.DB,{admissionCategoryId:""});
assert.equal(noAdmission.status,400);
assert.equal((await noAdmission.json()).error,"admission_category_required");
assert.equal(noAdmissionDb.state.batchCalls,0);

const hmtCatalog={
  source_id:"HK-0001",university_id:"profile-HK-0001",category:"hmt",canonical_name:"香港示例大学",
  region_name:"香港",province_name:"",city_name:"香港",tags_json:"[]",campuses_json:"[]"
};
const hmtUniversity={...university,id:"profile-HK-0001",canonical_name:"香港示例大学",category:"hmt",region_name:"香港"};
const hmtDb=makeDb({catalog:hmtCatalog,uni:hmtUniversity});
const hmt=await save(hmtDb.DB,{profileUniversityId:"HK-0001",universityCategory:"hmt",campusId:"",majorDisciplineCode:"01",admissionCategoryId:""});
assert.equal(hmt.status,200,"HMT schools use school name only and do not require campus/admission route");
const hmtUserUpdate=hmtDb.state.batchBindings[hmtDb.state.statements.findIndex(sql=>sql.includes("UPDATE users SET"))];
assert.equal(hmtUserUpdate[10],"","HMT school profiles must store no campus ID");
assert.equal(hmtUserUpdate[11],"","HMT school profiles must store no campus name");
assert.equal(hmtUserUpdate[12],"","HMT school profiles must store no campus tag");

const overseasDb=makeDb();
const overseas=await save(overseasDb.DB,{
  profileUniversityId:"",universityCategory:"overseas",university:"Example University",
  majorDisciplineCode:"07",campusId:"",admissionCategoryId:""
});
assert.equal(overseas.status,200);
assert.equal((await overseas.json()).reviewStatus,"pending");
assert.equal(overseasDb.state.batchCalls,1);
assert.ok(!overseasDb.state.statements.some(sql=>sql.includes("INSERT OR IGNORE INTO teams")));

const noConsentDb=makeDb();
const noConsent=await save(noConsentDb.DB,{consent:false});
assert.equal(noConsent.status,400);
assert.equal((await noConsent.json()).error,"consent_required");
assert.equal(noConsentDb.state.batchCalls,0);

const changedDb=makeDb({
  user:{...baseUser,university_id:"another-university"},
  oldTeam:{leaderUserId:"another-leader",memberCount:2}
});
const changed=await save(changedDb.DB,{});
assert.equal(changed.status,200,"an ordinary team member may reassign to another university");
assert.equal(changedDb.state.batchCalls,1);
assert.ok(changedDb.state.statements.some(sql=>sql.includes("COALESCE(university_id,'')=?")));
const changedRelease=changedDb.state.statements.findIndex(sql=>sql.includes("UPDATE teams SET leader_user_id=NULL"));
const changedUser=changedDb.state.statements.findIndex(sql=>sql.includes("UPDATE users SET"));
assert.ok(changedRelease>=0&&changedRelease<changedUser,"old team leader slot handling must run before user university_id changes");
assert.ok(changedDb.state.statements.some(sql=>sql.includes("UPDATE leader_transfers SET status='expired'")),"pending transfer rows must be closed when leaving the old school");
assert.ok(changedDb.state.statements.some(sql=>sql.includes("DELETE FROM group_chat_confirmations")),"changing schools must clear the previous school's group-chat confirmation");
assert.ok(!changedDb.state.statements.some(sql=>/DELETE FROM leader_transfers/i.test(sql)),"transfer history must not be deleted");

const blockedLeaderDb=makeDb({
  user:{...baseUser,university_id:"another-university"},
  oldTeam:{leaderUserId:"user-1",memberCount:3}
});
const blockedLeader=await save(blockedLeaderDb.DB,{});
assert.equal(blockedLeader.status,409);
assert.equal((await blockedLeader.json()).error,"team_leader_transfer_required");
assert.equal(blockedLeaderDb.state.batchCalls,0);

const soleLeaderDb=makeDb({
  user:{...baseUser,university_id:"another-university"},
  oldTeam:{leaderUserId:"user-1",memberCount:1}
});
const soleLeader=await save(soleLeaderDb.DB,{});
assert.equal(soleLeader.status,200,"a sole-member leader may move and release the old team leadership slot");
assert.ok(soleLeaderDb.state.statements.some(sql=>sql.includes("UPDATE teams SET leader_user_id=NULL")));

const pendingTransferDb=makeDb({
  user:{...baseUser,university_id:"another-university"},
  oldTeam:{leaderUserId:"another-leader",memberCount:2},
  pendingTransfer:{id:"pending-transfer"}
});
const pendingTransfer=await save(pendingTransferDb.DB,{});
assert.equal(pendingTransfer.status,200,"a recipient of an old-school pending transfer can leave; the pending row is expired and retained");
assert.ok(pendingTransferDb.state.statements.some(sql=>sql.includes("UPDATE leader_transfers SET status='expired'")));
assert.equal(pendingTransferDb.state.statements.some(sql=>/DELETE FROM leader_transfers/i.test(sql)),false);

const sameUniversityDb=makeDb({user:{...baseUser,university_id:university.id}});
const sameUniversitySave=await save(sameUniversityDb.DB,{});
assert.equal(sameUniversitySave.status,200);
assert.equal(sameUniversityDb.state.statements.some(sql=>sql.includes("DELETE FROM group_chat_confirmations")),false,"saving unchanged school details must preserve the current confirmation");

const getDb=makeDb({user:{...baseUser,university_id:university.id,consent_given:1,consent_at:"now",consent_version:NOTICE,
  account_consent_at:"now",account_consent_version:NOTICE,gender:"female",major_discipline_code:"08",greeting:"一路顺风",campus_id:"CN-10001-MAIN",
  campus_name:"主校区",admission_category_id:"C04",secondary_phone:"13900000000",wechat_id:"wechat-test"}});
const getResponse=await worker.fetch(new Request("https://api.58er.eon21.space/api/profile",{headers:{origin:APP_ORIGIN,cookie}}),{APP_ORIGIN,DB:getDb.DB});
const getBody=await getResponse.json();
assert.equal(getResponse.status,200);
assert.equal(getBody.profile.university,"示例大学");
assert.equal(getBody.profile.profileUniversityId,"CN-10001");
assert.equal(getBody.profile.gender,"female");
assert.equal(getBody.profile.majorDisciplineCode,"08");
assert.equal(getBody.profile.greeting,"一路顺风");
assert.equal(getBody.profile.campusId,"CN-10001-MAIN");
assert.equal(getBody.profile.admissionCategoryId,"C04");
assert.equal(Object.hasOwn(getBody.profile,"admissionTypeId"),false);
assert.equal(getBody.profile.secondaryPhone,"13900000000");
assert.equal(getBody.profile.wechatId,"wechat-test");
assert.equal(getBody.profile.consentGiven,true);

console.log("university-catalog-profile-smoke: all assertions passed");

import assert from "node:assert/strict";
import worker from "../src/worker.js";
const APP_ORIGIN="https://58er.eon21.space";
const SESSION_TOKEN="a".repeat(64),cookie="__Host-qd58_session="+SESSION_TOKEN;
const NOTICE="2026-11-26-v4";
const baseUser={
  id:"user-1",phone:"13800000000",name:null,high_school:"青岛五十八中",class_name:null,university_id:null,
  grade:null,province:null,city:null,bio:null,phone_visible_to_team:0,consent_given:0,consent_at:"",
  consent_version:"",account_consent_at:"",account_consent_version:"",gender:"undisclosed",major_group:"",
  major_discipline_code:"",admission_category_id:"",admission_type_id:"",campus_id:"",campus_name:"",
  campus_tag:"",secondary_phone:"",wechat_id:"",profile_review_status:"approved",overseas_university_name:"",
  profile_review_submitted_at:"",profile_reviewed_at:"",deleted_at:"",auth_version:1
};
const campus={id:"CN-10001-MAIN",name:"主校区",tag:"主校区",country:"中国",province:"山东省",city:"青岛市",status:"active",branches:[
  {id:"CN-10001-BRANCH-1",name:"即墨校区",tag:"异地校区",country:"中国",province:"山东省",city:"青岛市",status:"active"}
]};
const profileCatalog={
  source_id:"CN-10001",university_id:"profile-CN-10001",category:"mainland",canonical_name:"示例大学",
  region_name:"山东省",province_name:"山东省",city_name:"青岛市",tags_json:'["ordinary_undergraduate","public"]',
  campuses_json:JSON.stringify([campus])
};
const university={id:"profile-CN-10001",canonical_name:"示例大学",category:"mainland",region_name:"山东省",
  education_level:"undergraduate",partner_name:"",project_tags_json:'["ordinary_undergraduate"]',catalog_id:null};
function makeDb({
  user={...baseUser},catalog=profileCatalog,uni=university,validMajor=true,validAdmission=true,batchChanges=1
}={}){
  const state={queries:[],batchCalls:0,statements:[],batchBindings:[]};
  const DB={
    prepare(sql){return {sql,bind(...bindings){return {sql,bindings,
      first:async()=>{
        state.queries.push({method:"first",sql,bindings});
        if(sql.startsWith("SELECT u.id,u.phone"))return user;
        if(sql.startsWith("SELECT source_id,university_id,category,canonical_name"))return catalog;
        if(sql.startsWith("SELECT id,canonical_name,category,region_name,education_level,partner_name FROM universities"))return uni;
        if(sql.startsWith("SELECT code FROM profile_option_codes WHERE option_type='major_group'"))return validMajor?{code:bindings[0]}:null;
        if(sql.startsWith("SELECT code FROM profile_option_codes WHERE option_type='admission_type'"))return validAdmission&&bindings[0]&&bindings[1]?{code:bindings[0]}:null;
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
      return statements.map((_,index)=>({meta:{changes:index===1?batchChanges:1}}));
    }
  };
  return {DB,state};
}
async function save(db,payload){
  return worker.fetch(new Request("https://api.58er.eon21.space/api/profile",{
    method:"PUT",headers:{origin:APP_ORIGIN,"content-type":"application/json",cookie},
    body:JSON.stringify({
      name:"测试同学",className:"高三一班",highSchool:"青岛五十八中",grade:"大一",gender:"undisclosed",
      majorGroup:"工科",province:"山东省",city:"青岛市",consent:true,universityCategory:"mainland",
      profileUniversityId:"CN-10001",campusId:"CN-10001-MAIN",admissionCategoryId:"C04",admissionTypeId:"T0401",
      ...payload
    })
  }),{APP_ORIGIN,DB:db,RATE_LIMIT_HMAC_SECRET:"test-rate-limit-secret-0123456789abcdef"});
}
const selectedDb=makeDb();
const selected=await save(selectedDb.DB,{});
assert.equal(selected.status,200,JSON.stringify(await selected.clone().json()));
assert.equal((await selected.json()).reviewStatus,"approved");
assert.equal(selectedDb.state.batchCalls,1);
assert.ok(selectedDb.state.queries.some(q=>q.sql.includes("FROM profile_university_catalog WHERE source_id=?")));
assert.ok(selectedDb.state.statements.some(sql=>sql.includes("UPDATE users SET")&&sql.includes("campus_id=?")&&sql.includes("admission_type_id=?")));
assert.ok(selectedDb.state.statements.some(sql=>sql.includes("INSERT OR IGNORE INTO teams")));
const userUpdate=selectedDb.state.batchBindings[1];
assert.ok(userUpdate.includes("CN-10001-MAIN"));
assert.ok(userUpdate.includes("主校区"));
assert.ok(userUpdate.includes("山东省"));
assert.ok(userUpdate.includes("13900000000")===false);

const invalidCampusDb=makeDb();
const invalidCampus=await save(invalidCampusDb.DB,{campusId:"fake-campus"});
assert.equal(invalidCampus.status,400);
assert.equal((await invalidCampus.json()).error,"campus_selection_required");
assert.equal(invalidCampusDb.state.batchCalls,0);

const invalidAdmissionDb=makeDb({validAdmission:false});
const invalidAdmission=await save(invalidAdmissionDb.DB,{});
assert.equal(invalidAdmission.status,400);
assert.equal((await invalidAdmission.json()).error,"admission_route_required");
assert.equal(invalidAdmissionDb.state.batchCalls,0);

const noAdmissionDb=makeDb();
const noAdmission=await save(noAdmissionDb.DB,{admissionCategoryId:"",admissionTypeId:""});
assert.equal(noAdmission.status,400);
assert.equal((await noAdmission.json()).error,"admission_route_required");
assert.equal(noAdmissionDb.state.batchCalls,0);

const hmtCatalog={
  source_id:"HK-0001",university_id:"profile-HK-0001",category:"hmt",canonical_name:"香港示例大学",
  region_name:"香港",province_name:"",city_name:"香港",tags_json:"[]",campuses_json:"[]"
};
const hmtUniversity={...university,id:"profile-HK-0001",canonical_name:"香港示例大学",category:"hmt",region_name:"香港"};
const hmtDb=makeDb({catalog:hmtCatalog,uni:hmtUniversity});
const hmt=await save(hmtDb.DB,{profileUniversityId:"HK-0001",universityCategory:"hmt",campusId:"",majorGroup:"文科",admissionCategoryId:"",admissionTypeId:""});
assert.equal(hmt.status,200,"HMT schools use school name only and do not require campus/admission route");
assert.ok(!hmtDb.state.statements.some(sql=>sql.includes("campus_id=?")));

const overseasDb=makeDb();
const overseas=await save(overseasDb.DB,{
  profileUniversityId:"",universityCategory:"overseas",university:"Example University",
  majorGroup:"理科",campusId:"",admissionCategoryId:"",admissionTypeId:""
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

const changedDb=makeDb({user:{...baseUser,university_id:"another-university"}});
const changed=await save(changedDb.DB,{});
assert.equal(changed.status,409);
assert.equal((await changed.json()).error,"university_change_requires_support");
assert.equal(changedDb.state.batchCalls,0);

const getDb=makeDb({user:{...baseUser,university_id:university.id,consent_given:1,consent_at:"now",consent_version:NOTICE,
  account_consent_at:"now",account_consent_version:NOTICE,gender:"female",major_group:"工科",campus_id:"CN-10001-MAIN",
  campus_name:"主校区",admission_category_id:"C04",admission_type_id:"T0401",secondary_phone:"13900000000",wechat_id:"wechat-test"}});
const getResponse=await worker.fetch(new Request("https://api.58er.eon21.space/api/profile",{headers:{origin:APP_ORIGIN,cookie}}),{APP_ORIGIN,DB:getDb.DB});
const getBody=await getResponse.json();
assert.equal(getResponse.status,200);
assert.equal(getBody.profile.university,"示例大学");
assert.equal(getBody.profile.profileUniversityId,"CN-10001");
assert.equal(getBody.profile.gender,"female");
assert.equal(getBody.profile.majorGroup,"工科");
assert.equal(getBody.profile.campusId,"CN-10001-MAIN");
assert.equal(getBody.profile.admissionTypeId,"T0401");
assert.equal(getBody.profile.secondaryPhone,"13900000000");
assert.equal(getBody.profile.wechatId,"wechat-test");
assert.equal(getBody.profile.consentGiven,true);

console.log("university-catalog-profile-smoke: all assertions passed");

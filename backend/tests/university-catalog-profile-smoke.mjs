import assert from "node:assert/strict";
import worker from "../src/worker.js";
const APP_ORIGIN="https://58er.eon21.space",SESSION_TOKEN="a".repeat(64),cookie="__Host-qd58_session="+SESSION_TOKEN;
const baseUser={id:"user-1",name:null,high_school:"青岛五十八中",class_name:null,university_id:null,grade:null,province:null,city:null,bio:null,phone_visible_to_team:0,consent_given:0,consent_at:"",consent_version:"",account_consent_at:"",account_consent_version:"",deleted_at:"",auth_version:1};
const catalogRow={id:"db-university-1",catalog_id:"mainland:CN-10001",canonical_name:"青岛大学",category:"mainland",region_name:"",education_level:"",partner_name:"",country_code:"CN",country_name_zh:"中国",province_name_zh:"山东省",degree_levels_json:'["undergraduate"]',catalog_status:"active",verification_status:"verified",verified_at:"2026-11-21T00:00:00Z"};
const legacyRow={id:"legacy-university-1",canonical_name:"旧版合作大学",category:"sino_foreign",region_name:"",education_level:"undergraduate",partner_name:"合作院校"};
function makeDb({user={...baseUser},catalog=catalogRow,legacy=legacyRow,batchChanges=1,missingCatalogSchema=false}={}) {
  const state={batchCalls:0,statements:[],firstQueries:[]};
  const DB={
    prepare(sql){return {sql,bind(...bindings){return {sql,bindings,
      first:async()=>{
        state.firstQueries.push({sql,bindings});
        if(sql.startsWith("SELECT u.id,u.phone"))return user;
        if(missingCatalogSchema&&sql.startsWith("SELECT canonical_name,category")&&sql.includes("catalog_id"))throw new Error("no such column: catalog_id");
        if(sql.startsWith("SELECT id,catalog_id,canonical_name"))return catalog;
        if(sql.startsWith("SELECT id,canonical_name,category"))return legacy;
        if(sql.startsWith("SELECT canonical_name,category"))return catalog;
        return null;
      },
      all:async()=>({results:[]}),run:async()=>({meta:{changes:1}})
    };}}},
    async batch(statements){state.batchCalls++;state.statements=statements.map(statement=>statement.sql);state.batchBindings=statements.map(statement=>statement.bindings);return [{meta:{changes:1}},{meta:{changes:batchChanges}},{meta:{changes:1}},{meta:{changes:1}}];}
  };
  return {DB,state};
}
async function requestProfile(db,payload){
  return worker.fetch(new Request("https://api.58er.eon21.space/api/profile",{method:"PUT",headers:{origin:APP_ORIGIN,"content-type":"application/json",cookie},body:JSON.stringify({name:"测试同学",className:"高三一班",grade:"大一",province:"山东省",city:"青岛市",consent:true,...payload})}),{APP_ORIGIN,DB:db,RATE_LIMIT_HMAC_SECRET:"test-rate-limit-secret-0123456789abcdef"});
}
const selectedDb=makeDb();
const selected=await requestProfile(selectedDb.DB,{universityCatalogId:catalogRow.catalog_id,university:"伪造的客户端学校名称",universityCategory:"overseas",phoneVisible:false});
assert.equal(selected.status,200);
assert.equal((await selected.json()).ok,true);
assert.equal(selectedDb.state.batchCalls,1);
assert.ok(selectedDb.state.firstQueries.some(q=>q.sql.includes("catalog_id=?")&&q.sql.includes("verification_status='verified'")&&q.sql.includes("catalog_status='active'")));
assert.ok(selectedDb.state.statements.some(sql=>sql.includes("UPDATE users")&&sql.includes("university_id=?")));
assert.ok(!selectedDb.state.statements.some(sql=>sql.includes("INSERT OR IGNORE INTO universities")),"profile save must never create a free-form university");
assert.equal(selectedDb.state.batchBindings[1][8],0,"an unchecked phone-sharing option must be stored as opt-out");
for (const forgedOptIn of ["false", 1, "1", "true"]) {
  const strictDb=makeDb();
  const strictResponse=await requestProfile(strictDb.DB,{universityCatalogId:catalogRow.catalog_id,phoneVisible:forgedOptIn});
  assert.equal(strictResponse.status,200);
  assert.equal(strictDb.state.batchBindings[1][8],0,"only the literal boolean true may grant phone visibility");
}
const explicitOptInDb=makeDb();
const explicitOptIn=await requestProfile(explicitOptInDb.DB,{universityCatalogId:catalogRow.catalog_id,phoneVisible:true});
assert.equal(explicitOptIn.status,200);
assert.equal(explicitOptInDb.state.batchBindings[1][8],1,"the explicit checkbox boolean may grant phone visibility");
const noCatalogDb=makeDb();
const noCatalog=await requestProfile(noCatalogDb.DB,{university:"用户随意输入的学校",universityCategory:"mainland"});
assert.equal(noCatalog.status,400);
assert.equal((await noCatalog.json()).error,"university_catalog_selection_required");
assert.equal(noCatalogDb.state.batchCalls,0);
const unverifiedDb=makeDb({catalog:null});
const unverified=await requestProfile(unverifiedDb.DB,{universityCatalogId:"mainland:CN-UNVERIFIED"});
assert.equal(unverified.status,400);
assert.equal((await unverified.json()).error,"university_not_selectable");
assert.equal(unverifiedDb.state.batchCalls,0);
const changedDb=makeDb({user:{...baseUser,university_id:"another-university"}});
const changed=await requestProfile(changedDb.DB,{universityCatalogId:catalogRow.catalog_id});
assert.equal(changed.status,409);
assert.equal((await changed.json()).error,"university_change_requires_support");
assert.equal(changedDb.state.batchCalls,0);
const legacyDb=makeDb({user:{...baseUser,university_id:legacyRow.id}});
const legacy=await requestProfile(legacyDb.DB,{university:legacyRow.canonical_name,universityCategory:legacyRow.category});
assert.equal(legacy.status,200);
assert.equal(legacyDb.state.batchCalls,1);
assert.ok(!legacyDb.state.statements.some(sql=>sql.includes("INSERT OR IGNORE INTO universities")),"legacy edits must not create or rename university rows");
const raceDb=makeDb({batchChanges:0});
const race=await requestProfile(raceDb.DB,{universityCatalogId:catalogRow.catalog_id});
assert.equal(race.status,409);
assert.equal((await race.json()).error,"university_change_requires_support","compare-and-set must reject a concurrent assignment");
const getDb=makeDb({user:{...baseUser,university_id:catalogRow.id}});
const getResponse=await worker.fetch(new Request("https://api.58er.eon21.space/api/profile",{headers:{origin:APP_ORIGIN,cookie}}),{APP_ORIGIN,DB:getDb.DB});
const getBody=await getResponse.json();
assert.equal(getResponse.status,200);
assert.equal(getBody.profile.universityCatalogId,catalogRow.catalog_id);
assert.equal(getBody.profile.university,catalogRow.canonical_name);
const legacyGetDb=makeDb({user:{...baseUser,university_id:legacyRow.id},catalog:legacyRow,missingCatalogSchema:true});
const legacyGet=await worker.fetch(new Request("https://api.58er.eon21.space/api/profile",{headers:{origin:APP_ORIGIN,cookie}}),{APP_ORIGIN,DB:legacyGetDb.DB});
const legacyGetBody=await legacyGet.json();
assert.equal(legacyGet.status,200,"profile GET must remain compatible before migration 0013");
assert.equal(legacyGetBody.profile.university,legacyRow.canonical_name);
assert.equal(legacyGetBody.profile.universityCatalogId,null);
const currentConsentUser={...baseUser,university_id:catalogRow.id,consent_given:1,consent_at:"2026-11-22T00:00:00Z",consent_version:"2026-11-15-v3",account_consent_at:"2026-11-22T00:00:00Z",account_consent_version:"2026-11-15-v3"};
const currentConsentDb=makeDb({user:currentConsentUser});
const currentConsentResponse=await worker.fetch(new Request("https://api.58er.eon21.space/api/profile",{headers:{origin:APP_ORIGIN,cookie}}),{APP_ORIGIN,DB:currentConsentDb.DB});
const currentConsentBody=await currentConsentResponse.json();
assert.equal(currentConsentBody.profile.consentGiven,true,"current consent should remain checked in the profile form");
assert.equal(currentConsentBody.profile.accountConsentGiven,true);
const staleConsentUser={...currentConsentUser,consent_version:"2026-11-14-v2",account_consent_version:"2026-11-14-v2"};
const staleConsentDb=makeDb({user:staleConsentUser});
const staleConsentResponse=await worker.fetch(new Request("https://api.58er.eon21.space/api/profile",{headers:{origin:APP_ORIGIN,cookie}}),{APP_ORIGIN,DB:staleConsentDb.DB});
const staleConsentBody=await staleConsentResponse.json();
assert.equal(staleConsentBody.profile.consentGiven,false,"stale consent must not be pre-checked after a notice-version change");
assert.equal(staleConsentBody.profile.accountConsentGiven,false);
const incompleteConsentUser={...currentConsentUser,consent_at:""};
const incompleteConsentDb=makeDb({user:incompleteConsentUser});
const incompleteConsentResponse=await worker.fetch(new Request("https://api.58er.eon21.space/api/profile",{headers:{origin:APP_ORIGIN,cookie}}),{APP_ORIGIN,DB:incompleteConsentDb.DB});
const incompleteConsentBody=await incompleteConsentResponse.json();
assert.equal(incompleteConsentBody.profile.consentGiven,false,"missing consent timestamp must fail closed");
console.log("university-catalog-profile-smoke: all assertions passed");

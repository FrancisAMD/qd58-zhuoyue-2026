import assert from "node:assert/strict";
import worker from "../src/worker.js";

const ORIGIN="https://58er.eon21.space";
const USER_COOKIE="__Host-qd58_session="+"a".repeat(64);
const ADMIN_COOKIE="__Host-qd58_admin="+"b".repeat(64);
const PRIVACY_VERSION="2026-11-27-v5";
const USER_ID="11111111111111111111111111111111";
const ADMIN_ID="22222222222222222222222222222222";
const PNG=new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0x00,0x01,0x02,0x03]);

function makeR2(seed={}){
  const objects=new Map(Object.entries(seed));
  const state={objects,puts:[],deletes:[],heads:[]};
  function shape(key,item){
    if(!item)return null;
    return {
      key,size:item.bytes.byteLength,
      customMetadata:item.customMetadata,
      httpMetadata:item.httpMetadata,
      uploaded:new Date(item.customMetadata.uploadedAt)
    };
  }
  return {
    state,
    async head(key){state.heads.push(key);return shape(key,objects.get(key));},
    async get(key){
      const item=objects.get(key);if(!item)return null;
      return {body:item.bytes,customMetadata:item.customMetadata,httpMetadata:item.httpMetadata,size:item.bytes.byteLength};
    },
    async put(key,bytes,options){
      const item={bytes:new Uint8Array(bytes),customMetadata:options.customMetadata||{},httpMetadata:options.httpMetadata||{}};
      objects.set(key,item);state.puts.push({key,item});
      return shape(key,item);
    },
    async delete(key){objects.delete(key);state.deletes.push(key);}
  };
}
function makeDb({category="mainland",mainProvince="黑龙江省",legacyRegion="黑龙江省",userProvince="山东省",confirmation=null,adminRole="admin",peopleRows=[]}={}){
  const state={queries:[],batches:[],runs:[]};
  const currentUser={
    id:USER_ID,phone:"13800000000",name:"测试同学",university_id:"university-1",
    consent_given:1,consent_at:"2026-11-27T00:00:00Z",consent_version:PRIVACY_VERSION,
    account_consent_at:"2026-11-27T00:00:00Z",account_consent_version:PRIVACY_VERSION,
    deleted_at:"",auth_version:1
  };
  const DB={
    prepare(sql){
      let bindings=[];
      return {
        sql,
        bind(...values){bindings=values;this.bindings=values;return this;},
        first:async()=>{
          state.queries.push({type:"first",sql,bindings});
          if(sql.startsWith("SELECT u.id,u.phone,u.name"))return currentUser;
          if(sql.startsWith("SELECT u.id,u.university_id,u.province AS userProvince")){
            return {id:USER_ID,university_id:"university-1",university:"哈尔滨工业大学",
              category,mainProvince,legacyRegion,userProvince};
          }
          if(sql.startsWith("SELECT university_id_snapshot,qr_uploaded_at_snapshot,confirmed_at")){
            return confirmation;
          }
          if(sql.startsWith("SELECT a.id,a.username,a.role FROM admin_sessions")){
            return {id:ADMIN_ID,username:"rootops",role:adminRole};
          }
          throw new Error("Unexpected first query: "+sql);
        },
        all:async()=>{
          state.queries.push({type:"all",sql,bindings});
          if(sql.startsWith("SELECT u.id,u.name,u.grade,u.campus_name AS campusName")){
            return {results:peopleRows};
          }
          throw new Error("Unexpected all query: "+sql);
        },
        run:async()=>{
          state.runs.push({sql,bindings});
          return {meta:{changes:1}};
        }
      };
    },
    async batch(statements){
      state.batches.push(statements.map(item=>({sql:item.sql,bindings:item.bindings})));
      return statements.map(()=>({meta:{changes:1}}));
    }
  };
  return {DB,state};
}
function makeRequest(path,{method="GET",cookie=USER_COOKIE,headers={},body}={}){
  return new Request(ORIGIN+"/api"+path,{
    method,headers:{origin:ORIGIN,cookie,...headers},
    body
  });
}
const asset=(uploadedAt="2026-11-27T11:00:00.000Z")=>({
  bytes:PNG,
  httpMetadata:{contentType:"image/png"},
  customMetadata:{regionKey:"heilongjiang",regionLabel:"黑龙江省",fileName:"黑龙江群.png",uploadedAt,uploadedBy:"rootops"}
});

// A selected branch campus in Shandong must still resolve to the university main province, Heilongjiang.
const mainQrR2=makeR2({"group-chat-qr/heilongjiang":asset()});
const mainDb=makeDb({category:"mainland",mainProvince:"黑龙江省",legacyRegion:"黑龙江省",userProvince:"山东省",
  confirmation:{university_id_snapshot:"university-1",qr_uploaded_at_snapshot:"2026-11-27T11:00:00.000Z",confirmed_at:"2026-11-27T11:20:00.000Z"}});
const statusResponse=await worker.fetch(makeRequest("/group-chat/status"),{APP_ORIGIN:ORIGIN,DB:mainDb.DB,GROUP_QR:mainQrR2});
assert.equal(statusResponse.status,200);
const status=await statusResponse.json();
assert.equal(status.regionKey,"heilongjiang");
assert.equal(status.regionLabel,"黑龙江省");
assert.equal(status.confirmed,true);
assert.match(status.mappingRule,/校本部所在省份/);
assert.ok(mainQrR2.state.heads.includes("group-chat-qr/heilongjiang"));
assert.ok(!mainQrR2.state.heads.includes("group-chat-qr/shandong"));
const contextSql=mainDb.state.queries.find(item=>item.sql.includes("profile_catalog.province_name"))?.sql||"";
assert.match(contextSql,/COALESCE\(NULLIF\(uni\.province_name_zh,''\),NULLIF\(profile_catalog\.province_name,''\)\)/);
assert.match(contextSql,/LEFT JOIN profile_university_catalog profile_catalog/);


const imageResponse=await worker.fetch(makeRequest("/group-chat/qr-image"),{APP_ORIGIN:ORIGIN,DB:mainDb.DB,GROUP_QR:mainQrR2});
assert.equal(imageResponse.status,200);
assert.equal(imageResponse.headers.get("content-type"),"image/png");
assert.equal((await imageResponse.arrayBuffer()).byteLength,PNG.byteLength);

const confirmDb=makeDb({category:"mainland",mainProvince:"黑龙江省",legacyRegion:"黑龙江省",userProvince:"山东省"});
const confirmResponse=await worker.fetch(makeRequest("/group-chat/confirm",{method:"POST",headers:{"content-type":"application/json"},body:"{}"}),{APP_ORIGIN:ORIGIN,DB:confirmDb.DB,GROUP_QR:mainQrR2});
assert.equal(confirmResponse.status,200);
const confirmBody=await confirmResponse.json();
assert.equal(confirmBody.confirmed,true);
const confirmationBatch=confirmDb.state.batches[0];
assert.match(confirmationBatch[0].sql,/INSERT INTO group_chat_confirmations/);
assert.equal(confirmationBatch[0].bindings[1],"heilongjiang");
assert.equal(confirmationBatch[0].bindings[2],"university-1");
assert.equal(confirmationBatch[0].bindings[3],"2026-11-27T11:00:00.000Z");
assert.match(confirmationBatch[1].sql,/student\.group_chat\.confirmed/);

// Replacing the QR changes its timestamp; an older acknowledgement no longer counts.
const replacedR2=makeR2({"group-chat-qr/heilongjiang":asset("2026-11-27T12:00:00.000Z")});
const staleDb=makeDb({category:"mainland",mainProvince:"黑龙江省",legacyRegion:"黑龙江省",userProvince:"山东省",
  confirmation:{university_id_snapshot:"university-1",qr_uploaded_at_snapshot:"2026-11-27T11:00:00.000Z",confirmed_at:"2026-11-27T11:20:00.000Z"}});
const staleResponse=await worker.fetch(makeRequest("/group-chat/status"),{APP_ORIGIN:ORIGIN,DB:staleDb.DB,GROUP_QR:replacedR2});
const stale=await staleResponse.json();
assert.equal(stale.confirmed,false);
assert.equal(stale.needsReconfirm,true);

// Hong Kong, Macau and Taiwan share one QR group; overseas universities share another.
for(const [category,key,label] of [["hmt","hmt","港澳台"],["overseas","overseas","海外"]]){
  const db=makeDb({category,mainProvince:"",legacyRegion:"",userProvince:""});
  const r2=makeR2({["group-chat-qr/"+key]:asset()});
  const response=await worker.fetch(makeRequest("/group-chat/status"),{APP_ORIGIN:ORIGIN,DB:db.DB,GROUP_QR:r2});
  const result=await response.json();
  assert.equal(response.status,200);
  assert.equal(result.regionKey,key);
  assert.equal(result.regionLabel,label);
}

// Admin can upload and replace only an allowlisted region, with real image signatures.
const adminDb=makeDb({adminRole:"admin"});
const uploadR2=makeR2();
const uploadResponse=await worker.fetch(makeRequest("/admin/group-chat/qr/heilongjiang?fileName=qr.png",{
  method:"PUT",cookie:ADMIN_COOKIE,headers:{"content-type":"image/png"},body:PNG
}),{APP_ORIGIN:ORIGIN,DB:adminDb.DB,GROUP_QR:uploadR2});
assert.equal(uploadResponse.status,200);
const uploadResult=await uploadResponse.json();
assert.equal(uploadResult.regionLabel,"黑龙江省");
assert.equal(uploadR2.state.puts[0].key,"group-chat-qr/heilongjiang");
assert.equal(uploadR2.state.puts[0].item.customMetadata.fileName,"qr.png");
assert.equal(adminDb.state.runs.length,1);
assert.equal(adminDb.state.runs[0].bindings[3],"admin.group_chat_qr.uploaded");

const invalidUpload=await worker.fetch(makeRequest("/admin/group-chat/qr/not-a-province?fileName=bad.png",{
  method:"PUT",cookie:ADMIN_COOKIE,headers:{"content-type":"image/png"},body:PNG
}),{APP_ORIGIN:ORIGIN,DB:adminDb.DB,GROUP_QR:uploadR2});
assert.equal(invalidUpload.status,400);

const nonImage=await worker.fetch(makeRequest("/admin/group-chat/qr/shandong?fileName=bad.png",{
  method:"PUT",cookie:ADMIN_COOKIE,headers:{"content-type":"image/png"},body:new Uint8Array([1,2,3,4])
}),{APP_ORIGIN:ORIGIN,DB:adminDb.DB,GROUP_QR:uploadR2});
assert.equal(nonImage.status,415);

const qrListResponse=await worker.fetch(makeRequest("/admin/group-chat/qr",{cookie:ADMIN_COOKIE}),{APP_ORIGIN:ORIGIN,DB:adminDb.DB,GROUP_QR:uploadR2});
assert.equal(qrListResponse.status,200);
const qrList=await qrListResponse.json();
assert.equal(qrList.regions.length,33);
assert.ok(qrList.regions.some(item=>item.key==="hmt"&&item.label==="港澳台"));
assert.ok(qrList.regions.some(item=>item.key==="overseas"&&item.label==="海外"));
assert.ok(qrList.regions.find(item=>item.key==="heilongjiang").configured);

const people=[
  {id:"hw",name:"威海校区同学",grade:"大一",campusName:"威海校区",university:"哈尔滨工业大学",
    category:"mainland",mainProvince:"黑龙江省",legacyRegion:"黑龙江省",userProvince:"山东省",
    confirmedAt:null,qrUploadedAtSnapshot:null},
  {id:"sd",name:"山东高校同学",grade:"大二",campusName:"主校区",university:"山东大学",
    category:"mainland",mainProvince:"山东省",legacyRegion:"山东省",userProvince:"山东省",
    confirmedAt:"2026-11-27T11:30:00.000Z",qrUploadedAtSnapshot:"2026-11-27T11:00:00.000Z"},
  {id:"hk",name:"港澳台同学",grade:"大一",campusName:"",university:"香港大学",
    category:"hmt",mainProvince:"",legacyRegion:"",userProvince:"",confirmedAt:null,qrUploadedAtSnapshot:null}
];
const confirmAdminDb=makeDb({adminRole:"admin",peopleRows:people});
const confirmR2=makeR2({"group-chat-qr/shandong":asset()});
const confirmListResponse=await worker.fetch(makeRequest("/admin/group-chat/confirmations?regionKey=shandong",{cookie:ADMIN_COOKIE}),{APP_ORIGIN:ORIGIN,DB:confirmAdminDb.DB,GROUP_QR:confirmR2});
assert.equal(confirmListResponse.status,200);
const confirmList=await confirmListResponse.json();
assert.equal(confirmList.total,1);
assert.equal(confirmList.confirmed,1);
assert.equal(confirmList.members[0].id,"sd");
assert.equal(confirmList.members.some(item=>item.id==="hw"),false,"HIT Weihai campus must not count as Shandong; QR follows main campus");
assert.equal(confirmList.members.some(item=>item.id==="hk"),false);
const adminRegionSql=confirmAdminDb.state.queries.find(item=>item.type==="all"&&item.sql.includes("profile_catalog.province_name"))?.sql||"";
assert.match(adminRegionSql,/LEFT JOIN profile_university_catalog profile_catalog/);
assert.match(adminRegionSql,/COALESCE\(NULLIF\(uni\.province_name_zh,''\),NULLIF\(profile_catalog\.province_name,''\)\)/);


const missingBucket=await worker.fetch(makeRequest("/group-chat/status"),{APP_ORIGIN:ORIGIN,DB:mainDb.DB});
assert.equal(missingBucket.status,503);
console.log("group-chat-qr-smoke: main-campus region mapping, hmt/overseas groups, R2 upload, protected image, confirmation and admin roster passed");

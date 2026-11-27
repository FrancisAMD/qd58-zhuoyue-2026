import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import worker from "../src/worker.js";

if(!globalThis.crypto)globalThis.crypto=webcrypto;
const ORIGIN="https://58er.eon21.space";
const ADMIN_COOKIE="__Host-qd58_admin="+"b".repeat(64);
const ADMIN_ID="22222222222222222222222222222222";

function makeDb({role="owner",items=[]}={}){
  const state={items:items.map(item=>({...item})),audits:[],writes:[]};
  const DB={
    prepare(sql){
      let bindings=[];
      return {
        sql,
        bind(...values){bindings=values;return this;},
        async first(){
          if(sql.startsWith("SELECT a.id,a.username,a.role FROM admin_sessions"))return {id:ADMIN_ID,username:"rootops",role};
          throw new Error("Unexpected first query: "+sql);
        },
        async all(){
          if(sql.startsWith("SELECT id,nickname,amount_cents AS amountCents")){
            return {results:state.items.slice().sort((a,b)=>a.display_order-b.display_order||a.created_at.localeCompare(b.created_at)).map(item=>({
              id:item.id,nickname:item.nickname,amountCents:item.amount_cents,displayOrder:item.display_order,
              createdAt:item.created_at,updatedAt:item.updated_at
            }))};
          }
          throw new Error("Unexpected all query: "+sql);
        },
        async run(){
          state.writes.push({sql,bindings});
          if(sql.startsWith("INSERT INTO donation_records")){
            const [id,nickname,amount_cents,display_order,created_at,updated_at]=bindings;
            state.items.push({id,nickname,amount_cents,display_order,created_at,updated_at});
            return {meta:{changes:1}};
          }
          if(sql.startsWith("UPDATE donation_records SET")){
            const [nickname,amount_cents,display_order,updated_at,id]=bindings;
            const item=state.items.find(row=>row.id===id);
            if(!item)return {meta:{changes:0}};
            Object.assign(item,{nickname,amount_cents,display_order,updated_at});
            return {meta:{changes:1}};
          }
          if(sql.startsWith("DELETE FROM donation_records")){
            const id=bindings[0],before=state.items.length;
            state.items=state.items.filter(row=>row.id!==id);
            return {meta:{changes:before-state.items.length}};
          }
          if(sql.startsWith("INSERT INTO audit_logs")){state.audits.push({sql,bindings});return {meta:{changes:1}};}
          throw new Error("Unexpected run query: "+sql);
        }
      };
    }
  };
  return {DB,state};
}
function request(path,{method="GET",cookie="",body}={}){
  const headers=new Headers({Origin:ORIGIN});
  if(cookie)headers.set("Cookie",cookie);
  if(body!==undefined)headers.set("Content-Type","application/json");
  return new Request(ORIGIN+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
}
const seed=[{id:"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",nickname:"五八校友",amount_cents:5000,display_order:10,created_at:"2026-11-27T00:00:00.000Z",updated_at:"2026-11-27T00:00:00.000Z"}];
const publicDb=makeDb({items:seed});
const publicResponse=await worker.fetch(request("/api/donations"),{APP_ORIGIN:ORIGIN,DB:publicDb.DB});
assert.equal(publicResponse.status,200);
const publicBody=await publicResponse.json();
assert.equal(publicBody.items.length,1);
assert.equal(publicBody.items[0].amountCents,5000);
assert.equal(publicBody.items[0].nickname,"五八校友");

const ownerDb=makeDb();
const createResponse=await worker.fetch(request("/api/admin/donations",{method:"POST",cookie:ADMIN_COOKIE,body:{nickname:"愿意同行的校友",amountCents:12345,displayOrder:5}}),{APP_ORIGIN:ORIGIN,DB:ownerDb.DB});
assert.equal(createResponse.status,201);
const created=await createResponse.json();
assert.equal(created.amountCents,12345);
assert.equal(ownerDb.state.items.length,1);
assert.equal(ownerDb.state.audits.length,1);
assert.equal(ownerDb.state.audits[0].bindings[3],"admin.donation.created");

const updateResponse=await worker.fetch(request("/api/admin/donations/"+created.id,{method:"PUT",cookie:ADMIN_COOKIE,body:{nickname:"修改后的昵称",amountCents:888,displayOrder:20}}),{APP_ORIGIN:ORIGIN,DB:ownerDb.DB});
assert.equal(updateResponse.status,200);
assert.equal(ownerDb.state.items[0].nickname,"修改后的昵称");
assert.equal(ownerDb.state.items[0].amount_cents,888);

const deleteResponse=await worker.fetch(request("/api/admin/donations/"+created.id,{method:"DELETE",cookie:ADMIN_COOKIE}),{APP_ORIGIN:ORIGIN,DB:ownerDb.DB});
assert.equal(deleteResponse.status,200);
assert.equal(ownerDb.state.items.length,0);

const invalidResponse=await worker.fetch(request("/api/admin/donations",{method:"POST",cookie:ADMIN_COOKIE,body:{nickname:"超额金额",amountCents:0,displayOrder:0}}),{APP_ORIGIN:ORIGIN,DB:ownerDb.DB});
assert.equal(invalidResponse.status,400);
assert.equal(ownerDb.state.items.length,0);

const viewerDb=makeDb({role:"viewer"});
const forbiddenResponse=await worker.fetch(request("/api/admin/donations",{method:"POST",cookie:ADMIN_COOKIE,body:{nickname:"只读账号",amountCents:100,displayOrder:0}}),{APP_ORIGIN:ORIGIN,DB:viewerDb.DB});
assert.equal(forbiddenResponse.status,403);
assert.equal(viewerDb.state.items.length,0);

console.log("Donations API smoke tests: PASS (public read, owner/admin CRUD, validation and viewer authorization).");

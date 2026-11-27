import assert from "node:assert/strict";
import worker from "../src/worker.js";
const ORIGIN="https://58er.eon21.space",API="https://api.58er.eon21.space";
const PHONE="13812345678",RATE_SECRET="registration-phone-check-test-secret-0123456789";
function makeDb({registeredPhone=null,blocked=false}={}){
  const buckets=new Map();let userLookups=0,otpLookups=0;
  const DB={prepare(sql){return {args:[],bind(...args){this.args=args;return this;},
    async first(){
      if(sql.startsWith("SELECT id FROM users WHERE phone=? AND deleted_at=''")){
        userLookups++;return registeredPhone===this.args[0]?{id:"known-user"}:null;
      }
      if(sql.startsWith("SELECT id FROM otp_challenges"))otpLookups++;
      return null;
    },
    async run(){
      if(sql.startsWith("INSERT INTO rate_limits")){
        if(blocked)return {meta:{changes:0}};
        const [key,t,resetAt,,,limit]=this.args,current=buckets.get(key);
        if(!current||current.window_started_at<=resetAt){buckets.set(key,{window_started_at:t,hit_count:1});return {meta:{changes:1}};}
        if(current.hit_count<limit){current.hit_count++;return {meta:{changes:1}};}
        return {meta:{changes:0}};
      }
      return {meta:{changes:1}};
    }
  };}};
  return {DB,buckets,get userLookups(){return userLookups;},get otpLookups(){return otpLookups;}};
}
function request(path,data){return new Request(API+path,{method:"POST",headers:{"content-type":"application/json",origin:ORIGIN,"CF-Connecting-IP":"203.0.113.77"},body:JSON.stringify(data)});}
const env=DB=>({APP_ORIGIN:ORIGIN,DB,RATE_LIMIT_HMAC_SECRET:RATE_SECRET});
const registeredDb=makeDb({registeredPhone:PHONE});
const known=await worker.fetch(request("/api/auth/register/check-phone",{phone:PHONE,accountConsent:true}),env(registeredDb.DB));
assert.equal(known.status,200);assert.deepEqual(await known.json(),{registered:true});assert.equal(registeredDb.userLookups,1);
const availableDb=makeDb({registeredPhone:PHONE+"1"});
const available=await worker.fetch(request("/api/auth/register/check-phone",{phone:PHONE,accountConsent:true}),env(availableDb.DB));
assert.equal(available.status,200);assert.deepEqual(await available.json(),{registered:false});
const noConsentDb=makeDb({registeredPhone:PHONE});
const noConsent=await worker.fetch(request("/api/auth/register/check-phone",{phone:PHONE,accountConsent:false}),env(noConsentDb.DB));
assert.equal(noConsent.status,400);assert.deepEqual(await noConsent.json(),{error:"consent_required"});assert.equal(noConsentDb.userLookups,0);
const invalidPhoneDb=makeDb();
const invalidPhone=await worker.fetch(request("/api/auth/register/check-phone",{phone:"12345",accountConsent:true}),env(invalidPhoneDb.DB));
assert.equal(invalidPhone.status,400);assert.equal(invalidPhoneDb.userLookups,0);
const limitedDb=makeDb({blocked:true});
const limited=await worker.fetch(request("/api/auth/register/check-phone",{phone:PHONE,accountConsent:true}),env(limitedDb.DB));
assert.equal(limited.status,429);assert.equal((await limited.json()).error,"rate_limited");assert.equal(limitedDb.userLookups,0);
const missingSecretDb=makeDb();
const missingSecret=await worker.fetch(request("/api/auth/register/check-phone",{phone:PHONE,accountConsent:true}),{APP_ORIGIN:ORIGIN,DB:missingSecretDb.DB});
assert.equal(missingSecret.status,503);assert.equal((await missingSecret.json()).error,"rate_limit_secret_not_configured");assert.equal(missingSecretDb.userLookups,0);
const duplicateDb=makeDb({registeredPhone:PHONE});
const duplicate=await worker.fetch(request("/api/auth/register",{phone:PHONE,password:"Valid-Password-2026!",code:"123456",accountConsent:true}),env(duplicateDb.DB));
assert.equal(duplicate.status,409);assert.equal((await duplicate.json()).error,"phone_already_registered");
assert.equal(duplicateDb.userLookups,1);assert.equal(duplicateDb.otpLookups,0);
assert.ok([...registeredDb.buckets.keys()].every(key=>!key.includes(PHONE)&&!key.includes("203.0.113.77")));
console.log("Registration phone precheck tests: PASS (consent, phone validation, rate limits, lookup privacy, duplicate guard).");

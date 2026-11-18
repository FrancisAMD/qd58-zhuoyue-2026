import assert from "node:assert/strict";
import worker, { derivePassword, PBKDF2_ITERATIONS } from "../src/worker.js";
const ORIGIN="https://58er.eon21.space", API="https://api.58er.eon21.space";
const RATE_SECRET="password-lifecycle-test-rate-secret-0123456789";
const OLD="Old-Password-2026!", NEW="New-Password-2026!";
async function digest(v){const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("");}
async function hash(p,n){const salt=new Uint8Array(16).fill(n),bits=await derivePassword(p,salt);return "pbkdf2-sha256$"+PBKDF2_ITERATIONS+"$"+Buffer.from(salt).toString("base64")+"$"+Buffer.from(bits).toString("base64");}
const copy=v=>v===undefined?undefined:structuredClone(v);
function makeDb({user,sessions=[],challenge=null}){
 const state={user:copy(user),sessions:new Map(sessions.map(x=>[x.token_hash,copy(x)])),challenge:copy(challenge),limits:new Map(),audit:[],afterRead:null};
 const db={prepare(sql){return {sql,args:[],bind(...a){this.args=a;return this;},async first(){
  const a=this.args;
  if(sql.startsWith("SELECT u.id,u.phone,u.name")){const s=state.sessions.get(a[0]);if(!s||s.expires_at<=a[1]||!state.user||state.user.deleted_at!==""||s.user_id!==state.user.id||s.auth_version!==state.user.auth_version)return null;return {id:state.user.id,phone:state.user.phone,name:"Test Student",high_school:"青岛五十八中",class_name:"高三(1)班",university_id:null,grade:null,province:null,city:null,bio:null,phone_visible_to_team:0,consent_given:1,consent_at:"",consent_version:"",account_consent_at:"",account_consent_version:""};}
  if(sql.startsWith("SELECT password_hash,auth_version FROM users WHERE id=? AND deleted_at=''")){if(!state.user||state.user.id!==a[0]||state.user.deleted_at!=="")return null;const row={password_hash:state.user.password_hash,auth_version:state.user.auth_version};if(state.afterRead){const h=state.afterRead;state.afterRead=null;await h();}return row;}
  if(sql.startsWith("SELECT id,password_hash,auth_version FROM users WHERE phone=? AND deleted_at=''")){if(!state.user||state.user.phone!==a[0]||state.user.deleted_at!=="")return null;const row={id:state.user.id,password_hash:state.user.password_hash,auth_version:state.user.auth_version};if(state.afterRead){const h=state.afterRead;state.afterRead=null;await h();}return row;}
  if(sql.startsWith("SELECT id,out_id,expires_at,consumed_at,attempts FROM otp_challenges")){if(!state.challenge||state.challenge.phone!==a[0]||state.challenge.purpose!==a[1])return null;return copy(state.challenge);}
  return null;
 },async run(){
  const a=this.args;
  if(sql.startsWith("INSERT INTO rate_limits(")){const [k,t,reset,, ,limit]=a,old=state.limits.get(k);if(!old||old.window_started_at<=reset){state.limits.set(k,{window_started_at:t,hit_count:1});return {meta:{changes:1}};}if(old.hit_count<limit){old.hit_count++;return {meta:{changes:1}};}return {meta:{changes:0}};}
  if(sql.startsWith("INSERT INTO sessions(token_hash,user_id,expires_at,created_at,auth_version) SELECT")){const [token,expires,created,id,pw,ver]=a;if(!state.user||state.user.id!==id||state.user.deleted_at!==""||state.user.password_hash!==pw||state.user.auth_version!==ver)return {meta:{changes:0}};state.sessions.set(token,{token_hash:token,user_id:id,expires_at:expires,created_at:created,auth_version:ver});return {meta:{changes:1}};}
  if(sql.startsWith("UPDATE users SET password_hash=?,auth_version=auth_version+1")){const [pw,updated,id,...rest]=a,hasPhone=sql.includes("AND phone=?"),[phone,oldHash,oldVersion]=hasPhone?rest:[null,rest[0],rest[1]];if(!state.user||state.user.id!==id||state.user.deleted_at!==""||(hasPhone&&state.user.phone!==phone)||state.user.password_hash!==oldHash||state.user.auth_version!==oldVersion)return {meta:{changes:0}};state.user.password_hash=pw;state.user.auth_version++;state.user.updated_at=updated;return {meta:{changes:1}};}
  if(sql.startsWith("UPDATE sessions SET auth_version=")){const [id,pw,sessionId,token,existsId,existsPw]=a,s=state.sessions.get(token);if(!state.user||state.user.id!==id||state.user.password_hash!==pw||state.user.deleted_at!==""||!s||s.user_id!==sessionId||existsId!==id||existsPw!==pw)return {meta:{changes:0}};s.auth_version=state.user.auth_version;return {meta:{changes:1}};}
  if(sql.startsWith("DELETE FROM sessions WHERE user_id=? AND token_hash<>?")){const [id,except,existsId,pw]=a;if(state.user&&state.user.id===existsId&&state.user.password_hash===pw&&state.user.deleted_at==="")for(const [k,s] of state.sessions)if(s.user_id===id&&k!==except)state.sessions.delete(k);return {meta:{changes:1}};}
  if(sql.startsWith("DELETE FROM sessions WHERE user_id=? AND EXISTS")){const [id,existsId,pw,ver]=a;if(state.user&&state.user.id===existsId&&state.user.password_hash===pw&&state.user.auth_version===ver&&state.user.deleted_at==="")for(const [k,s] of state.sessions)if(s.user_id===id)state.sessions.delete(k);return {meta:{changes:1}};}
  if(sql.startsWith("UPDATE otp_challenges SET attempts=attempts+1")){if(!state.challenge||state.challenge.consumed_at||state.challenge.attempts>=5)return {meta:{changes:0}};state.challenge.attempts++;return {meta:{changes:1}};}
  if(sql.startsWith("UPDATE otp_challenges SET consumed_at=?")){if(!state.challenge||state.challenge.consumed_at)return {meta:{changes:0}};state.challenge.consumed_at=a[0];return {meta:{changes:1}};}
  if(sql.startsWith("INSERT INTO audit_logs")){const [id,actor,target,userId,pw,ver]=a;if(state.user&&state.user.id===userId&&state.user.password_hash===pw&&(ver===undefined||state.user.auth_version===ver)&&state.user.deleted_at===""){state.audit.push({id,actor,target,action:sql.includes("'user.password.reset'")?"user.password.reset":"user.password.changed",metadata:"{}"});return {meta:{changes:1}};}return {meta:{changes:0}};}
  return {meta:{changes:1}};
 }};},async batch(stmts){const snap={user:copy(state.user),sessions:new Map([...state.sessions].map(([k,v])=>[k,copy(v)])),audit:copy(state.audit)};try{const r=[];for(const s of stmts)r.push(await s.run());return r;}catch(e){state.user=snap.user;state.sessions=snap.sessions;state.audit=snap.audit;throw e;}}};
 return {db,state};
}
function req(path,data,token=""){const h={"content-type":"application/json",origin:ORIGIN,"CF-Connecting-IP":"203.0.113.45"};if(token)h.cookie="__Host-qd58_session="+token;return new Request(API+path,{method:"POST",headers:h,body:JSON.stringify(data)});}
const env=DB=>({APP_ORIGIN:ORIGIN,DB,RATE_LIMIT_HMAC_SECRET:RATE_SECRET,ALIBABA_ACCESS_KEY_ID:"test-key",ALIBABA_ACCESS_KEY_SECRET:"test-secret"});
const session=(u,token)=>({token_hash:token,user_id:u.id,expires_at:Math.floor(Date.now()/1000)+3600,created_at:1,auth_version:u.auth_version});
async function countDerivations(run){
 const subtle=crypto.subtle,original=subtle.deriveBits;let count=0;
 subtle.deriveBits=async function(...args){count++;return original.apply(this,args);};
 try{return {value:await run(),count};}finally{subtle.deriveBits=original;}
}
const originalFetch=globalThis.fetch;
globalThis.fetch=async(input,init={})=>{const u=new URL(typeof input==="string"?input:input.url);if(u.hostname==="dypnsapi.aliyuncs.com"&&init.headers?.["x-acs-action"]==="CheckSmsVerifyCode")return new Response(JSON.stringify({Success:true,Code:"OK",Model:{VerifyResult:"PASS"},RequestId:"mock-only"}),{status:200});throw new Error("Unexpected outbound request: "+u.hostname);};
try{
 const oldHash=await hash(OLD,11),currentToken="a".repeat(64),otherToken="b".repeat(64);
 const user={id:"pw-user-1",phone:"13800138000",password_hash:oldHash,auth_version:1,deleted_at:""};
 const {db,state}=makeDb({user,sessions:[session(user,await digest(currentToken)),session(user,await digest(otherToken))]});
 const e=env(db);
 assert.equal((await worker.fetch(req("/api/auth/password/change",{currentPassword:OLD,newPassword:NEW}),e)).status,401);
 const changed=await worker.fetch(req("/api/auth/password/change",{currentPassword:OLD,newPassword:NEW},currentToken),e);
 assert.equal(changed.status,200);assert.deepEqual(await changed.json(),{ok:true,sessionsRevoked:true});
 assert.equal(state.user.auth_version,2);assert.equal(state.sessions.size,1);assert.equal(state.sessions.get(await digest(currentToken)).auth_version,2);
 assert.equal(state.audit.at(-1).action,"user.password.changed");assert.equal(JSON.stringify(state.audit).includes(user.phone),false);
 const okProfile=await worker.fetch(new Request(API+"/api/profile",{headers:{origin:ORIGIN,cookie:"__Host-qd58_session="+currentToken}}),e);assert.equal(okProfile.status,200);
 const oldProfile=await worker.fetch(new Request(API+"/api/profile",{headers:{origin:ORIGIN,cookie:"__Host-qd58_session="+otherToken}}),e);assert.equal(oldProfile.status,401);

 const resetUser={id:"pw-user-2",phone:"13900139000",password_hash:await hash(OLD,12),auth_version:1,deleted_at:""};
 const challenge={id:"otp-1",phone:resetUser.phone,out_id:"pnvs-1",expires_at:Math.floor(Date.now()/1000)+300,consumed_at:null,attempts:0,purpose:"password_reset"};
 const resetToken="c".repeat(64),resetDb=makeDb({user:resetUser,sessions:[session(resetUser,await digest(resetToken))],challenge}),re=env(resetDb.db);
 const reset=await worker.fetch(req("/api/auth/password/reset",{phone:resetUser.phone,code:"246810",newPassword:NEW}),re);
 assert.equal(reset.status,200);assert.deepEqual(await reset.json(),{ok:true,sessionsRevoked:true});
 assert.equal(resetDb.state.user.auth_version,2);assert.equal(resetDb.state.sessions.size,0);assert.ok(resetDb.state.challenge.consumed_at);
 assert.equal(resetDb.state.audit.at(-1).action,"user.password.reset");assert.equal(JSON.stringify(resetDb.state.audit).includes(resetUser.phone),false);
 assert.match(reset.headers.get("set-cookie")||"",/Max-Age=0/);
 const replay=await worker.fetch(req("/api/auth/password/reset",{phone:resetUser.phone,code:"246810",newPassword:"Another-Password-2026!"}),re);
 assert.equal(replay.status,400);assert.equal((await replay.json()).error,"invalid_code");assert.equal(resetDb.state.user.auth_version,2);
 assert.equal((await worker.fetch(req("/api/auth/login",{phone:resetUser.phone,password:OLD}),re)).status,401);
 assert.equal((await worker.fetch(req("/api/auth/login",{phone:resetUser.phone,password:NEW}),re)).status,200);
 assert.equal([...resetDb.state.sessions.values()][0].auth_version,2);

 const unknownLoginDb=makeDb({user:null});
 const unknownLogin=await countDerivations(()=>worker.fetch(req("/api/auth/login",{phone:"13500135000",password:OLD}),env(unknownLoginDb.db)));
 assert.equal(unknownLogin.value.status,401);assert.equal(unknownLogin.count,1,"unknown user login must still perform one PBKDF2 derivation");
 const wrongPasswordUser={id:"pw-user-wrong",phone:"13400134000",password_hash:oldHash,auth_version:1,deleted_at:""},wrongPasswordDb=makeDb({user:wrongPasswordUser});
 const wrongPasswordLogin=await countDerivations(()=>worker.fetch(req("/api/auth/login",{phone:wrongPasswordUser.phone,password:"Wrong-Password-2026!"}),env(wrongPasswordDb.db)));
 assert.equal(wrongPasswordLogin.value.status,401);assert.equal(wrongPasswordLogin.count,1,"known user with wrong password must perform one PBKDF2 derivation");
 const oversizedLogin=await worker.fetch(req("/api/auth/login",{phone:wrongPasswordUser.phone,password:"x".repeat(129)}),env(wrongPasswordDb.db));
 assert.equal(oversizedLogin.status,400,"oversized login passwords must be rejected before expensive derivation");

 const stale={id:"pw-user-3",phone:"13700137000",password_hash:await hash(OLD,13),auth_version:1,deleted_at:""},staleDb=makeDb({user:stale});
 staleDb.state.afterRead=async()=>{staleDb.state.user.password_hash=await hash(NEW,14);staleDb.state.user.auth_version=2;};
 const staleLogin=await worker.fetch(req("/api/auth/login",{phone:stale.phone,password:OLD}),env(staleDb.db));
 assert.equal(staleLogin.status,401);assert.equal(staleDb.state.sessions.size,0);

 const conflict={id:"pw-user-4",phone:"13600136000",password_hash:await hash(OLD,15),auth_version:1,deleted_at:""},conflictToken="d".repeat(64);
 const conflictDb=makeDb({user:conflict,sessions:[session(conflict,await digest(conflictToken))]});
 conflictDb.state.afterRead=async()=>{conflictDb.state.user.password_hash=await hash(NEW,16);conflictDb.state.user.auth_version=2;};
 const conflictResponse=await worker.fetch(req("/api/auth/password/change",{currentPassword:OLD,newPassword:"Third-Password-2026!"},conflictToken),env(conflictDb.db));
 assert.equal(conflictResponse.status,409);assert.equal(conflictDb.state.audit.length,0);
 console.log("Password lifecycle tests: PASS (session versions, atomic change/reset, OTP replay, audit minimization and stale-login/CAS races).");
}finally{globalThis.fetch=originalFetch;}

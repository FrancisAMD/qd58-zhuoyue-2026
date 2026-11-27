import { pbkdf2Sync } from "node:crypto";
import worker, { derivePassword, PBKDF2_ITERATIONS } from "../src/worker.js";

const ORIGIN = "https://58er.eon21.space";
const RATE_LIMIT_SECRET = "admin-auth-audit-test-secret-0123456789abcdef";
const ADMIN_PASSWORD = "Correct-Test-Password-Only";
const b64 = bytes => {
  let binary = "";
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary);
};
async function passwordHash(password) {
  const salt = Uint8Array.from({length:16},(_,i)=>i+1);
  const derived = await derivePassword(password,salt);
  return "pbkdf2-sha256$"+PBKDF2_ITERATIONS+"$"+b64(salt)+"$"+b64(derived);
}

// Match scripts/create-admin.mjs exactly: the bootstrap utility uses Node's
// PBKDF2-SHA256 implementation with the same iterations, salt and key length.
function bootstrapPasswordHash(password) {
  const salt = Uint8Array.from({length:16},(_,i)=>i+1);
  const derived = pbkdf2Sync(password,Buffer.from(salt),PBKDF2_ITERATIONS,32,"sha256");
  return "pbkdf2-sha256$"+PBKDF2_ITERATIONS+"$"+b64(salt)+"$"+b64(derived);
}
class AuditDB {
  constructor(account=null,{rateLimitAllowed=true,failAudit=false}={}) {
    this.account=account;
    this.rateLimitAllowed=rateLimitAllowed;
    this.failAudit=failAudit;
    this.auditRows=[];
    this.adminSession=null;
    this.lastLoginAt="";
  }
  prepare(sql) {
    const db=this;
    let args=[];
    return {
      bind(...values) { args=values; return this; },
      first: async () => {
        if(sql.startsWith("SELECT id,username,password_hash,role,active FROM admin_users")) return db.account;
        if(sql.startsWith("SELECT a.id,a.username,a.role FROM admin_sessions")) {
          if(!db.adminSession || args[0]!==db.adminSession.tokenHash || Number(args[1])>=db.adminSession.expiresAt) return null;
          return {id:db.account.id,username:db.account.username,role:db.account.role};
        }
        return null;
      },
      run: async () => {
        if(sql.startsWith("INSERT INTO rate_limits")) return {meta:{changes:db.rateLimitAllowed?1:0}};
        if(sql.startsWith("INSERT INTO admin_sessions")) {
          db.adminSession={tokenHash:args[0],adminUserId:args[1],expiresAt:Number(args[2]),createdAt:Number(args[3])};
        }
        if(sql.startsWith("UPDATE admin_users SET last_login_at")) db.lastLoginAt=args[0];
        if(sql.startsWith("INSERT INTO audit_logs")) {
          if(db.failAudit) throw new Error("simulated audit storage outage");
          db.auditRows.push(args);
        }
        return {meta:{changes:1}};
      }
    };
  }
  async batch(statements) {
    const results=[];
    for(const statement of statements) results.push(await statement.run());
    return results;
  }
}
async function countDerivations(run){
  const subtle=crypto.subtle,original=subtle.deriveBits;let count=0;
  subtle.deriveBits=async function(...args){count++;return original.apply(this,args);};
  try{return {value:await run(),count};}finally{subtle.deriveBits=original;}
}
async function attempt({db,username="not-a-real-admin",password="Wrong-Password",ip="203.0.113.50",rateLimitSecret=RATE_LIMIT_SECRET}) {
  return worker.fetch(new Request(ORIGIN+"/api/admin/login",{
    method:"POST",
    headers:{"content-type":"application/json",origin:ORIGIN,"CF-Connecting-IP":ip},
    body:JSON.stringify({username,password})
  }),{APP_ORIGIN:ORIGIN,DB:db,RATE_LIMIT_HMAC_SECRET:rateLimitSecret});
}
function assertAudit(db,reason,{username,password,ip}) {
  if(db.auditRows.length!==1) throw new Error("credential rejection must create exactly one audit event");
  const [id,actorType,actorId,action,targetType,targetId,metadata]=db.auditRows[0];
  if(!id || actorType!=="system" || actorId!==null || action!=="admin.login.failed" || targetType!=="admin_authentication" || targetId!==null) {
    throw new Error("failed-login audit event shape is incorrect");
  }
  const parsed=JSON.parse(metadata);
  if(parsed.reason!==reason || Object.keys(parsed).length!==1) throw new Error("failed-login audit metadata must contain only the reason category");
  const serialized=JSON.stringify(db.auditRows);
  for(const secret of [username,password,ip]) if(secret && serialized.includes(secret)) throw new Error("failed-login audit must not store submitted identifiers or credentials");
}
const goodHash=await passwordHash(ADMIN_PASSWORD);

// The bootstrap SQL hash must be accepted by the Worker, a session must be
// created, and the __Host admin cookie must authenticate /admin/me.
const bootstrapDb=new AuditDB({
  id:"admin-owner",username:"rootops",password_hash:bootstrapPasswordHash(ADMIN_PASSWORD),role:"owner",active:1
});
const bootstrapLogin=await countDerivations(()=>attempt({
  db:bootstrapDb,username:"rootops",password:ADMIN_PASSWORD,ip:"203.0.113.56"
}));
if(bootstrapLogin.count!==1) throw new Error("successful admin login must perform one PBKDF2 derivation");
const bootstrapResponse=bootstrapLogin.value;
if(bootstrapResponse.status!==200) throw new Error("bootstrap-generated owner credentials must log in");
const bootstrapBody=await bootstrapResponse.json();
if(bootstrapBody.admin?.username!=="rootops" || bootstrapBody.admin?.role!=="owner") {
  throw new Error("successful admin login must return the expected non-secret identity and role");
}
if(JSON.stringify(bootstrapBody).includes(ADMIN_PASSWORD)) throw new Error("admin login response must never contain the password");
const bootstrapCookie=bootstrapResponse.headers.get("set-cookie")||"";
const cookieMatch=/^__Host-qd58_admin=([a-f0-9]{64}); Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800$/.exec(bootstrapCookie);
if(!cookieMatch) throw new Error("successful admin login must set the secure host-only admin cookie");
if(!bootstrapDb.adminSession || !bootstrapDb.lastLoginAt) throw new Error("successful admin login must persist the session and last-login timestamp");
if(bootstrapDb.auditRows.at(-1)?.[3]!=="admin.login.succeeded") throw new Error("successful admin login audit event missing");
const meResponse=await worker.fetch(new Request(ORIGIN+"/api/admin/me",{
  headers:{origin:ORIGIN,cookie:"__Host-qd58_admin="+cookieMatch[1]}
}),{APP_ORIGIN:ORIGIN,DB:bootstrapDb});
if(meResponse.status!==200 || (await meResponse.json()).admin?.role!=="owner") {
  throw new Error("the issued admin cookie must authenticate the session");
}

// Missing RATE_LIMIT_HMAC_SECRET is a server configuration error, not a
// password error. It must fail closed before looking up accounts or deriving.
const viewerAccountDb=new AuditDB({
  id:"admin-legacy-viewer",username:"legacyviewer",password_hash:bootstrapPasswordHash(ADMIN_PASSWORD),role:"viewer",active:1
});
const viewerLogin=await attempt({db:viewerAccountDb,username:"legacyviewer",password:ADMIN_PASSWORD,ip:"203.0.113.58"});
if(viewerLogin.status!==401 || (await viewerLogin.json()).error!=="invalid_credentials") {
  throw new Error("legacy viewer role must no longer authenticate");
}
assertAudit(viewerAccountDb,"unsupported_role",{username:"legacyviewer",password:ADMIN_PASSWORD,ip:"203.0.113.58"});
if(viewerAccountDb.adminSession) throw new Error("legacy viewer account must not receive a session");

const noSecretDb=new AuditDB({id:"admin-owner",username:"rootops",password_hash:goodHash,role:"owner",active:1});
const noSecretRun=await countDerivations(()=>attempt({
  db:noSecretDb,username:"rootops",password:ADMIN_PASSWORD,ip:"203.0.113.57",rateLimitSecret:""
}));
if(noSecretRun.count!==0) throw new Error("admin login without rate-limit secret must stop before password verification");
if(noSecretRun.value.status!==503 || (await noSecretRun.value.json()).error!=="rate_limit_secret_not_configured") {
  throw new Error("missing RATE_LIMIT_HMAC_SECRET must return an explicit 503 configuration error");
}
if(noSecretDb.adminSession || noSecretDb.auditRows.length!==0) {
  throw new Error("unconfigured admin login must not create a session or credential audit event");
}

const unknownDb=new AuditDB(null);
const unknownRun=await countDerivations(()=>attempt({db:unknownDb,username:"missing-admin",password:"bad-password",ip:"203.0.113.51"}));
const unknown=unknownRun.value;
if(unknownRun.count!==1) throw new Error("unknown admin login must perform one dummy PBKDF2 derivation");
if(unknown.status!==401 || (await unknown.json()).error!=="invalid_credentials") throw new Error("unknown account must return generic 401");
assertAudit(unknownDb,"unknown_account",{username:"missing-admin",password:"bad-password",ip:"203.0.113.51"});

const inactiveDb=new AuditDB({id:"admin-inactive",username:"disabled",password_hash:goodHash,role:"admin",active:0});
const inactiveRun=await countDerivations(()=>attempt({db:inactiveDb,username:"disabled",password:"any-password",ip:"203.0.113.52"}));
const inactive=inactiveRun.value;
if(inactiveRun.count!==1) throw new Error("inactive admin login must perform one PBKDF2 derivation");
if(inactive.status!==401 || (await inactive.json()).error!=="invalid_credentials") throw new Error("inactive account must return generic 401");
assertAudit(inactiveDb,"inactive_account",{username:"disabled",password:"any-password",ip:"203.0.113.52"});

const mismatchDb=new AuditDB({id:"admin-active",username:"active",password_hash:goodHash,role:"admin",active:1});
const mismatchRun=await countDerivations(()=>attempt({db:mismatchDb,username:"active",password:"wrong-password",ip:"203.0.113.53"}));
const mismatch=mismatchRun.value;
if(mismatchRun.count!==1) throw new Error("known admin with wrong password must perform one PBKDF2 derivation");
if(mismatch.status!==401 || (await mismatch.json()).error!=="invalid_credentials") throw new Error("wrong password must return generic 401");
assertAudit(mismatchDb,"password_mismatch",{username:"active",password:"wrong-password",ip:"203.0.113.53"});

const limitedDb=new AuditDB(null,{rateLimitAllowed:false});
const limitedRun=await countDerivations(()=>attempt({db:limitedDb,username:"blocked-admin",password:"wrong-password",ip:"203.0.113.54"}));
const limited=limitedRun.value;
if(limitedRun.count!==0) throw new Error("rate-limited admin requests must not spend PBKDF2 work");
if(limited.status!==429 || (await limited.json()).error!=="rate_limited" || limitedDb.auditRows.length!==0) {
  throw new Error("rate-limited attempts must not create unbounded audit rows");
}

const unavailableDb=new AuditDB(null,{failAudit:true});
const unavailable=await attempt({db:unavailableDb,username:"audit-outage-admin",password:"wrong-password",ip:"203.0.113.55"});
if(unavailable.status!==401 || (await unavailable.json()).error!=="invalid_credentials") {
  throw new Error("audit storage outage must not disclose account state or change generic authentication response");
}

console.log("Admin auth audit tests: PASS (unknown/inactive/password mismatch, PII-free audit metadata, rate-limit flood protection and audit-storage failure handling).");

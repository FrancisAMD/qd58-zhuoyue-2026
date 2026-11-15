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
  return `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${b64(salt)}$${b64(derived)}`;
}
class AuditDB {
  constructor(account=null,{rateLimitAllowed=true,failAudit=false}={}) {
    this.account=account;
    this.rateLimitAllowed=rateLimitAllowed;
    this.failAudit=failAudit;
    this.auditRows=[];
  }
  prepare(sql) {
    const db=this;
    return {
      bind(...args) {
        return {
          first: async () => {
            if(sql.startsWith("SELECT id,username,password_hash,role,active FROM admin_users")) return db.account;
            return null;
          },
          run: async () => {
            if(sql.startsWith("INSERT INTO rate_limits")) return {meta:{changes:db.rateLimitAllowed?1:0}};
            if(sql.startsWith("INSERT INTO audit_logs")) {
              if(db.failAudit) throw new Error("simulated audit storage outage");
              db.auditRows.push(args);
            }
            return {meta:{changes:1}};
          }
        };
      }
    };
  }
}
async function attempt({db,username="not-a-real-admin",password="Wrong-Password",ip="203.0.113.50"}) {
  return worker.fetch(new Request(ORIGIN+"/api/admin/login",{
    method:"POST",
    headers:{"content-type":"application/json",origin:ORIGIN,"CF-Connecting-IP":ip},
    body:JSON.stringify({username,password})
  }),{APP_ORIGIN:ORIGIN,DB:db,RATE_LIMIT_HMAC_SECRET:RATE_LIMIT_SECRET});
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

const unknownDb=new AuditDB(null);
const unknown=await attempt({db:unknownDb,username:"missing-admin",password:"bad-password",ip:"203.0.113.51"});
if(unknown.status!==401 || (await unknown.json()).error!=="invalid_credentials") throw new Error("unknown account must return generic 401");
assertAudit(unknownDb,"unknown_account",{username:"missing-admin",password:"bad-password",ip:"203.0.113.51"});

const inactiveDb=new AuditDB({id:"admin-inactive",username:"disabled",password_hash:goodHash,role:"admin",active:0});
const inactive=await attempt({db:inactiveDb,username:"disabled",password:"any-password",ip:"203.0.113.52"});
if(inactive.status!==401 || (await inactive.json()).error!=="invalid_credentials") throw new Error("inactive account must return generic 401");
assertAudit(inactiveDb,"inactive_account",{username:"disabled",password:"any-password",ip:"203.0.113.52"});

const mismatchDb=new AuditDB({id:"admin-active",username:"active",password_hash:goodHash,role:"admin",active:1});
const mismatch=await attempt({db:mismatchDb,username:"active",password:"wrong-password",ip:"203.0.113.53"});
if(mismatch.status!==401 || (await mismatch.json()).error!=="invalid_credentials") throw new Error("wrong password must return generic 401");
assertAudit(mismatchDb,"password_mismatch",{username:"active",password:"wrong-password",ip:"203.0.113.53"});

const limitedDb=new AuditDB(null,{rateLimitAllowed:false});
const limited=await attempt({db:limitedDb,username:"blocked-admin",password:"wrong-password",ip:"203.0.113.54"});
if(limited.status!==429 || (await limited.json()).error!=="rate_limited" || limitedDb.auditRows.length!==0) {
  throw new Error("rate-limited attempts must not create unbounded audit rows");
}

const unavailableDb=new AuditDB(null,{failAudit:true});
const unavailable=await attempt({db:unavailableDb,username:"audit-outage-admin",password:"wrong-password",ip:"203.0.113.55"});
if(unavailable.status!==401 || (await unavailable.json()).error!=="invalid_credentials") {
  throw new Error("audit storage outage must not disclose account state or change generic authentication response");
}

console.log("Admin auth audit tests: PASS (unknown/inactive/password mismatch, PII-free audit metadata, rate-limit flood protection and audit-storage failure handling).");

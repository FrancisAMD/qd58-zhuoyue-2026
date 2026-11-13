import worker, { derivePassword, PBKDF2_ITERATIONS } from "../src/worker.js";
const env={APP_ORIGIN:"https://58er.eon21.space"};
if(PBKDF2_ITERATIONS!==100000) throw new Error("PBKDF2 iteration count must stay within Workers production limit");
const salt=new Uint8Array(16).fill(0x5a);
const derived=await derivePassword("worker-smoke-password",salt);
const derivedAgain=await derivePassword("worker-smoke-password",salt);
const derivedOtherSalt=await derivePassword("worker-smoke-password",new Uint8Array(16).fill(0x5b));
if(derived.length!==32 || derived.some((v,i)=>v!==derivedAgain[i]) || derived.every((v,i)=>v===derivedOtherSalt[i])) throw new Error("PBKDF2 100000 smoke test failed");
const ok=await worker.fetch(new Request("https://api.58er.eon21.space/api/health"),env);
const health=await ok.json();
if(ok.status!==200 || !health.ok || health.build!=="admin-rbac-20261113" || health.passwordKdf!=="pbkdf2-sha256-100000") throw new Error("health route/build marker failed");
const blocked=await worker.fetch(new Request("https://api.58er.eon21.space/api/auth/login",{method:"POST",headers:{"content-type":"application/json",origin:"https://evil.example"},body:JSON.stringify({phone:"13800000000",password:"test"})}),env);
if(blocked.status!==403) throw new Error("origin guard failed");
const preflight=await worker.fetch(new Request("https://api.58er.eon21.space/api/auth/login",{method:"OPTIONS",headers:{origin:"https://58er.eon21.space","access-control-request-method":"POST"}}),env);
if(preflight.status!==204 || preflight.headers.get("access-control-allow-credentials")!=="true") throw new Error("CORS preflight failed");
const registrationWithoutConsent=await worker.fetch(new Request("https://api.58er.eon21.space/api/auth/register/request-code",{method:"POST",headers:{"content-type":"application/json",origin:"https://58er.eon21.space"},body:JSON.stringify({phone:"13812345678",turnstileToken:"unused"})}),{APP_ORIGIN:"https://58er.eon21.space"});
const registrationWithoutConsentBody=await registrationWithoutConsent.json();
if(registrationWithoutConsent.status!==400 || registrationWithoutConsentBody.error!=="consent_required") throw new Error("registration SMS must require privacy consent");

const consentDb={prepare(sql){return {bind(){return {first:async()=>sql.startsWith("SELECT u.id,u.phone")?{id:"consent-user",phone:"13800000000",consent_given:0,consent_at:"",consent_version:"",account_consent_at:"",account_consent_version:""}:null,run:async()=>({meta:{changes:1}})}}}}};
const missingConsent=await worker.fetch(new Request("https://api.58er.eon21.space/api/profile",{method:"PUT",headers:{"content-type":"application/json",origin:"https://58er.eon21.space",cookie:"__Host-qd58_session="+"d".repeat(64)},body:JSON.stringify({})}),{APP_ORIGIN:"https://58er.eon21.space",DB:consentDb});
const missingConsentBody=await missingConsent.json();
if(missingConsent.status!==400 || missingConsentBody.error!=="consent_required") throw new Error("profile save must require explicit privacy consent");

const nowSeconds=Math.floor(Date.now()/1000);
const lockedDb={
  prepare(sql){
    return {bind(...args){
      return {
        first:async()=>{
          if(sql.startsWith("SELECT id FROM users")) return null;
          if(sql.startsWith("SELECT window_started_at,hit_count FROM rate_limits")){
            if(args[0]==="sms:cooldown:13812345678") return {window_started_at:nowSeconds-20,hit_count:1};
            return null;
          }
          return null;
        },
        run:async()=>({meta:{changes:1}})
      };
    }};
  }
};
const limited=await worker.fetch(new Request("https://api.58er.eon21.space/api/auth/register/request-code",{
  method:"POST",
  headers:{"content-type":"application/json",origin:"https://58er.eon21.space"},
  body:JSON.stringify({phone:"13812345678",turnstileToken:"unused-test-token",accountConsent:true})
}),{APP_ORIGIN:"https://58er.eon21.space",DB:lockedDb});
const limitedBody=await limited.json();

if(limited.status!==429 || limitedBody.error!=="rate_limited" || limitedBody.refreshTurnstile===true || !(limitedBody.retryAfter>0)) throw new Error("SMS cooldown must not consume Turnstile token");

// If PNVS explicitly rejects a send, all SMS quota reservations must be rolled back.
const quotaRows=new Map();
const quotaDb={
  prepare(sql){
    return {bind(...args){
      return {
        first:async()=>{
          if(sql.startsWith("SELECT id FROM users")) return null;
          if(sql.startsWith("SELECT window_started_at,hit_count FROM rate_limits") || sql.startsWith("SELECT window_started_at FROM rate_limits")) return quotaRows.get(args[0])||null;
          return null;
        },
        run:async()=>{
          if(sql.startsWith("INSERT INTO rate_limits")){
            const key=args[0],t=args[1],resetAt=args[2],limit=args[5],old=quotaRows.get(key);
            if(!old){quotaRows.set(key,{window_started_at:t,hit_count:1});return {meta:{changes:1}}}
            if(old.window_started_at<=resetAt){quotaRows.set(key,{window_started_at:t,hit_count:1});return {meta:{changes:1}}}
            if(old.hit_count<limit){old.hit_count++;return {meta:{changes:1}}}
            return {meta:{changes:0}};
          }
          if(sql.startsWith("UPDATE rate_limits SET hit_count=hit_count-1")){
            const [key,started]=args,row=quotaRows.get(key);
            if(row&&row.window_started_at===started&&row.hit_count>0){row.hit_count--;return {meta:{changes:1}}}
            return {meta:{changes:0}};
          }
          return {meta:{changes:1}};
        }
      };
    }};
  },
  async batch(statements){const out=[];for(const statement of statements)out.push(await statement.run());return out;}
};
const originalFetch=globalThis.fetch;
try{
  globalThis.fetch=async input=>{
    if(String(input).includes("/turnstile/v0/siteverify")) return new Response(JSON.stringify({success:true,action:"register",hostname:"58er.eon21.space"}),{status:200});
    return new Response(JSON.stringify({Success:false,Code:"isv.BUSINESS_LIMIT_CONTROL",RequestId:"mock-rejected"}),{status:400});
  };
  const rejected=await worker.fetch(new Request("https://api.58er.eon21.space/api/auth/register/request-code",{
    method:"POST",headers:{"content-type":"application/json",origin:"https://58er.eon21.space","CF-Connecting-IP":"203.0.113.10"},
    body:JSON.stringify({phone:"13812345679",turnstileToken:"mock-valid-token",accountConsent:true})
  }),{APP_ORIGIN:"https://58er.eon21.space",DB:quotaDb,TURNSTILE_SECRET_KEY:"mock-secret",ALIBABA_ACCESS_KEY_ID:"mock",ALIBABA_ACCESS_KEY_SECRET:"mock"});
  if(rejected.status!==400) throw new Error("Mock PNVS rejection should return a provider error");
  if([...quotaRows.values()].some(row=>row.hit_count!==0)) throw new Error("SMS quota reservation was not released after PNVS rejection");
}finally{globalThis.fetch=originalFetch}

const unauthPasswordChange=await worker.fetch(new Request("https://api.58er.eon21.space/api/auth/password/change",{method:"POST",headers:{"content-type":"application/json",origin:"https://58er.eon21.space"},body:JSON.stringify({})}),{APP_ORIGIN:"https://58er.eon21.space",DB:{prepare(){return {bind(){return {first:async()=>null}}}}}});
if(unauthPasswordChange.status!==401) throw new Error("password change must require an authenticated session");
const unauthTransfer=await worker.fetch(new Request("https://api.58er.eon21.space/api/teams/transfer",{method:"POST",headers:{"content-type":"application/json",origin:"https://58er.eon21.space"},body:JSON.stringify({toUserId:"a".repeat(32)})}),env);
const unauthTransferList=await worker.fetch(new Request("https://api.58er.eon21.space/api/teams/transfers",{headers:{origin:"https://58er.eon21.space"}}),env);
if(unauthTransfer.status!==401 || unauthTransferList.status!==401) throw new Error("team transfer endpoints must require a session");
const recipientDb={
  prepare(sql){
    return {bind(...args){
      return {first:async()=>{
        if(sql.startsWith("SELECT u.id")) return {id:"u2",phone:"13800000002",name:"测试接收者",university_id:"uni1"};
        if(sql.startsWith("SELECT id,to_user_id,status FROM leader_transfers")) return {id:args[0],to_user_id:"u3",status:"pending"};
        return null;
      }};
    }};
  }
};
const wrongRecipient=await worker.fetch(new Request("https://api.58er.eon21.space/api/teams/transfer/"+ "b".repeat(32)+"/accept",{
  method:"POST",headers:{origin:"https://58er.eon21.space",cookie:"__Host-qd58_session="+"c".repeat(64)}
}),{APP_ORIGIN:"https://58er.eon21.space",DB:recipientDb});
if(wrongRecipient.status!==403) throw new Error("only the designated transfer recipient may accept a transfer");

function encodeBase64(bytes){return Buffer.from(bytes).toString("base64")}
async function makePasswordHash(password){
  const salt=new Uint8Array(16).fill(0x61);
  const derived=await derivePassword(password,salt);
  return "pbkdf2-sha256$"+PBKDF2_ITERATIONS+"$"+encodeBase64(salt)+"$"+encodeBase64(derived);
}
const adminPassword="Admin-Test-Passphrase-2026!";
const adminHash=await makePasswordHash(adminPassword);
const ownerRow={id:"a".repeat(32),username:"rootops",password_hash:adminHash,role:"owner",active:1};
const ownerDb={
  prepare(sql){
    return {bind(...args){
      return {
        first:async()=>{
          if(sql.startsWith("SELECT id,username,password_hash,role,active FROM admin_users")) return ownerRow;
          if(sql.startsWith("SELECT a.id,a.username,a.role FROM admin_sessions")) return {id:ownerRow.id,username:ownerRow.username,role:ownerRow.role};
          if(sql.startsWith("SELECT COUNT(*) AS total FROM users u")) return {total:1};
          if(sql.startsWith("SELECT COUNT(*) AS total FROM users")) return {total:3,completed:2,consented:2};
          if(sql.startsWith("SELECT COUNT(*) AS total FROM teams")) return {total:1};
          if(sql.startsWith("SELECT COUNT(*) AS total FROM audit_logs")) return {total:2};
          if(sql.startsWith("SELECT id,role,active FROM admin_users")) return {id:"b".repeat(32),role:"admin",active:1};
          return null;
        },
        all:async()=>{
          if(sql.startsWith("SELECT u.id")) return {results:[{id:"u1",name:"=2+2",className:"高一(1)班",university:"青岛大学",grade:"大一",province:"山东省",consentGiven:1,createdAt:"2026-11-13"}]};
          if(sql.startsWith("SELECT l.id")) return {results:[{id:"log1",actorType:"admin",actorUsername:"rootops",action:"admin.people.exported",targetType:"user_collection",targetId:null,metadata:"{}",createdAt:"2026-11-13"}]};
          if(sql.startsWith("SELECT id,username,role,active")) return {results:[{id:"b".repeat(32),username:"ops",role:"admin",active:1}]};
          return {results:[]};
        },
        run:async()=>({meta:{changes:1}})
      };
    }};
  },
  async batch(statements){const out=[];for(const statement of statements)out.push(await statement.run());return out;}
};
const adminLogin=await worker.fetch(new Request("https://api.58er.eon21.space/api/admin/login",{
  method:"POST",headers:{"content-type":"application/json",origin:"https://58er.eon21.space","CF-Connecting-IP":"203.0.113.20"},
  body:JSON.stringify({username:"rootops",password:adminPassword})
}),{APP_ORIGIN:"https://58er.eon21.space",DB:ownerDb});
const adminLoginBody=await adminLogin.json();
const adminCookie=adminLogin.headers.get("set-cookie")||"";
if(adminLogin.status!==200 || adminLoginBody.admin?.role!=="owner" || !adminCookie.startsWith("__Host-qd58_admin=") || !adminCookie.includes("HttpOnly") || !adminCookie.includes("SameSite=Strict")) throw new Error("independent admin login and secure cookie failed");
const adminMe=await worker.fetch(new Request("https://api.58er.eon21.space/api/admin/me",{headers:{origin:"https://58er.eon21.space",cookie:adminCookie.split(";")[0]}}),{APP_ORIGIN:"https://58er.eon21.space",DB:ownerDb});
if(adminMe.status!==200 || (await adminMe.json()).admin?.role!=="owner") throw new Error("admin session validation failed");

function sessionDb(role){
  return {
    prepare(sql){return {bind(...args){return {
      first:async()=>{
        if(sql.startsWith("SELECT a.id,a.username,a.role FROM admin_sessions")) return {id:"c".repeat(32),username:"role-test",role};
        if(sql.startsWith("SELECT COUNT(*) AS total FROM users u")) return {total:1};
        if(sql.startsWith("SELECT COUNT(*) AS total FROM users")) return {total:1,completed:1,consented:1};
        if(sql.startsWith("SELECT COUNT(*) AS total FROM teams")) return {total:1};
        if(sql.startsWith("SELECT COUNT(*) AS total FROM audit_logs")) return {total:1};
        if(sql.startsWith("SELECT id,role,active FROM admin_users")) return {id:"b".repeat(32),role:"admin",active:1};
        return null;
      },
      all:async()=>{
        if(sql.startsWith("SELECT u.id")) return {results:[{id:"u1",name:"=2+2",className:"高一(1)班",university:"青岛大学",grade:"大一",province:"山东省",consentGiven:1,createdAt:"2026-11-13"}]};
        if(sql.startsWith("SELECT l.id")) return {results:[{id:"log1",actorType:"admin",actorUsername:"role-test",action:"admin.test",targetType:"user",targetId:"u1",metadata:"{}",createdAt:"2026-11-13"}]};
        if(sql.startsWith("SELECT id,username,role,active")) return {results:[{id:"b".repeat(32),username:"ops",role:"admin",active:1}]};
        return {results:[]};
      },
      run:async()=>({meta:{changes:1}})
    }}}},
    async batch(statements){const out=[];for(const statement of statements)out.push(await statement.run());return out;}
  };
}
const viewerDb=sessionDb("viewer"),viewerCookie="__Host-qd58_admin="+"f".repeat(64);
const viewerPeople=await worker.fetch(new Request("https://api.58er.eon21.space/api/admin/people",{headers:{origin:"https://58er.eon21.space",cookie:viewerCookie}}),{APP_ORIGIN:"https://58er.eon21.space",DB:viewerDb});
const viewerAudit=await worker.fetch(new Request("https://api.58er.eon21.space/api/admin/audit",{headers:{origin:"https://58er.eon21.space",cookie:viewerCookie}}),{APP_ORIGIN:"https://58er.eon21.space",DB:viewerDb});
if(viewerPeople.status!==403 || viewerAudit.status!==403) throw new Error("viewer role must not read roster or audit trail");
const adminDb=sessionDb("admin"),adminCookieHeader="__Host-qd58_admin="+"e".repeat(64);
let peopleSql="";
const originalPrepare=adminDb.prepare.bind(adminDb);
adminDb.prepare=(sql)=>{if(sql.startsWith("SELECT u.id"))peopleSql=sql;return originalPrepare(sql)};
const peopleResponse=await worker.fetch(new Request("https://api.58er.eon21.space/api/admin/people?q=青岛&province=山东省&page=1&pageSize=20",{headers:{origin:"https://58er.eon21.space",cookie:adminCookieHeader}}),{APP_ORIGIN:"https://58er.eon21.space",DB:adminDb});
const peopleBody=await peopleResponse.json();
if(peopleResponse.status!==200 || peopleBody.items?.length!==1 || peopleBody.pagination?.total!==1 || /u\\.phone|SELECT[^]*phone/i.test(peopleSql)) throw new Error("admin roster filtering or phone minimization failed");
const csvResponse=await worker.fetch(new Request("https://api.58er.eon21.space/api/admin/people?format=csv",{headers:{origin:"https://58er.eon21.space",cookie:adminCookieHeader}}),{APP_ORIGIN:"https://58er.eon21.space",DB:adminDb});
const csvBytes=new Uint8Array(await csvResponse.arrayBuffer());
const csv=new TextDecoder().decode(csvBytes);
const hasUtf8Bom=csvBytes.length>=3 && csvBytes[0]===0xef && csvBytes[1]===0xbb && csvBytes[2]===0xbf;
if(csvResponse.status!==200) throw new Error("CSV export should return HTTP 200");
if(!hasUtf8Bom) throw new Error("CSV export should include UTF-8 BOM");
if(!csv.includes("'=2+2")) throw new Error("CSV formula-injection prefix missing");
if(csv.includes("13800000000")) throw new Error("CSV export must not include phone numbers");
if(!csvResponse.headers.get("content-disposition")?.includes("zhuoyue-2026-roster.csv")) throw new Error("CSV download filename missing");
const auditResponse=await worker.fetch(new Request("https://api.58er.eon21.space/api/admin/audit",{headers:{origin:"https://58er.eon21.space",cookie:adminCookieHeader}}),{APP_ORIGIN:"https://58er.eon21.space",DB:adminDb});
if(auditResponse.status!==200) throw new Error("admin audit read failed");
const adminCannotManage=await worker.fetch(new Request("https://api.58er.eon21.space/api/admin/admins",{method:"GET",headers:{origin:"https://58er.eon21.space",cookie:adminCookieHeader}}),{APP_ORIGIN:"https://58er.eon21.space",DB:adminDb});
if(adminCannotManage.status!==403) throw new Error("only owner role may manage administrator accounts");
const ownerAdmins=await worker.fetch(new Request("https://api.58er.eon21.space/api/admin/admins",{headers:{origin:"https://58er.eon21.space",cookie:adminCookie}}),{APP_ORIGIN:"https://58er.eon21.space",DB:ownerDb});
if(ownerAdmins.status!==200) throw new Error("owner administrator management read failed");
console.log("Admin RBAC tests: PASS (independent password login, secure admin cookie/session, viewer restrictions, filtered roster without phone, formula-safe CSV, audit access and owner-only account management).");


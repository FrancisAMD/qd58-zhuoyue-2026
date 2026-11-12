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
if(ok.status!==200 || !health.ok || health.build!=="team-transfer-20261112" || health.passwordKdf!=="pbkdf2-sha256-100000") throw new Error("health route/build marker failed");
const blocked=await worker.fetch(new Request("https://api.58er.eon21.space/api/auth/login",{method:"POST",headers:{"content-type":"application/json",origin:"https://evil.example"},body:JSON.stringify({phone:"13800000000",password:"test"})}),env);
if(blocked.status!==403) throw new Error("origin guard failed");
const preflight=await worker.fetch(new Request("https://api.58er.eon21.space/api/auth/login",{method:"OPTIONS",headers:{origin:"https://58er.eon21.space","access-control-request-method":"POST"}}),env);
if(preflight.status!==204 || preflight.headers.get("access-control-allow-credentials")!=="true") throw new Error("CORS preflight failed");
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
  body:JSON.stringify({phone:"13812345678",turnstileToken:"unused-test-token"})
}),{APP_ORIGIN:"https://58er.eon21.space",DB:lockedDb});
const limitedBody=await limited.json();
if(limited.status!==429 || limitedBody.error!=="rate_limited" || limitedBody.refreshTurnstile===true || !(limitedBody.retryAfter>0)) throw new Error("SMS cooldown must not consume Turnstile token");
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
console.log("Worker smoke tests: PASS (PBKDF2-100000, health/build marker, Origin/CORS, SMS cooldown token lifecycle, transfer authentication and recipient authorization).");

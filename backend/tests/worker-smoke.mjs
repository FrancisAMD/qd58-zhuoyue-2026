import worker from "../src/worker.js";
const env={APP_ORIGIN:"https://58er.eon21.space"};
const ok=await worker.fetch(new Request("https://api.58er.eon21.space/api/health"),env);
if(ok.status!==200 || !(await ok.json()).ok) throw new Error("health route failed");
const blocked=await worker.fetch(new Request("https://api.58er.eon21.space/api/auth/login",{method:"POST",headers:{"content-type":"application/json",origin:"https://evil.example"},body:JSON.stringify({phone:"13800000000",password:"test"})}),env);
if(blocked.status!==403) throw new Error("origin guard failed");
const preflight=await worker.fetch(new Request("https://api.58er.eon21.space/api/auth/login",{method:"OPTIONS",headers:{origin:"https://58er.eon21.space","access-control-request-method":"POST"}}),env);
if(preflight.status!==204 || preflight.headers.get("access-control-allow-credentials")!=="true") throw new Error("CORS preflight failed");
console.log("Worker smoke tests: PASS (health, Origin rejection, CORS preflight).");

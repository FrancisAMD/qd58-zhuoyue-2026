import worker from "../src/worker.js";
const origin="https://58er.eon21.space";
for (const path of ["/api/account/delete/request-code","/api/account/delete"]) {
  const response=await worker.fetch(new Request("https://api.58er.eon21.space"+path,{
    method:"POST",headers:{"content-type":"application/json",origin},body:"{}"
  }),{APP_ORIGIN:origin});
  if(response.status!==401)throw new Error(path+" must require an authenticated session");
}
const profile=await worker.fetch(new Request("https://api.58er.eon21.space/api/profile",{headers:{origin}}),{APP_ORIGIN:origin});
if(profile.status!==401)throw new Error("profile API must remain authenticated");
console.log("Account lifecycle smoke tests: PASS (delete-code, delete and profile endpoints reject unauthenticated requests).");

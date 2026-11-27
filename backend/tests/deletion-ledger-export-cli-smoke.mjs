import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { runExport } from "../../scripts/export-deletion-ledger.mjs";

const hash=value=>createHash("sha256").update(value).digest("hex");
function record(userId,eventId) {
  const base={schemaVersion:1,userId,requestedAt:"2026-11-27T01:00:00.000Z",eventId};
  return {...base,payloadSha256:hash(JSON.stringify(base))};
}
const records=[
  record("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","22222222222222222222222222222222"),
  record("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","11111111111111111111111111111111")
];
const pages=0;
const root=await mkdtemp(resolve(tmpdir(),"qd58-ledger-export-"));
let calls=0,logout=false,outputs=[];
try {
  const mockFetch=async (input,init={})=>{
    const url=new URL(typeof input==="string"?input:input.url);
    if(url.pathname==="/api/admin/login") {
      assert.equal(init.headers.Origin,"https://app.example");
      return new Response(JSON.stringify({ok:true}),{status:200,headers:{"set-cookie":"__Host-qd58_admin=token; Path=/; HttpOnly; Secure"}});
    }
    if(url.pathname==="/api/admin/account-deletion-ledger/export") {
      calls++;
      assert.equal(init.headers.Origin,"https://app.example");
      assert.ok(init.headers.Cookie.startsWith("__Host-qd58_admin="));
      const cursor=url.searchParams.get("cursor");
      if(!cursor) return new Response(JSON.stringify({schemaVersion:1,records:[records[0]],truncated:true,cursor:"next"}),{status:200});
      assert.equal(cursor,"next");
      return new Response(JSON.stringify({schemaVersion:1,records:[records[1]],truncated:false,cursor:null}),{status:200});
    }
    if(url.pathname==="/api/admin/logout") { logout=true; return new Response(JSON.stringify({ok:true}),{status:200}); }
    throw new Error("unexpected URL");
  };
  const snapshot=await runExport({
    argv:["--api-base","https://api.example","--app-origin","https://app.example","--out","private-backups/ledger.json"],
    fetchImpl:mockFetch,promptCredentials:async()=>({username:"owner",password:"not-persisted"}),
    rootDir:root,output:value=>outputs.push(value)
  });
  assert.equal(calls,2);
  assert.equal(logout,true);
  assert.equal(snapshot.complete,true);
  assert.equal(snapshot.recordCount,2);
  assert.equal(snapshot.records[0].userId,"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.equal(snapshot.snapshotSha256,hash(JSON.stringify(snapshot.records)));
  const file=await readFile(resolve(root,"private-backups","ledger.json"),"utf8");
  assert.equal(JSON.parse(file).snapshotSha256,snapshot.snapshotSha256);
  assert.ok(outputs.length===1 && !outputs[0].includes("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"));

  await assert.rejects(()=>runExport({
    argv:["--api-base","https://api.example","--app-origin","https://app.example","--out","private-backups/ledger.json"],
    fetchImpl:mockFetch,promptCredentials:async()=>({username:"owner",password:"not-persisted"}),
    rootDir:root,output:()=>{}
  }));

  const badRoot=await mkdtemp(resolve(tmpdir(),"qd58-ledger-export-bad-"));
  try {
    const badFetch=async (input,init={})=>{
      const url=new URL(typeof input==="string"?input:input.url);
      if(url.pathname==="/api/admin/login") return new Response("{}",{status:200,headers:{"set-cookie":"__Host-qd58_admin=token; Path=/"}});
      if(url.pathname==="/api/admin/account-deletion-ledger/export") {
        const bad={...records[0],payloadSha256:"0".repeat(64)};
        return new Response(JSON.stringify({schemaVersion:1,records:[bad],truncated:false,cursor:null}),{status:200});
      }
      if(url.pathname==="/api/admin/logout") return new Response("{}",{status:200});
      throw new Error("unexpected URL");
    };
    await assert.rejects(()=>runExport({
      argv:["--api-base","https://api.example","--app-origin","https://app.example","--out","private-backups/bad.json"],
      fetchImpl:badFetch,promptCredentials:async()=>({username:"owner",password:"x"}),rootDir:badRoot,output:()=>{}
    }),/摘要不匹配/);
  } finally { await rm(badRoot,{recursive:true,force:true}); }
} finally { await rm(root,{recursive:true,force:true}); }
console.log("Deletion ledger export CLI tests: PASS (origin validation, paginated collection, checksum, private exclusive file, logout, corrupted record rejection).");

import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import worker from "../src/worker.js";
import { buildXlsxWorkbook } from "../src/xlsx.js";

const APP_ORIGIN="https://58er.eon21.space";
const COOKIE="__Host-qd58_admin=test-admin-session";
const outputPath=join(tmpdir(),"qd58-admin-xlsx-export-smoke.xlsx");

function makeDb({role="owner",total=1,rows=[]}={}) {
  const trace=[];
  return {
    trace,
    prepare(sql) {
      let values=[];
      return {
        bind(...args){values=args;return this;},
        async first(){
          trace.push({kind:"first",sql,values});
          if(sql.includes("FROM admin_sessions")) return role?{id:"admin-1",username:"test-owner",role}:null;
          if(sql.startsWith("SELECT COUNT(*) AS total FROM users")) return {total};
          return null;
        },
        async all(){
          trace.push({kind:"all",sql,values});
          if(sql.startsWith("SELECT u.id")) return {results:rows};
          return {results:[]};
        },
        async run(){trace.push({kind:"run",sql,values});return {meta:{changes:1}};}
      };
    }
  };
}
async function callExport(db,query="format=xlsx&province=%E5%B1%B1%E4%B8%9C%E7%9C%81",cookie=COOKIE) {
  const headers={Origin:APP_ORIGIN};
  if(cookie) headers.Cookie=cookie;
  return worker.fetch(new Request("https://api.58er.eon21.space/api/admin/people?"+query,{method:"GET",headers}),{APP_ORIGIN,DB:db});
}
const sample={
  id:"user-0001",
  name:'=HYPERLINK("https://evil.example")',
  className:"高二 <实验班>",
  highSchool:"青岛五十八中 🚀",
  university:"测试大学",
  universityCategory:"mainland",
  grade:"大一",
  province:"山东省",
  city:"青岛",
  createdAt:"2026-11-16T07:00:00.000Z",
  updatedAt:"2026-11-16T07:01:00.000Z",
  consentGiven:1,
  phone:"13800000000",
  bio:"private bio must not be exported"
};
const ownerDb=makeDb({role:"owner",total:1,rows:[sample]});
const response=await callExport(ownerDb);
assert.equal(response.status,200);
assert.equal(response.headers.get("content-type"),"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
assert.match(response.headers.get("content-disposition")||"",/zhuoyue-2026-roster\.xlsx/);
assert.equal(response.headers.get("cache-control"),"no-store");
assert.equal(response.headers.get("x-content-type-options"),"nosniff");
const bytes=new Uint8Array(await response.arrayBuffer());
assert.deepEqual(Array.from(bytes.slice(0,4)),[0x50,0x4b,0x03,0x04]);
await writeFile(outputPath,bytes);
const rowQuery=ownerDb.trace.find(x=>x.kind==="all"&&x.sql.startsWith("SELECT u.id"));
assert.ok(rowQuery,"export must fetch the filtered whitelist projection");
assert.ok(rowQuery.values.includes("山东省"),"XLSX export must preserve active filters");
const audit=ownerDb.trace.find(x=>x.kind==="run"&&x.sql.startsWith("INSERT INTO audit_logs"));
assert.ok(audit,"XLSX export must be audited");
assert.equal(audit.values[3],"admin.people.exported");
assert.deepEqual(JSON.parse(audit.values[6]),{format:"xlsx",rowCount:1,filterCount:1});

const viewerDb=makeDb({role:"viewer",total:1,rows:[sample]});
assert.equal((await callExport(viewerDb)).status,403,"viewer cannot export");
assert.equal(viewerDb.trace.some(x=>x.kind==="all"),false,"viewer must not fetch roster rows");
const anonymousDb=makeDb({role:null});
assert.equal((await callExport(anonymousDb,"format=xlsx","")).status,401,"anonymous user cannot export");
const oversizedDb=makeDb({role:"owner",total:5001});
assert.equal((await callExport(oversizedDb,"format=xlsx")).status,413,"XLSX export must enforce the 5000-row ceiling");
assert.equal(oversizedDb.trace.some(x=>x.kind==="all"),false,"oversized export must not load rows");
assert.throws(()=>buildXlsxWorkbook(["列"],new Array(5001).fill(["x"])),/invalid_xlsx_rows/);
console.log("admin XLSX export smoke tests passed; workbook written to "+outputPath);

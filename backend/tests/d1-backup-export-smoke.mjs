import assert from "node:assert/strict";
import { normalizeD1ExportResponse } from "../src/d1-backup-export.js";

const pending = normalizeD1ExportResponse({
  success:true,
  type:"export",
  status:"pending",
  at_bookmark:"bookmark-123",
  messages:["Preparing export"]
});
assert.deepEqual(pending,{
  status:"pending",bookmark:"bookmark-123",error:"",signedUrl:"",filename:""
});

const completed = normalizeD1ExportResponse({
  success:true,
  type:"export",
  status:"complete",
  at_bookmark:"bookmark-123",
  result:{
    filename:"qd58.sql",
    signed_url:"https://example.invalid/signed-export"
  }
});
assert.deepEqual(completed,{
  status:"complete",
  bookmark:"bookmark-123",
  error:"",
  signedUrl:"https://example.invalid/signed-export",
  filename:"qd58.sql"
});

const failed = normalizeD1ExportResponse({
  success:true,status:"error",at_bookmark:"bookmark-err",error:"export failed"
});
assert.equal(failed.status,"error");
assert.equal(failed.error,"export failed");
assert.throws(()=>normalizeD1ExportResponse(null));
console.log("D1 export polling parser tests: PASS (pending, complete and error API envelopes).");

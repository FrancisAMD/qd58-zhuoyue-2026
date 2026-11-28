import { open, readFile, stat, unlink } from "node:fs/promises";
import path from "node:path";
import {
  decryptBackupPart, getBackupMasterKey, unwrapBackupDataKey, verifyBackupManifest
} from "../backend/src/d1-backup-crypto.js";

function args(argv) {
  const result = {};
  for (let i=2;i<argv.length;i+=2) {
    const key=argv[i], value=argv[i+1];
    if (!["--manifest","--input","--output"].includes(key) || !value || result[key]) {
      throw new Error("Usage: node scripts/decrypt-d1-backup.mjs --manifest <manifest.json> --input <backup.qd58enc> --output <restore.sql>");
    }
    result[key]=path.resolve(value);
  }
  if (!result["--manifest"] || !result["--input"] || !result["--output"]) {
    throw new Error("Usage: node scripts/decrypt-d1-backup.mjs --manifest <manifest.json> --input <backup.qd58enc> --output <restore.sql>");
  }
  return result;
}

const options=args(process.argv);
const manifest=JSON.parse(await readFile(options["--manifest"],"utf8"));
if (!manifest || manifest.format!=="qd58-d1-backup" || manifest.schemaVersion!==1 ||
    manifest.status!=="completed" || !/^[a-f0-9]{32}$/.test(manifest.backupId||"") ||
    !Array.isArray(manifest.parts) || !manifest.wrappedKey) {
  throw new Error("Backup manifest is incomplete or unsupported.");
}
const version=manifest.keyVersion;
const secretName="BACKUP_MASTER_KEY_"+String(version||"").toUpperCase();
if (!process.env[secretName]) throw new Error(secretName+" must be set in the local environment.");
const master=await getBackupMasterKey({[secretName]:process.env[secretName]},version);
if (!(await verifyBackupManifest(manifest,master))) throw new Error("Backup manifest signature verification failed.");
const sourceStat=await stat(options["--input"]);
if (sourceStat.size!==Number(manifest.ciphertextBytes)) throw new Error("Encrypted file size does not match the signed manifest.");
const dataKey=await unwrapBackupDataKey(manifest.wrappedKey,manifest.backupId,master);
let input,output,createdOutput=false;
let inputOffset=0,plainTotal=0,cipherTotal=0;
try {
  input=await open(options["--input"],"r");
  output=await open(options["--output"],"wx",0o600);
  createdOutput=true;
  for (let index=0;index<manifest.parts.length;index++) {
    const part=manifest.parts[index];
    if (part.partNumber!==index+1 || !Number.isSafeInteger(part.cipherBytes) || part.cipherBytes!==part.plainBytes+16) {
      throw new Error("Backup part metadata is invalid.");
    }
    const encrypted=Buffer.alloc(part.cipherBytes);
    let offset=0;
    while(offset<encrypted.length) {
      const read=await input.read(encrypted,offset,encrypted.length-offset,inputOffset+offset);
      if(!read.bytesRead) throw new Error("Encrypted backup is truncated.");
      offset+=read.bytesRead;
    }
    inputOffset+=encrypted.length;
    const plaintext=await decryptBackupPart(dataKey,manifest.backupId,{...part,ciphertext:new Uint8Array(encrypted)});
    await output.write(plaintext);
    plainTotal+=plaintext.length;
    cipherTotal+=encrypted.length;
  }
  const extra=Buffer.alloc(1);
  const trailing=await input.read(extra,0,1,inputOffset);
  if(trailing.bytesRead!==0) throw new Error("Encrypted backup contains trailing data.");
  if(plainTotal!==Number(manifest.plaintextBytes)||cipherTotal!==Number(manifest.ciphertextBytes)) {
    throw new Error("Restored SQL byte counts do not match the manifest.");
  }
  await output.sync();
  console.log(JSON.stringify({
    ok:true,backupId:manifest.backupId,plaintextBytes:plainTotal,
    encryptedBytes:cipherTotal,partsVerified:manifest.parts.length,
    output:options["--output"]
  }));
} catch(error) {
  if(createdOutput) {
    try { await output?.close(); } catch {}
    try { await unlink(options["--output"]); } catch {}
  }
  throw error;
} finally {
  try { await input?.close(); } catch {}
  try { await output?.close(); } catch {}
}

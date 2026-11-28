import assert from "node:assert/strict";
import {
  decryptBackupPart, encryptBackupPart, getBackupMasterKey,
  signBackupManifest, unwrapBackupDataKey, verifyBackupManifest,
  wrapBackupDataKey
} from "../src/d1-backup-crypto.js";

const backupId="0123456789abcdef0123456789abcdef";
const masterHex="a".repeat(64);
const master=await getBackupMasterKey({BACKUP_MASTER_KEY_V1:masterHex},"v1");
const dataKey=crypto.getRandomValues(new Uint8Array(32));
const envelope=await wrapBackupDataKey(dataKey,backupId,master,"v1");
const unwrapped=await unwrapBackupDataKey(envelope,backupId,master);
assert.deepEqual([...unwrapped],[...dataKey]);
await assert.rejects(()=>unwrapBackupDataKey(envelope,"f".repeat(32),master));

const manifest={
  format:"qd58-d1-backup",schemaVersion:1,backupId,status:"completed",
  keyVersion:"v1",createdAt:"2026-11-28T18:00:00.000Z",objectKey:"d1-backups/v1/objects/test.qd58enc",
  wrappedKey:envelope,parts:[]
};
const signed=await signBackupManifest(manifest,master);
assert.equal(await verifyBackupManifest(signed,master),true);
assert.equal(await verifyBackupManifest({...signed,status:"failed"},master),false);
assert.equal(await verifyBackupManifest(signed,new Uint8Array(32).fill(4)),false);

const plain=new Uint8Array(256*1024+13);
for(let offset=0;offset<plain.length;offset+=64*1024){
  const length=Math.min(64*1024,plain.length-offset);
  plain.set(crypto.getRandomValues(new Uint8Array(length)),offset);
}
const encrypted=await encryptBackupPart(dataKey,backupId,1,plain);
assert.equal(encrypted.cipherBytes,plain.length+16);
const roundTrip=await decryptBackupPart(dataKey,backupId,{
  partNumber:1,plainBytes:encrypted.plainBytes,cipherBytes:encrypted.cipherBytes,
  nonce:encrypted.nonce,sha256:encrypted.sha256,ciphertext:encrypted.ciphertext
});
assert.deepEqual([...roundTrip],[...plain]);
const altered=encrypted.ciphertext.slice();
altered[20]^=0x01;
await assert.rejects(()=>decryptBackupPart(dataKey,backupId,{
  partNumber:1,plainBytes:encrypted.plainBytes,cipherBytes:encrypted.cipherBytes,
  nonce:encrypted.nonce,sha256:encrypted.sha256,ciphertext:altered
}));
await assert.rejects(()=>decryptBackupPart(dataKey,"f".repeat(32),{
  partNumber:1,plainBytes:encrypted.plainBytes,cipherBytes:encrypted.cipherBytes,
  nonce:encrypted.nonce,sha256:encrypted.sha256,ciphertext:encrypted.ciphertext
}));

console.log("D1 backup crypto tests: PASS (HKDF key separation, wrapped data keys, signed manifests, AES-GCM authentication and per-part SHA-256).");

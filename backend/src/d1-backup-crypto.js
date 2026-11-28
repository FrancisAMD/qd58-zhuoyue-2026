const encoder = new TextEncoder();
const KDF_SALT = encoder.encode("qd58-d1-backup-key-separation-v1");

function fail(message) { throw new Error(message); }
function toHex(bytes) {
  return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, "0")).join("");
}
export function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary);
}
export function base64ToBytes(value) {
  if (typeof value !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) fail("backup_encoding_invalid");
  try { return Uint8Array.from(atob(value), character => character.charCodeAt(0)); }
  catch { fail("backup_encoding_invalid"); }
}
export function parseBackupMasterKey(value) {
  if (typeof value !== "string") fail("backup_key_not_configured");
  let bytes;
  if (/^[a-f0-9]{64}$/i.test(value)) {
    bytes = Uint8Array.from(value.match(/.{2}/g), pair => parseInt(pair, 16));
  } else {
    bytes = base64ToBytes(value);
  }
  if (bytes.length !== 32) fail("backup_key_invalid");
  return bytes;
}
export function validBackupId(value) {
  return typeof value === "string" && /^[a-f0-9]{32}$/.test(value);
}
export function backupManifestKey(backupId) {
  if (!validBackupId(backupId)) fail("backup_id_invalid");
  return "d1-backups/v1/manifests/" + backupId + ".json";
}
export function backupObjectKey(backupId) {
  if (!validBackupId(backupId)) fail("backup_id_invalid");
  return "d1-backups/v1/objects/" + backupId + ".qd58enc";
}
async function deriveSubkey(masterBytes, purpose, algorithm, usages) {
  const material = await crypto.subtle.importKey("raw", masterBytes, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({
    name: "HKDF", hash: "SHA-256", salt: KDF_SALT,
    info: encoder.encode("qd58-d1-backup:" + purpose + ":v1")
  }, material, algorithm, false, usages);
}
async function deriveKeys(masterBytes) {
  const wrapKey = await deriveSubkey(masterBytes, "wrap", { name: "AES-GCM", length: 256 }, ["encrypt", "decrypt"]);
  const manifestKey = await deriveSubkey(masterBytes, "manifest", { name: "HMAC", hash: "SHA-256", length: 256 }, ["sign", "verify"]);
  return { wrapKey, manifestKey };
}
function wrapAad(backupId) {
  return encoder.encode("qd58:d1-backup:wrap:v1:" + backupId);
}
export async function wrapBackupDataKey(dataKeyBytes, backupId, masterBytes, keyVersion) {
  if (!validBackupId(backupId) || dataKeyBytes.length !== 32) fail("backup_key_invalid");
  const { wrapKey } = await deriveKeys(masterBytes);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({
    name: "AES-GCM", iv: nonce, additionalData: wrapAad(backupId), tagLength: 128
  }, wrapKey, dataKeyBytes);
  return { keyVersion, nonce: bytesToBase64(nonce), ciphertext: bytesToBase64(ciphertext) };
}
export async function unwrapBackupDataKey(envelope, backupId, masterBytes) {
  if (!envelope || !validBackupId(backupId) || typeof envelope.keyVersion !== "string") fail("backup_key_envelope_invalid");
  const { wrapKey } = await deriveKeys(masterBytes);
  try {
    const raw = await crypto.subtle.decrypt({
      name: "AES-GCM", iv: base64ToBytes(envelope.nonce),
      additionalData: wrapAad(backupId), tagLength: 128
    }, wrapKey, base64ToBytes(envelope.ciphertext));
    const bytes = new Uint8Array(raw);
    if (bytes.length !== 32) fail("backup_key_envelope_invalid");
    return bytes;
  } catch {
    fail("backup_key_unwrap_failed");
  }
}
function manifestBytes(manifest) {
  const { manifestHmac, ...unsigned } = manifest;
  return encoder.encode(JSON.stringify(unsigned));
}
export async function signBackupManifest(manifest, masterBytes) {
  const { manifestKey } = await deriveKeys(masterBytes);
  const signature = await crypto.subtle.sign("HMAC", manifestKey, manifestBytes(manifest));
  return { ...manifest, manifestHmac: toHex(signature) };
}
export async function verifyBackupManifest(manifest, masterBytes) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest) ||
      typeof manifest.manifestHmac !== "string" || !/^[a-f0-9]{64}$/.test(manifest.manifestHmac)) return false;
  const { manifestKey } = await deriveKeys(masterBytes);
  try {
    return await crypto.subtle.verify("HMAC", manifestKey,
      Uint8Array.from(manifest.manifestHmac.match(/.{2}/g), pair => parseInt(pair, 16)),
      manifestBytes(manifest));
  } catch {
    return false;
  }
}
export function backupPartAad(backupId, partNumber, plainBytes) {
  if (!validBackupId(backupId) || !Number.isSafeInteger(partNumber) || partNumber < 1 ||
      !Number.isSafeInteger(plainBytes) || plainBytes < 0) fail("backup_part_invalid");
  return encoder.encode("qd58:d1-backup:part:v1:" + backupId + ":" + partNumber + ":" + plainBytes);
}
export async function encryptBackupPart(dataKeyBytes, backupId, partNumber, plaintext) {
  const bytes = new Uint8Array(plaintext);
  const key = await crypto.subtle.importKey("raw", dataKeyBytes, "AES-GCM", false, ["encrypt"]);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({
    name: "AES-GCM", iv: nonce,
    additionalData: backupPartAad(backupId, partNumber, bytes.length), tagLength: 128
  }, key, bytes);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return {
    nonce: bytesToBase64(nonce),
    ciphertext: new Uint8Array(ciphertext),
    plainBytes: bytes.length,
    cipherBytes: ciphertext.byteLength,
    sha256: toHex(digest)
  };
}
export async function decryptBackupPart(dataKeyBytes, backupId, part) {
  if (!part || !Number.isSafeInteger(part.partNumber) || !Number.isSafeInteger(part.plainBytes) ||
      !Number.isSafeInteger(part.cipherBytes) || part.cipherBytes !== part.plainBytes + 16 ||
      typeof part.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(part.sha256)) fail("backup_part_invalid");
  const key = await crypto.subtle.importKey("raw", dataKeyBytes, "AES-GCM", false, ["decrypt"]);
  let plaintext;
  try {
    plaintext = new Uint8Array(await crypto.subtle.decrypt({
      name: "AES-GCM", iv: base64ToBytes(part.nonce),
      additionalData: backupPartAad(backupId, part.partNumber, part.plainBytes), tagLength: 128
    }, key, part.ciphertext));
  } catch {
    fail("backup_part_authentication_failed");
  }
  const digest = toHex(await crypto.subtle.digest("SHA-256", plaintext));
  if (plaintext.length !== part.plainBytes || digest !== part.sha256) fail("backup_part_integrity_failed");
  return plaintext;
}
export async function getBackupMasterKey(env, keyVersion) {
  if (!/^v[1-9][0-9]{0,2}$/.test(String(keyVersion || ""))) fail("backup_key_version_invalid");
  const secret = env["BACKUP_MASTER_KEY_" + keyVersion.toUpperCase()];
  return parseBackupMasterKey(secret);
}

import { buildXlsxWorkbook } from "./xlsx.js";
import { backupManifestKey, getBackupMasterKey, verifyBackupManifest } from "./d1-backup-crypto.js";
import { recordDeletionIntent } from "./account-deletion-ledger.js";
import {
  stageCatalogImport,
  finalizeCatalogImport,
  revalidateCatalogImportTargets,
  loadStagedCatalogImportManifest
} from "./university-catalog-import.js";
const encoder = new TextEncoder();
export const PBKDF2_ITERATIONS = 100000;
const PBKDF2_KEY_BYTES = 32;
// Unknown, disabled, or malformed accounts still pay one PBKDF2 verification cost.
// The all-zero expected digest can never be accepted as a valid stored credential.
const DUMMY_PASSWORD_SALT = new Uint8Array(16);
const DUMMY_PASSWORD_EXPECTED = new Uint8Array(PBKDF2_KEY_BYTES);
const COOKIE = "__Host-qd58_session";
const ADMIN_COOKIE = "__Host-qd58_admin";
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const ADMIN_SESSION_SECONDS = 8 * 60 * 60;
const OTP_SECONDS = 300;
const COOLDOWN_SECONDS = 60;
const ALI_HOST = "dypnsapi.aliyuncs.com";
const ALI_VERSION = "2017-05-25";
const PRIVACY_NOTICE_VERSION = "2026-11-27-v5";

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
}
function isTrustedAppOrigin(origin, env) {
  return typeof env.APP_ORIGIN === "string" &&
    env.APP_ORIGIN.length > 0 &&
    origin === env.APP_ORIGIN;
}
function corsHeaders(origin, env) {
  if (!isTrustedAppOrigin(origin, env)) return {};
  return { "access-control-allow-origin": origin, "access-control-allow-credentials": "true", "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS", "access-control-allow-headers": "Content-Type", "vary": "Origin" };
}
function response(data, status, origin, env, extra = {}) { return json(data, status, { ...corsHeaders(origin, env), ...extra }); }
function validPhone(p) { return /^1[3-9]\d{9}$/.test(String(p || "")); }
function b64(bytes) { let s = ""; for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b); return btoa(s); }
function unb64(s) { return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }
function hex(bytes) { return [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, "0")).join(""); }
async function sha256(value) { return hex(await crypto.subtle.digest("SHA-256", typeof value === "string" ? encoder.encode(value) : value)); }
async function hmac(secret, value) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}
export async function createRateLimitKey(secret, scope, value) {
  if (typeof secret !== "string" || secret.length < 32) throw new Error("rate_limit_secret_not_configured");
  if (!/^[a-z][a-z0-9:_-]{1,48}$/.test(scope)) throw new Error("invalid_rate_limit_scope");
  return "rl:v1:" + scope + ":" + await hmac(secret, scope + "\0" + String(value ?? ""));
}
async function rateLimitKey(env, scope, value) {
  try {
    return await createRateLimitKey(env.RATE_LIMIT_HMAC_SECRET, scope, value);
  } catch (error) {
    if (error?.message === "rate_limit_secret_not_configured") throw err("rate_limit_secret_not_configured", 503);
    throw error;
  }
}
export async function derivePassword(password, salt) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({
    name: "PBKDF2",
    salt: new Uint8Array(salt),
    iterations: PBKDF2_ITERATIONS,
    hash: "SHA-256"
  }, key, PBKDF2_KEY_BYTES * 8);
  return new Uint8Array(bits);
}
function randomHex(n = 16) { const a = crypto.getRandomValues(new Uint8Array(n)); return hex(a); }
function now() { return Math.floor(Date.now() / 1000); }
function cookie(token, maxAge) { return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`; }
function getCookie(request) {
  const raw = request.headers.get("cookie") || "";
  const item = raw.split(";").map(x => x.trim()).find(x => x.startsWith(COOKIE + "="));
  return item ? item.slice(COOKIE.length + 1) : "";
}
async function body(request) {
  try { return await request.json(); } catch { throw new Error("invalid_json"); }
}
async function limitedJsonBody(request, maxBytes) {
  const contentType = String(request.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("application/json")) throw err("json_required", 415);
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw err("payload_too_large", 413);
  const raw = await request.text();
  if (encoder.encode(raw).byteLength > maxBytes) throw err("payload_too_large", 413);
  try { return JSON.parse(raw); } catch { throw err("invalid_json", 400); }
}
function err(message, status = 400, meta = {}) { return { error: message, status, ...meta }; }
async function turnstile(token, action, request, env) {
  if (!env.TURNSTILE_SECRET_KEY || !token) return false;
  const form = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token });
  const ip = request.headers.get("CF-Connecting-IP");
  if (ip) form.set("remoteip", ip);
  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
  if (!r.ok) return false;
  const v = await r.json();
  return v.success === true && v.action === action && v.hostname === "58er.eon21.space";
}
function pct(v) { return encodeURIComponent(String(v)).replace(/[!'()*]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase()).replace(/%7E/g, "~"); }
async function aliyun(action, params, env) {
  if (!env.ALIBABA_ACCESS_KEY_ID || !env.ALIBABA_ACCESS_KEY_SECRET) throw new Error("sms_not_configured");
  const query = Object.entries(params).filter(([,v]) => v !== undefined && v !== null && v !== "")
    .sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([k,v]) => pct(k) + "=" + pct(v)).join("&");
  const date = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const nonce = randomHex(16);
  const payloadHash = await sha256("");
  const headers = {
    host: ALI_HOST,
    "x-acs-action": action,
    "x-acs-content-sha256": payloadHash,
    "x-acs-date": date,
    "x-acs-signature-nonce": nonce,
    "x-acs-version": ALI_VERSION
  };
  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers).sort().map(k => k + ":" + headers[k]).join("\n") + "\n";
  const canonical = "POST\n/\n" + query + "\n" + canonicalHeaders + "\n" + signedHeaders + "\n" + payloadHash;
  const stringToSign = "ACS3-HMAC-SHA256\n" + await sha256(canonical);
  const key = await crypto.subtle.importKey("raw", encoder.encode(env.ALIBABA_ACCESS_KEY_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = hex(await crypto.subtle.sign("HMAC", key, encoder.encode(stringToSign)));
  const url = "https://" + ALI_HOST + "/?" + query;
  const r = await fetch(url, { method: "POST", headers: { ...headers, Authorization: "ACS3-HMAC-SHA256 Credential=" + env.ALIBABA_ACCESS_KEY_ID + ",SignedHeaders=" + signedHeaders + ",Signature=" + signature, accept: "application/json" } });
  const result = await r.json().catch(() => ({}));
  if (!r.ok || result.Success !== true || result.Code !== "OK") {
    console.error("Alibaba PNVS API failed", { action, httpStatus: r.status, code: result.Code || "unknown", requestId: result.RequestId || "" });
    throw new Error("sms_provider_error");
  }
  return result;
}
async function rateLimit(db, key, limit, windowSeconds) {
  const t = now();
  const result = await db.prepare(`INSERT INTO rate_limits(bucket_key,window_started_at,hit_count) VALUES(?,?,1)
    ON CONFLICT(bucket_key) DO UPDATE SET
      hit_count=CASE WHEN window_started_at <= ? THEN 1 ELSE hit_count+1 END,
      window_started_at=CASE WHEN window_started_at <= ? THEN excluded.window_started_at ELSE window_started_at END
    WHERE window_started_at <= ? OR hit_count < ?`)
    .bind(key, t, t-windowSeconds, t-windowSeconds, t-windowSeconds, limit).run();
  return (result.meta?.changes || 0) > 0;
}
async function rateLimitStatus(db, key, limit, windowSeconds) {
  const row = await db.prepare("SELECT window_started_at,hit_count FROM rate_limits WHERE bucket_key=?").bind(key).first();
  if (!row) return { allowed: true, retryAfter: 0 };
  const started = Number(row.window_started_at);
  const hits = Number(row.hit_count);
  const t = now();
  if (!Number.isFinite(started) || started <= t - windowSeconds || hits < limit) return { allowed: true, retryAfter: 0 };
  return { allowed: false, retryAfter: Math.max(1, started + windowSeconds - t) };
}

// A quota increment is a reservation until PNVS accepts the send request.
// Store the exact window start so a failed request only releases its own
// reservation and never decrements a newer window.
async function reserveRateLimit(db, item) {
  // Bind the reservation to the exact window returned by the same atomic
  // UPSERT. A separate SELECT can observe a later window created by another
  // request and cause rollback to decrement that other request's quota.
  const t = now();
  const row = await db.prepare(`INSERT INTO rate_limits(bucket_key,window_started_at,hit_count) VALUES(?,?,1)
    ON CONFLICT(bucket_key) DO UPDATE SET
      hit_count=CASE WHEN window_started_at <= ? THEN 1 ELSE hit_count+1 END,
      window_started_at=CASE WHEN window_started_at <= ? THEN excluded.window_started_at ELSE window_started_at END
    WHERE window_started_at <= ? OR hit_count < ?
    RETURNING window_started_at`)
    .bind(item.key, t, t-item.window, t-item.window, t-item.window, item.limit).first();
  if (!row) return null;
  const windowStartedAt = Number(row.window_started_at);
  if (!Number.isSafeInteger(windowStartedAt) || windowStartedAt <= 0) {
    throw new Error("rate_limit_reservation_invalid");
  }
  return { key: item.key, windowStartedAt };
}
async function releaseRateLimitReservations(db, reservations) {
  if (!reservations.length) return;
  try {
    await db.batch(reservations.map(({ key, windowStartedAt }) =>
      db.prepare("UPDATE rate_limits SET hit_count=hit_count-1 WHERE bucket_key=? AND window_started_at=? AND hit_count>0")
        .bind(key, windowStartedAt)
    ));
  } catch (error) {
    console.error("Failed to release SMS quota reservation", error?.message || "unknown");
  }
}

async function createSession(db, userId, env, expected) {
  const token = randomHex(32);
  const digest = await sha256(token);
  const expires = now() + Number(env.SESSION_TTL_SECONDS || SESSION_SECONDS);
  const result = await db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at,created_at,auth_version) SELECT ?,id,?,?,auth_version FROM users WHERE id=? AND deleted_at='' AND password_hash=? AND auth_version=?")
    .bind(digest,expires,now(),userId,expected.passwordHash,expected.authVersion).run();
  if ((result.meta?.changes || 0) !== 1) throw err("credentials_changed",401);
  return { token, maxAge: expires-now() };
}
async function currentUser(request, env) {
  const token = getCookie(request);
  if (!token) return null;
  const digest = await sha256(token);
  const row = await env.DB.prepare("SELECT u.id,u.phone,u.name,u.high_school,u.university_id,u.grade,u.province,u.city,u.greeting,u.phone_visible_to_team,u.consent_given,u.consent_at,u.consent_version,u.account_consent_at,u.account_consent_version,u.gender,u.major_discipline_code,u.admission_category_id,u.campus_id,u.campus_name,u.campus_tag,u.secondary_phone,u.wechat_id,u.profile_review_status,u.overseas_university_name,u.profile_review_submitted_at,u.profile_reviewed_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.deleted_at='' AND s.auth_version=u.auth_version").bind(digest,now()).first();
  return row || null;
}

function getNamedCookie(request, name) {
  const raw = request.headers.get("cookie") || "";
  const prefix = name + "=";
  const item = raw.split(";").map(x => x.trim()).find(x => x.startsWith(prefix));
  return item ? item.slice(prefix.length) : "";
}
function adminCookie(token, maxAge) {
  return ADMIN_COOKIE + "=" + token + "; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=" + maxAge;
}
async function currentAdmin(request, env) {
  const token = getNamedCookie(request, ADMIN_COOKIE);
  if (!token) return null;
  const digest = await sha256(token);
  return await env.DB.prepare("SELECT a.id,a.username,a.role FROM admin_sessions s JOIN admin_users a ON a.id=s.admin_user_id WHERE s.token_hash=? AND s.expires_at>? AND a.active=1 AND a.role IN ('owner','admin')")
    .bind(digest, now()).first();
}
const ADMIN_PERMISSIONS = {
  owner: ["overview", "people:read", "people:export", "people:delete", "audit:read", "admins:manage", "universities:import", "universities:review", "group-chat:manage", "donations:manage", "backups:manage"],
  admin: ["overview", "universities:review", "group-chat:manage"]
};
function hasAdminPermission(admin, permission) {
  return !!admin && (ADMIN_PERMISSIONS[admin.role] || []).includes(permission);
}
const GROUP_CHAT_REGIONS = [{"key":"beijing","label":"北京市","kind":"mainland"},{"key":"tianjin","label":"天津市","kind":"mainland"},{"key":"hebei","label":"河北省","kind":"mainland"},{"key":"shanxi","label":"山西省","kind":"mainland"},{"key":"inner-mongolia","label":"内蒙古自治区","kind":"mainland"},{"key":"liaoning","label":"辽宁省","kind":"mainland"},{"key":"jilin","label":"吉林省","kind":"mainland"},{"key":"heilongjiang","label":"黑龙江省","kind":"mainland"},{"key":"shanghai","label":"上海市","kind":"mainland"},{"key":"jiangsu","label":"江苏省","kind":"mainland"},{"key":"zhejiang","label":"浙江省","kind":"mainland"},{"key":"anhui","label":"安徽省","kind":"mainland"},{"key":"fujian","label":"福建省","kind":"mainland"},{"key":"jiangxi","label":"江西省","kind":"mainland"},{"key":"shandong","label":"山东省","kind":"mainland"},{"key":"henan","label":"河南省","kind":"mainland"},{"key":"hubei","label":"湖北省","kind":"mainland"},{"key":"hunan","label":"湖南省","kind":"mainland"},{"key":"guangdong","label":"广东省","kind":"mainland"},{"key":"guangxi","label":"广西壮族自治区","kind":"mainland"},{"key":"hainan","label":"海南省","kind":"mainland"},{"key":"chongqing","label":"重庆市","kind":"mainland"},{"key":"sichuan","label":"四川省","kind":"mainland"},{"key":"guizhou","label":"贵州省","kind":"mainland"},{"key":"yunnan","label":"云南省","kind":"mainland"},{"key":"tibet","label":"西藏自治区","kind":"mainland"},{"key":"shaanxi","label":"陕西省","kind":"mainland"},{"key":"gansu","label":"甘肃省","kind":"mainland"},{"key":"qinghai","label":"青海省","kind":"mainland"},{"key":"ningxia","label":"宁夏回族自治区","kind":"mainland"},{"key":"xinjiang","label":"新疆维吾尔自治区","kind":"mainland"},{"key":"hmt","label":"港澳台","kind":"hmt"},{"key":"overseas","label":"海外","kind":"overseas"}];
const GROUP_CHAT_REGION_BY_KEY = new Map(GROUP_CHAT_REGIONS.map(item=>[item.key,item]));
const GROUP_CHAT_REGION_BY_LABEL = new Map(GROUP_CHAT_REGIONS.filter(item=>item.kind==="mainland").map(item=>[item.label,item]));
function resolveGroupChatRegion(category, provinceCandidates = []) {
  if (category === "hmt") return GROUP_CHAT_REGION_BY_KEY.get("hmt");
  if (category === "overseas") return GROUP_CHAT_REGION_BY_KEY.get("overseas");
  if (category !== "mainland" && category !== "sino_foreign") return null;
  for (const candidate of provinceCandidates) {
    const region = GROUP_CHAT_REGION_BY_LABEL.get(String(candidate || "").trim());
    if (region) return region;
  }
  return null;
}
async function getGroupChatContext(db, userId) {
  const row = await db.prepare(`SELECT u.id,u.university_id,u.province AS userProvince,
    uni.canonical_name AS university,uni.category AS category,
    COALESCE(NULLIF(uni.province_name_zh,''),NULLIF(profile_catalog.province_name,'')) AS mainProvince,
    uni.region_name AS legacyRegion
    FROM users u
    LEFT JOIN universities uni ON uni.id=u.university_id
    LEFT JOIN profile_university_catalog profile_catalog ON profile_catalog.university_id=uni.id
    WHERE u.id=? AND u.deleted_at=''`).bind(userId).first();
  if (!row || !row.university_id) throw err("group_chat_university_required",409);
  const region = resolveGroupChatRegion(row.category,[row.mainProvince,row.legacyRegion,row.userProvince]);
  if (!region) throw err("group_chat_region_unavailable",409);
  return { ...row, region };
}
function groupChatQrObjectKey(regionKey) { return "group-chat-qr/" + regionKey; }
function groupChatAssetMetadata(object) {
  if (!object) return null;
  return {
    fileName: object.customMetadata?.fileName || "群聊二维码",
    contentType: object.httpMetadata?.contentType || "application/octet-stream",
    sizeBytes: Number(object.size || 0),
    uploadedAt: object.customMetadata?.uploadedAt || object.uploaded?.toISOString?.() || "",
    uploadedBy: object.customMetadata?.uploadedBy || ""
  };
}
function detectGroupChatImageType(bytes) {
  const b = new Uint8Array(bytes);
  if (b.length >= 8 && b[0]===0x89 && b[1]===0x50 && b[2]===0x4e && b[3]===0x47 && b[4]===0x0d && b[5]===0x0a && b[6]===0x1a && b[7]===0x0a) return "image/png";
  if (b.length >= 3 && b[0]===0xff && b[1]===0xd8 && b[2]===0xff) return "image/jpeg";
  if (b.length >= 12 && String.fromCharCode(...b.slice(0,4))==="RIFF" && String.fromCharCode(...b.slice(8,12))==="WEBP") return "image/webp";
  return "";
}
async function attachAdminGroupChatStatus(env, items) {
  if (!items.length) return items;
  const regionByUser = new Map();
  for (const item of items) {
    const region = resolveGroupChatRegion(item.universityCategory,[
      item.universityMainProvince,item.profileCatalogProvince,item.universityLegacyRegion,item.province
    ]);
    regionByUser.set(item.id,region);
    item.groupChatRegionKey = region?.key || null;
    item.groupChatRegionLabel = region?.label || "";
  }
  const userIds = items.map(item=>item.id);
  const placeholders = userIds.map(()=>"?").join(",");
  const confirmationRows = await env.DB.prepare(
    "SELECT user_id AS userId,region_key AS regionKey,university_id_snapshot AS universityIdSnapshot,"+
    "qr_uploaded_at_snapshot AS qrUploadedAtSnapshot,confirmed_at AS confirmedAt "+
    "FROM group_chat_confirmations WHERE user_id IN ("+placeholders+")"
  ).bind(...userIds).all();
  const confirmations = new Map((confirmationRows.results||[]).map(row=>[row.userId+"|"+row.regionKey,row]));
  const regionKeys = [...new Set([...regionByUser.values()].filter(Boolean).map(region=>region.key))];
  const assets = new Map();
  if (env.GROUP_QR) {
    await Promise.all(regionKeys.map(async key=>{
      try {
        const object=await env.GROUP_QR.head(groupChatQrObjectKey(key));
        assets.set(key,groupChatAssetMetadata(object));
      } catch {
        assets.set(key,undefined);
      }
    }));
  }
  for (const item of items) {
    const region=regionByUser.get(item.id);
    const previous=region?confirmations.get(item.id+"|"+region.key):null;
    const asset=region?assets.get(region.key):null;
    item.groupChatConfirmedAt=previous?.confirmedAt||null;
    if (!region) {
      item.groupChatStatus="not_applicable";
      item.groupChatStatusLabel="暂无高校地区";
    } else if (!env.GROUP_QR || asset===undefined) {
      item.groupChatStatus="unavailable";
      item.groupChatStatusLabel="二维码服务暂不可用";
    } else if (!asset) {
      item.groupChatStatus="not_uploaded";
      item.groupChatStatusLabel="地区二维码未上传";
    } else if (previous?.confirmedAt && previous.qrUploadedAtSnapshot===asset.uploadedAt) {
      item.groupChatStatus="confirmed";
      item.groupChatStatusLabel="已确认加入";
    } else if (previous?.confirmedAt) {
      item.groupChatStatus="reconfirm";
      item.groupChatStatusLabel="二维码更新，待重新确认";
    } else {
      item.groupChatStatus="pending";
      item.groupChatStatusLabel="尚未确认";
    }
  }
  return items;
}
function validateDonationPayload(data){
  if(!data||typeof data!=="object"||Array.isArray(data))return {error:"donation_payload_invalid"};
  if(Object.keys(data).some(key=>!["nickname","amountCents","displayOrder"].includes(key)))return {error:"donation_payload_invalid"};
  const nickname=String(data.nickname||"").normalize("NFKC").trim();
  if(nickname.length<1||nickname.length>40||/[\u0000-\u001f\u007f]/.test(nickname))return {error:"donation_nickname_invalid"};
  const amountCents=Number(data.amountCents);
  if(!Number.isSafeInteger(amountCents)||amountCents<1||amountCents>100000000)return {error:"donation_amount_invalid"};
  const displayOrder=data.displayOrder===undefined?0:Number(data.displayOrder);
  if(!Number.isSafeInteger(displayOrder)||displayOrder< -10000||displayOrder>10000)return {error:"donation_order_invalid"};
  return {nickname,amountCents,displayOrder};
}
async function writeAudit(db, actorType, actorId, action, targetType, targetId, metadata = {}) {
  await db.prepare("INSERT INTO audit_logs(id,actor_type,actor_id,action,target_type,target_id,metadata_json) VALUES(?,?,?,?,?,?,?)")
    .bind(randomHex(16), actorType, actorId || null, action, targetType || null, targetId || null, JSON.stringify(metadata)).run();
}

// Pending leadership offers expire after the configured TTL. The scheduled
// handler is the backstop; API paths also run this sweep before reading or
// creating transfers so a delayed cron cannot leave a stale pending lock.
async function expirePendingTransfers(db) {
  const timestamp = new Date().toISOString();
  await db.batch([
    db.prepare("UPDATE leader_transfers SET status='expired',responded_at=? WHERE status='pending' AND expires_at<>'' AND expires_at<=?")
      .bind(timestamp, timestamp),
    db.prepare(`INSERT OR IGNORE INTO audit_logs(id,actor_type,actor_id,action,target_type,target_id,metadata_json)
      SELECT 'transfer-expired-' || id, 'system', NULL, 'team.transfer.expired', 'team', team_id, json_object('transferId',id)
      FROM leader_transfers
      WHERE status='expired' AND responded_at=? AND expires_at<>'' AND expires_at<=?`)
      .bind(timestamp, timestamp)
  ]);
}
// Keep short-lived authentication data only as long as it can still affect
// verification or abuse controls. Audit logs are intentionally retained until
// the organizer approves a formal retention schedule.
export async function cleanupExpiredSecurityData(db, timestamp = now()) {
  const otpCutoff = timestamp - 86400;
  const legacyRateLimitCutoff = timestamp - 86400;
  const rateLimitCutoff = timestamp - 172800;
  return db.batch([
    db.prepare(`DELETE FROM otp_challenges
      WHERE id IN (
        SELECT id FROM otp_challenges
        WHERE (consumed_at IS NOT NULL AND consumed_at<=?) OR expires_at<=?
        LIMIT 500
      )`).bind(otpCutoff, otpCutoff),
    db.prepare(`DELETE FROM sessions
      WHERE token_hash IN (SELECT token_hash FROM sessions WHERE expires_at<=? LIMIT 500)`).bind(timestamp),
    db.prepare(`DELETE FROM admin_sessions
      WHERE token_hash IN (SELECT token_hash FROM admin_sessions WHERE expires_at<=? LIMIT 500)`).bind(timestamp),
    db.prepare(`DELETE FROM rate_limits
      WHERE bucket_key IN (
        SELECT bucket_key FROM rate_limits
        WHERE (bucket_key NOT LIKE 'rl:v1:%' AND window_started_at<=?)
           OR (bucket_key LIKE 'rl:v1:%' AND window_started_at<=?)
        LIMIT 500
      )`).bind(legacyRateLimitCutoff, rateLimitCutoff)
  ]);
}

function csvCell(value) {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[\s\u0000-\u001f]*[=+\-@]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
function adminPage(value, fallback, max) {
  const n = Number.parseInt(value || "", 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : fallback;
}
function adminPeopleFilters(url) {
  const where = [];
  const bindings = [];
  let filterCount = 0;
  const q = (url.searchParams.get("q") || "").trim().slice(0, 100);
  if (q) {
    where.push("(instr(lower(coalesce(u.name,'')),lower(?))>0 OR instr(lower(coalesce(u.high_school,'')),lower(?))>0 OR instr(lower(coalesce(uni.canonical_name,'')),lower(?))>0 OR instr(lower(coalesce(u.province,'')),lower(?))>0)");
    bindings.push(q, q, q, q);
    filterCount++;
  }
  for (const [parameter, column] of [["province", "u.province"], ["grade", "u.grade"], ["category", "uni.category"]]) {
    const value = (url.searchParams.get(parameter) || "").trim().slice(0, 80);
    if (!value) continue;
    if (parameter === "category" && !["mainland", "hmt", "sino_foreign", "overseas", "unclassified"].includes(value)) {
      return { error: "invalid_filter" };
    }
    if (parameter !== "category" && value === "__empty__") {
      where.push("COALESCE(" + column + ",'')=''");
    } else {
      where.push(column + "=?");
      bindings.push(value);
    }
    filterCount++;
  }
  const university = (url.searchParams.get("university") || "").trim().slice(0, 120);
  if (university) {
    where.push("instr(lower(coalesce(uni.canonical_name,'')),lower(?))>0");
    bindings.push(university);
    filterCount++;
  }
  return { clause: where.length ? " WHERE " + where.join(" AND ") : "", bindings, filterCount };
}

async function sendCode(phone, purpose, token, request, env) {
  if (!validPhone(phone)) throw err("invalid_phone");
  // Check existing limits before Siteverify. A blocked request must not consume
  // the visitor's one-time Turnstile token.
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const limits = await Promise.all([
    { keyScope: "sms:cooldown", identity: phone, limit: 1, window: Number(env.OTP_SEND_COOLDOWN_SECONDS || COOLDOWN_SECONDS), scope: "cooldown" },
    { keyScope: "sms:phone", identity: phone, limit: 5, window: 86400, scope: "phone_daily" },
    { keyScope: "sms:ip", identity: ip, limit: 20, window: 3600, scope: "ip_hourly" }
  ].map(async item => ({ ...item, key: await rateLimitKey(env, item.keyScope, item.identity) })));
  for (const item of limits) {
    const status = await rateLimitStatus(env.DB, item.key, item.limit, item.window);
    if (!status.allowed) throw err("rate_limited", 429, { retryAfter: status.retryAfter, limitScope: item.scope, refreshTurnstile: false });
  }

  // Keep provider readiness independent of account existence so public callers
  // cannot infer registration state from a configuration error.
  if (!env.ALIBABA_ACCESS_KEY_ID || !env.ALIBABA_ACCESS_KEY_SECRET || !env.ALIBABA_SIGN_NAME || !env.ALIBABA_TEMPLATE_CODE) {
    throw err("sms_not_configured", 503);
  }

  let turnstilePassed = false;
  try {
    turnstilePassed = await turnstile(token, purpose, request, env);
  } catch {
    throw err("turnstile_failed", 503, { refreshTurnstile: true });
  }
  if (!turnstilePassed) throw err("turnstile_failed", 403, { refreshTurnstile: true });

  // From this point onward Siteverify has redeemed the token. Reserve all
  // counters, but roll them back if a later reservation or definitive PNVS rejection fails.
  const reservations = [];
  let challengeId = "";
  let providerAttempted = false;
  try {
    for (const item of limits) {
      const reservation = await reserveRateLimit(env.DB, item);
      if (!reservation) {
        const status = await rateLimitStatus(env.DB, item.key, item.limit, item.window);
        await releaseRateLimitReservations(env.DB, reservations);
        throw err("rate_limited", 429, { retryAfter: status.retryAfter || item.window, limitScope: item.scope, refreshTurnstile: true });
      }
      reservations.push(reservation);
    }

    // Registration sends the same ownership-verification SMS regardless of
    // account state. The account lookup happens only after the user proves
    // control of this phone in register().
    if (purpose !== "register") {
      const exists = await env.DB.prepare("SELECT id FROM users WHERE phone=? AND deleted_at=''").bind(phone).first();
      if (purpose === "password_reset" && !exists) return { ok: true };
      if (purpose === "account_delete" && !exists) throw err("phone_not_registered", 404);
    }

    const outId = randomHex(16);
    challengeId = randomHex(16);
    // Persist the provider correlation ID before sending. If PNVS accepts the
    // SMS but the subsequent D1 write fails, the user would otherwise receive
    // a code that the application can never verify.
    // Supersede older challenges and persist the new provider correlation ID
    // atomically. A resend intentionally invalidates the previous code even if
    // the provider later definitively rejects this delivery attempt.
    const stored = await env.DB.batch([
      env.DB.prepare("UPDATE otp_challenges SET superseded_at=? WHERE phone=? AND purpose=? AND consumed_at IS NULL AND superseded_at IS NULL")
        .bind(now(),phone,purpose),
      env.DB.prepare("INSERT INTO otp_challenges(id,phone,code_hash,expires_at,attempts,consumed_at,created_at,purpose,out_id) VALUES(?,?,?, ?,0,NULL,?,?,?)")
        .bind(challengeId,phone,"ALIYUN",now()+Number(env.OTP_TTL_SECONDS || OTP_SECONDS),now(),purpose,outId)
    ]);
    if ((stored[1]?.meta?.changes || 0) !== 1) throw new Error("otp_challenge_store_failed");

    const params = {
      CountryCode: "86", PhoneNumber: phone,
      SignName: env.ALIBABA_SIGN_NAME,
      TemplateCode: env.ALIBABA_TEMPLATE_CODE,
      TemplateParam: JSON.stringify({ code: "##code##", min: "5" }),
      ValidTime: Number(env.OTP_TTL_SECONDS || OTP_SECONDS),
      DuplicatePolicy: 1, Interval: Number(env.OTP_SEND_COOLDOWN_SECONDS || COOLDOWN_SECONDS),
      CodeType: 1, CodeLength: 6, ReturnVerifyCode: false, AutoRetry: 1, OutId: outId
    };
    if (env.ALIBABA_SCHEME_NAME) params.SchemeName = env.ALIBABA_SCHEME_NAME;
    providerAttempted = true;
    await aliyun("SendSmsVerifyCode", params, env);
    return { ok: true };
  } catch (error) {
    // An explicit PNVS rejection is definitive: remove the unusable challenge
    // and release the quota reservation. A transport failure is ambiguous;
    // retain both so a code that was actually delivered can still be checked.
    const explicitProviderRejection = error?.message === "sms_provider_error";
    if (challengeId && (!providerAttempted || explicitProviderRejection)) {
      try {
        await env.DB.prepare("DELETE FROM otp_challenges WHERE id=? AND consumed_at IS NULL").bind(challengeId).run();
      } catch (cleanupError) {
        console.error("Failed to remove unusable PNVS challenge", cleanupError?.message || "unknown");
      }
    }
    if (error?.error !== "rate_limited" && (!providerAttempted || explicitProviderRejection || error?.message === "sms_not_configured")) {
      await releaseRateLimitReservations(env.DB, reservations);
    }
    if (purpose !== "account_delete" && error?.error !== "rate_limited" && error?.message !== "sms_not_configured") {
      // Do not expose whether a phone exists through provider or storage errors.
      console.error("Public OTP delivery outcome unavailable", { purpose, code: error?.message || "unknown" });
      return { ok: true };
    }
    if (error && typeof error === "object") error.refreshTurnstile = true;
    throw error;
  }
}

async function verifyCode(phone, code, purpose, env) {
  if (!validPhone(phone) || !/^\d{4,8}$/.test(String(code || ""))) throw err("invalid_code");
  const challenge = await env.DB.prepare("SELECT id FROM otp_challenges WHERE phone=? AND purpose=? AND consumed_at IS NULL AND superseded_at IS NULL ORDER BY created_at DESC LIMIT 1").bind(phone,purpose).first();
  if (!challenge) throw err("invalid_code");

  // Reserve one verification attempt atomically. The expiry, purpose, phone,
  // supersession and attempt ceiling are checked by the same D1 write.
  const configuredMaxAttempts = Number(env.OTP_MAX_ATTEMPTS || 5);
  const maxAttempts = Number.isInteger(configuredMaxAttempts)
    ? Math.min(10, Math.max(1, configuredMaxAttempts))
    : 5;
  const attempt = await env.DB.prepare(`UPDATE otp_challenges
    SET attempts=attempts+1
    WHERE id=? AND phone=? AND purpose=? AND consumed_at IS NULL
      AND superseded_at IS NULL AND expires_at>? AND attempts<?
    RETURNING out_id,expires_at`).bind(challenge.id,phone,purpose,now(),maxAttempts).first();
  if (!attempt?.out_id) throw err("invalid_code");

  const checked = await aliyun("CheckSmsVerifyCode", {
    CountryCode:"86", PhoneNumber:phone, VerifyCode:String(code),
    OutId:attempt.out_id, SchemeName:env.ALIBABA_SCHEME_NAME || undefined
  }, env);
  if (checked.Model?.VerifyResult !== "PASS") throw err("invalid_code");

  // PNVS verification is an external round trip: the challenge may expire,
  // be superseded by a resend, or be consumed by another request meanwhile.
  // Recheck all one-time conditions at the final atomic consume point.
  const consumedAt = now();
  const consumed = await env.DB.prepare(`UPDATE otp_challenges SET consumed_at=?
    WHERE id=? AND phone=? AND purpose=? AND consumed_at IS NULL
      AND superseded_at IS NULL AND expires_at>?`).bind(consumedAt,challenge.id,phone,purpose,consumedAt).run();
  if ((consumed.meta?.changes || 0) !== 1) throw err("invalid_code");
}
async function register(data, env) {
  const phone=String(data.phone||""), password=String(data.password||"");
  if (!validPhone(phone)) throw err("invalid_phone");
  if (data.accountConsent !== true) throw err("consent_required");
  if (password.length < 10 || password.length > 128) throw err("weak_password");
  const salt=crypto.getRandomValues(new Uint8Array(16));
  const derived=await derivePassword(password,salt);
  // Prove phone ownership before revealing whether an account already exists.
  await verifyCode(phone,data.code,"register",env);
  const existing=await env.DB.prepare("SELECT id FROM users WHERE phone=? AND deleted_at='' LIMIT 1").bind(phone).first();
  if(existing) throw err("phone_already_registered",409);
  const hash="pbkdf2-sha256$"+PBKDF2_ITERATIONS+"$"+b64(salt)+"$"+b64(derived);
  const id=randomHex(16);
  try { await env.DB.prepare("INSERT INTO users(id,phone,password_hash,consent_at,consent_given,consent_version,account_consent_at,account_consent_version) VALUES(?,?,?,'',0,'',?,?)").bind(id,phone,hash,new Date().toISOString(),PRIVACY_NOTICE_VERSION).run(); }
  catch { throw err("phone_already_registered",409); }
  return { id, passwordHash: hash, authVersion: 1 };
}
async function verifyPassword(password, stored) {
  const parts=String(stored||"").split("$");
  let salt=DUMMY_PASSWORD_SALT;
  let expected=DUMMY_PASSWORD_EXPECTED;
  let usableHash=false;
  if(parts.length===4 && parts[0]==="pbkdf2-sha256" && Number(parts[1])===PBKDF2_ITERATIONS) {
    try {
      const candidateSalt=unb64(parts[2]);
      const candidateExpected=unb64(parts[3]);
      if(candidateSalt.length===16 && candidateExpected.length===PBKDF2_KEY_BYTES) {
        salt=candidateSalt;
        expected=candidateExpected;
        usableHash=true;
      }
    } catch {
      // Malformed stored credentials use the same dummy verification path.
    }
  }
  // Always perform exactly one PBKDF2 derivation, including when no account exists.
  const derived=await derivePassword(String(password??""),salt);
  let difference=0;
  for(let i=0;i<PBKDF2_KEY_BYTES;i++) difference|=expected[i]^derived[i];
  return usableHash && difference===0;
}
async function route(request, env) {
  const url=new URL(request.url), path=url.pathname, method=request.method, origin=request.headers.get("Origin");
  if(method==="OPTIONS") {
    if(!isTrustedAppOrigin(origin,env)) return response({error:"origin_forbidden"},403,origin,env);
    return new Response(null,{status:204,headers:corsHeaders(origin,env)});
  }
  // Only the public health and university-catalog reads may omit Origin.
  // Other routes must prove the exact app origin, including GET handlers that
  // also expire transfers or append security audit records.
  const originlessPublicRead = origin === null &&
    (method === "GET" || method === "HEAD") &&
    (path === "/api/health" || path === "/api/universities");
  if(!isTrustedAppOrigin(origin,env) && !originlessPublicRead)
    return response({error:"origin_forbidden"},403,origin,env);
  if(path==="/api/health" && method==="GET") return response({
    ok:true,service:"zhuoyue-2026-api",build:"encrypted-d1-backup-20261128",
    passwordKdf:"pbkdf2-sha256-100000",
    readiness:{
      rateLimitConfigured:typeof env.RATE_LIMIT_HMAC_SECRET==="string"&&env.RATE_LIMIT_HMAC_SECRET.length>=32,
      turnstileConfigured:!!env.TURNSTILE_SECRET_KEY,
      smsCredentialsConfigured:!!env.ALIBABA_ACCESS_KEY_ID&&!!env.ALIBABA_ACCESS_KEY_SECRET,
      smsTemplateConfigured:!!env.ALIBABA_SIGN_NAME&&!!env.ALIBABA_TEMPLATE_CODE,
      backupStorageConfigured:!!env.D1_BACKUPS,
      backupWorkflowConfigured:!!env.D1_BACKUP_WORKFLOW,
      backupExportConfigured:!!env.CLOUDFLARE_ACCOUNT_ID&&!!env.CLOUDFLARE_API_TOKEN&&!!env.D1_DATABASE_ID,
      backupEncryptionConfigured:typeof env.BACKUP_MASTER_KEY_V1==="string"&&env.BACKUP_MASTER_KEY_V1.length>=32
    }
  },200,origin,env);
  if(path==="/api/donations" && method==="GET") {
    try {
      const rows=await env.DB.prepare("SELECT id,nickname,amount_cents AS amountCents,display_order AS displayOrder FROM donation_records ORDER BY display_order ASC,created_at ASC,id ASC LIMIT 300").all();
      return response({items:(rows.results||[]).map(item=>({
        id:item.id,nickname:item.nickname,amountCents:Number(item.amountCents)||0,displayOrder:Number(item.displayOrder)||0
      }))},200,origin,env);
    } catch(error) {
      console.error("Public donation list failed",error?.message||"unknown");
      return response({error:"donation_list_unavailable"},503,origin,env);
    }
  }
  if(path==="/api/universities" && method==="GET") {
    // Public, read-only catalog lookup for profile selection. Never expose
    // draft/unverified, inactive, merged, or legacy free-form university rows.
    const rawQuery=(url.searchParams.get("q")||"").trim();
    if(rawQuery.length>80) return response({error:"query_too_long"},400,origin,env);
    const normalizedQuery=rawQuery.normalize("NFKC").replace(/[\s\p{P}\p{S}]+/gu,"").toLowerCase();
    if(rawQuery && !normalizedQuery) return response({error:"invalid_query"},400,origin,env);

    let category=(url.searchParams.get("category")||"").trim().toLowerCase();
    let countryCode=(url.searchParams.get("countryCode")||"").trim().toUpperCase();
    let provinceCode=(url.searchParams.get("provinceCode")||"").trim().toUpperCase();
    if(category && !["mainland","hmt","overseas"].includes(category)) return response({error:"invalid_category"},400,origin,env);
    if(countryCode && !/^[A-Z]{2}$/.test(countryCode)) return response({error:"invalid_country_code"},400,origin,env);
    if(provinceCode && !/^CN-\d{2}$/.test(provinceCode)) return response({error:"invalid_province_code"},400,origin,env);
    if(category==="mainland") {
      if(countryCode && countryCode!=="CN") return response({error:"catalog_filter_conflict"},400,origin,env);
      countryCode="CN";
    }
    if(category==="hmt" && countryCode && !["HK","MO","TW"].includes(countryCode)) return response({error:"catalog_filter_conflict"},400,origin,env);
    if(category==="overseas" && ["CN","HK","MO","TW"].includes(countryCode)) return response({error:"catalog_filter_conflict"},400,origin,env);
    if(provinceCode) {
      if(category && category!=="mainland") return response({error:"catalog_filter_conflict"},400,origin,env);
      if(countryCode && countryCode!=="CN") return response({error:"catalog_filter_conflict"},400,origin,env);
      category="mainland";
      countryCode="CN";
    }
    if(!rawQuery && !category && !countryCode && !provinceCode) return response({error:"catalog_filter_required"},400,origin,env);

    const parseQueryInteger=(value,fallback,min,max)=>{
      if(value===null) return fallback;
      if(!/^(0|[1-9]\d*)$/.test(value)) return null;
      const parsed=Number(value);
      return Number.isSafeInteger(parsed) && parsed>=min && parsed<=max ? parsed : null;
    };
    const limit=parseQueryInteger(url.searchParams.get("limit"),10,1,25);
    const offset=parseQueryInteger(url.searchParams.get("offset"),0,0,1000);
    if(limit===null || offset===null) return response({error:"invalid_pagination"},400,origin,env);

    const where=[
      "u.catalog_id IS NOT NULL",
      "u.catalog_status='active'",
      "u.verification_status='verified'",
      "u.verified_at IS NOT NULL",
      "trim(u.verified_at)<>''"
    ];
    const bindings=[];
    if(category) { where.push("u.category=?"); bindings.push(category); }
    if(countryCode) { where.push("u.country_code=?"); bindings.push(countryCode); }
    if(provinceCode) { where.push("u.province_code=?"); bindings.push(provinceCode); }
    if(rawQuery) {
      const searchParts=[
        "instr(u.catalog_normalized_name,?)>0",
        "instr(lower(coalesce(u.name_en,'')),lower(?))>0",
        "EXISTS (SELECT 1 FROM university_aliases ua WHERE ua.university_id=u.id AND instr(ua.normalized_alias,?)>0)"
      ];
      bindings.push(normalizedQuery,rawQuery,normalizedQuery);
      // School codes are searched by a literal prefix only; user input is
      // never interpolated into a LIKE pattern containing wildcards.
      if(/^[A-Za-z0-9-]{1,24}$/.test(rawQuery)) {
        searchParts.push("u.official_school_code LIKE ?");
        bindings.push(rawQuery+"%");
      }
      where.push("("+searchParts.join(" OR ")+")");
    }
    const sql=[
      "SELECT u.catalog_id,u.canonical_name,u.name_en,u.category,",
      "u.country_code,u.country_name_zh,u.country_name_en,u.province_code,u.province_name_zh,",
      "u.city_name_zh,u.official_school_code,u.degree_levels_json,u.ownership,u.verified_at",
      "FROM universities u",
      "WHERE "+where.join(" AND "),
      "ORDER BY u.category,u.canonical_name,u.catalog_id",
      "LIMIT ? OFFSET ?"
    ].join(" ");
    const result=await env.DB.prepare(sql).bind(...bindings,limit+1,offset).all();
    const rows=result.results||[];
    const hasMore=rows.length>limit;
    const universities=rows.slice(0,limit).map(row=>{
      let degreeLevels=[];
      try {
        const parsed=JSON.parse(row.degree_levels_json||"[]");
        if(Array.isArray(parsed)) degreeLevels=parsed.filter(value=>typeof value==="string");
      } catch { /* malformed legacy data is never reflected as raw JSON */ }
      return {
        id:row.catalog_id,
        name:row.canonical_name,
        nameEn:row.name_en||null,
        category:row.category,
        countryCode:row.country_code,
        countryName:row.country_name_zh,
        countryNameEn:row.country_name_en||null,
        provinceCode:row.province_code||null,
        provinceName:row.province_name_zh||null,
        cityName:row.city_name_zh||null,
        schoolCode:row.official_school_code||null,
        degreeLevels,
        ownership:row.ownership,
        verifiedAt:row.verified_at
      };
    });
    return response({universities,pagination:{limit,offset,hasMore}},200,origin,env);
  }
  if(path==="/api/auth/register/request-code" && method==="POST") {
    try { const d=await body(request); if(d.accountConsent !== true) return response({error:"consent_required"},400,origin,env); return response(await sendCode(String(d.phone||""),"register",d.turnstileToken,request,env),200,origin,env); }
    catch(e) {
      const payload={error:e.error||e.message||"request_failed"};
      if(e.refreshTurnstile) payload.refreshTurnstile=true;
      if(Number.isFinite(e.retryAfter)) payload.retryAfter=e.retryAfter;
      return response(payload,e.status||400,origin,env);
    }
  }
  if(path==="/api/auth/password/request-code" && method==="POST") {
    try { const d=await body(request); return response(await sendCode(String(d.phone||""),"password_reset",d.turnstileToken,request,env),200,origin,env); }
    catch(e) {
      const payload={error:e.error||e.message||"request_failed"};
      if(e.refreshTurnstile) payload.refreshTurnstile=true;
      if(Number.isFinite(e.retryAfter)) payload.retryAfter=e.retryAfter;
      return response(payload,e.status||400,origin,env);
    }
  }
  if(path==="/api/account/delete/request-code" && method==="POST") {
    const user=await currentUser(request,env);
    if(!user) return response({error:"unauthorized"},401,origin,env);
    try {
      const d=await body(request);
      return response(await sendCode(user.phone,"account_delete",d.turnstileToken,request,env),200,origin,env);
    } catch(e) {
      const payload={error:e.error||e.message||"request_failed"};
      if(e.refreshTurnstile) payload.refreshTurnstile=true;
      if(Number.isFinite(e.retryAfter)) payload.retryAfter=e.retryAfter;
      return response(payload,e.status||400,origin,env);
    }
  }
  if(path==="/api/auth/register" && method==="POST") {
    try { const d=await body(request); const registered=await register(d,env); const s=await createSession(env.DB,registered.id,env,registered); return response({ok:true},201,origin,env,{"set-cookie":cookie(s.token,s.maxAge)}); }
    catch(e) { return response({error:e.error||e.message||"registration_failed"},e.status||400,origin,env); }
  }
  if(path==="/api/auth/login" && method==="POST") {
    try {
      const d=await body(request),phone=String(d.phone||""),password=String(d.password||"");
      if(!validPhone(phone) || !password || password.length>128) return response({error:"invalid_credentials"},400,origin,env);
      const ip=request.headers.get("CF-Connecting-IP")||"unknown";
      const ipKey = await rateLimitKey(env,"login:ip",ip);
      const phoneKey = await rateLimitKey(env,"login:phone",phone);
      if(!(await rateLimit(env.DB,ipKey,30,900)) || !(await rateLimit(env.DB,phoneKey,10,900))) return response({error:"rate_limited"},429,origin,env);
      const user=await env.DB.prepare("SELECT id,password_hash,auth_version FROM users WHERE phone=? AND deleted_at=''").bind(phone).first();
      const passwordMatches=await verifyPassword(password,user?.password_hash);
      if(!user || !passwordMatches) return response({error:"invalid_credentials"},401,origin,env);
      const s=await createSession(env.DB,user.id,env,{passwordHash:user.password_hash,authVersion:Number(user.auth_version)});
      return response({ok:true},200,origin,env,{"set-cookie":cookie(s.token,s.maxAge)});
    } catch(e) {
      if (e?.error) return response({error:e.error},e.status||500,origin,env);
      return response({error:"login_failed"},500,origin,env);
    }
  }
  if(path==="/api/auth/password/change" && method==="POST") {
    const user=await currentUser(request,env);
    if(!user) return response({error:"unauthorized"},401,origin,env);
    try {
      const d=await body(request);
      const currentPassword=String(d.currentPassword||"");
      const newPassword=String(d.newPassword||"");
      if(currentPassword.length<1 || currentPassword.length>128) return response({error:"current_password_invalid"},401,origin,env);
      if(newPassword.length<10 || newPassword.length>128) return response({error:"weak_password"},400,origin,env);
      if(currentPassword===newPassword) return response({error:"same_password"},400,origin,env);
      const account=await env.DB.prepare("SELECT password_hash,auth_version FROM users WHERE id=? AND deleted_at=''").bind(user.id).first();
      if(!account || !(await verifyPassword(currentPassword,account.password_hash))) return response({error:"current_password_invalid"},401,origin,env);
      const salt=crypto.getRandomValues(new Uint8Array(16));
      const derived=await derivePassword(newPassword,salt);
      const hash="pbkdf2-sha256$"+PBKDF2_ITERATIONS+"$"+b64(salt)+"$"+b64(derived);
      const sessionDigest=await sha256(getCookie(request));
      const timestamp=new Date().toISOString();
      const auditId=randomHex(16);
      const results=await env.DB.batch([
        env.DB.prepare("UPDATE users SET password_hash=?,auth_version=auth_version+1,updated_at=? WHERE id=? AND deleted_at='' AND password_hash=? AND auth_version=?")
          .bind(hash,timestamp,user.id,account.password_hash,Number(account.auth_version)),
        env.DB.prepare("UPDATE sessions SET auth_version=(SELECT auth_version FROM users WHERE id=? AND password_hash=? AND deleted_at='') WHERE user_id=? AND token_hash=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND password_hash=? AND deleted_at='')")
          .bind(user.id,hash,user.id,sessionDigest,user.id,hash),
        env.DB.prepare("DELETE FROM sessions WHERE user_id=? AND token_hash<>? AND EXISTS(SELECT 1 FROM users WHERE id=? AND password_hash=? AND deleted_at='')")
          .bind(user.id,sessionDigest,user.id,hash),
        env.DB.prepare("INSERT INTO audit_logs(id,actor_type,actor_id,action,target_type,target_id,metadata_json) SELECT ?,'user',?,'user.password.changed','user',?,'{}' WHERE EXISTS(SELECT 1 FROM users WHERE id=? AND password_hash=? AND deleted_at='')")
          .bind(auditId,user.id,user.id,user.id,hash)
      ]);
      if((results[0]?.meta?.changes||0)!==1) return response({error:"password_change_conflict"},409,origin,env);
      const currentSessionRetained=(results[1]?.meta?.changes||0)===1;
      return response({ok:true,sessionsRevoked:true},200,origin,env,currentSessionRetained?{}:{"set-cookie":cookie("",0)});
    } catch(e) {
      return response({error:e.error||"password_change_failed"},e.status||500,origin,env);
    }
  }
  if(path==="/api/auth/password/reset" && method==="POST") {
    try {
      const d=await body(request),phone=String(d.phone||""),password=String(d.newPassword||"");
      if(password.length<10 || password.length>128) return response({error:"weak_password"},400,origin,env);
      if(!validPhone(phone)) return response({error:"invalid_code"},400,origin,env);
      const account=await env.DB.prepare("SELECT id,password_hash,auth_version FROM users WHERE phone=? AND deleted_at=''").bind(phone).first();
      if(!account) return response({error:"invalid_code"},400,origin,env);
      const salt=crypto.getRandomValues(new Uint8Array(16));
      const derived=await derivePassword(password,salt);
      // Derive before redeeming the provider code; the D1 compare-and-swap below
      // prevents two separately issued reset challenges from overwriting each other.
      await verifyCode(phone,d.code,"password_reset",env);
      const hash="pbkdf2-sha256$"+PBKDF2_ITERATIONS+"$"+b64(salt)+"$"+b64(derived);
      const timestamp=new Date().toISOString();
      const auditId=randomHex(16);
      const nextVersion=Number(account.auth_version)+1;
      const results=await env.DB.batch([
        env.DB.prepare("UPDATE users SET password_hash=?,auth_version=auth_version+1,updated_at=? WHERE id=? AND phone=? AND deleted_at='' AND password_hash=? AND auth_version=?")
          .bind(hash,timestamp,account.id,phone,account.password_hash,Number(account.auth_version)),
        env.DB.prepare("DELETE FROM sessions WHERE user_id=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND password_hash=? AND auth_version=? AND deleted_at='')")
          .bind(account.id,account.id,hash,nextVersion),
        env.DB.prepare("INSERT INTO audit_logs(id,actor_type,actor_id,action,target_type,target_id,metadata_json) SELECT ?,'user',?,'user.password.reset','user',?,'{}' WHERE EXISTS(SELECT 1 FROM users WHERE id=? AND password_hash=? AND auth_version=? AND deleted_at='')")
          .bind(auditId,account.id,account.id,account.id,hash,nextVersion)
      ]);
      if((results[0]?.meta?.changes||0)!==1) return response({error:"password_reset_conflict"},409,origin,env);
      return response({ok:true,sessionsRevoked:true},200,origin,env,{"set-cookie":cookie("",0)});
    } catch(e) { return response({error:e.error||e.message||"password_reset_failed"},e.status||400,origin,env); }
  }
  if(path==="/api/account/delete" && method==="POST") {
    const user=await currentUser(request,env);
    if(!user) return response({error:"unauthorized"},401,origin,env);
    try {
      const d=await body(request);
      if(d.confirmText!=="DELETE") return response({error:"account_delete_confirm_required"},400,origin,env);
      const password=String(d.password||"");
      if(!password || password.length>128) return response({error:"current_password_invalid"},401,origin,env);
      const account=await env.DB.prepare("SELECT password_hash,auth_version FROM users WHERE id=? AND deleted_at=''").bind(user.id).first();
      if(!account || !(await verifyPassword(password,account.password_hash))) return response({error:"current_password_invalid"},401,origin,env);
      const leadership=await env.DB.prepare(`SELECT t.id,
        (SELECT COUNT(*) FROM users member WHERE member.university_id=t.university_id AND member.deleted_at='' AND member.id<>?) AS other_members
        FROM teams t WHERE t.leader_user_id=? LIMIT 1`).bind(user.id,user.id).first();
      if(leadership && Number(leadership.other_members||0)>0) return response({error:"leader_transfer_required"},409,origin,env);
      await verifyCode(user.phone,d.code,"account_delete",env);
      const timestamp=new Date().toISOString();
      const deletionIntent=await recordDeletionIntent(env.DELETE_LEDGER,user.id,timestamp,randomHex(16));
      const phoneRateLimitKeys=await Promise.all([
        rateLimitKey(env,"sms:cooldown",user.phone),
        rateLimitKey(env,"sms:phone",user.phone),
        rateLimitKey(env,"login:phone",user.phone)
      ]);
      const statements=[
        env.DB.prepare("UPDATE leader_transfers SET status='expired',responded_at=? WHERE status='pending' AND (from_user_id=? OR to_user_id=?)").bind(timestamp,user.id,user.id),
        env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(user.id),
        env.DB.prepare("DELETE FROM otp_challenges WHERE phone=?").bind(user.phone),
        env.DB.prepare("DELETE FROM rate_limits WHERE bucket_key IN (?,?,?,?,?,?)").bind(...phoneRateLimitKeys,"sms:cooldown:"+user.phone,"sms:phone:"+user.phone,"login:phone:"+user.phone),
        env.DB.prepare("UPDATE teams SET leader_user_id=NULL WHERE leader_user_id=? AND id=? AND NOT EXISTS (SELECT 1 FROM users member WHERE member.university_id=teams.university_id AND member.deleted_at='' AND member.id<>?)").bind(user.id,leadership?.id||"",user.id),
        env.DB.prepare(`UPDATE users SET phone='deleted:'||id,password_hash=NULL,name=NULL,high_school=NULL,class_name='',
          university_id=NULL,grade=NULL,province=NULL,city=NULL,bio=NULL,greeting='',gender='undisclosed',major_group='',
          major_discipline_code='',admission_category_id='',admission_type_id='',campus_id='',campus_name='',
          campus_tag='',secondary_phone='',wechat_id='',profile_review_status='rejected',overseas_university_name='',
          profile_review_submitted_at='',profile_reviewed_at='',phone_visible_to_team=0,
          consent_at='',consent_given=0,consent_version='',account_consent_at='',account_consent_version='',
          deleted_at=?,updated_at=? WHERE id=? AND deleted_at='' AND password_hash=? AND auth_version=?
          AND NOT EXISTS(SELECT 1 FROM teams WHERE leader_user_id=users.id)
          AND NOT EXISTS(SELECT 1 FROM leader_transfers WHERE status='pending' AND (from_user_id=users.id OR to_user_id=users.id))`).bind(timestamp,timestamp,user.id,account.password_hash,Number(account.auth_version)),
        env.DB.prepare("INSERT INTO audit_logs(id,actor_type,actor_id,action,target_type,target_id,metadata_json) VALUES(?,'system',NULL,'account.deleted','user',?,?)")
          .bind(deletionIntent.record.eventId,user.id,JSON.stringify({method:"password_and_sms_anonymization"})),
        env.DB.prepare("DELETE FROM group_chat_confirmations WHERE user_id=?").bind(user.id)
      ];
      const results=await env.DB.batch(statements);
      if((results[5]?.meta?.changes||0)!==1) return response({error:"account_delete_conflict"},409,origin,env);
      return response({ok:true,anonymized:true},200,origin,env,{"set-cookie":cookie("",0)});
    } catch(e) {
      const known=String(e.error||e.message||"account_delete_failed");
      const conflict=["account_delete_conflict","account_deletion_requires_team_transfer","account_deletion_requires_no_pending_transfer"].find(code=>known.includes(code));
      const error=conflict==="account_deletion_requires_team_transfer"?"leader_transfer_required":conflict?"account_delete_conflict":known;
      const status=e.status||(error==="deletion_ledger_unavailable"?503:conflict?409:400);
      return response({error},status,origin,env);
    }
  }
  if(path==="/api/auth/logout" && method==="POST") {
    const token=getCookie(request); if(token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(await sha256(token)).run();
    return response({ok:true},200,origin,env,{"set-cookie":cookie("",0)});
  }
  if(path==="/api/profile/reset" && method==="POST") {
    const user=await currentUser(request,env);
    if(!user) return response({error:"unauthorized"},401,origin,env);
    try {
      const previousUniversityId=user.university_id||"";
      let oldTeam=null;
      if(previousUniversityId) {
        oldTeam=await env.DB.prepare(`SELECT t.id,t.leader_user_id AS leaderUserId,
          (SELECT COUNT(*) FROM users member WHERE member.university_id=t.university_id AND member.deleted_at='') AS memberCount
          FROM teams t WHERE t.university_id=? LIMIT 1`).bind(previousUniversityId).first();
        if(oldTeam?.leaderUserId===user.id&&Number(oldTeam.memberCount||0)>1) {
          return response({error:"team_leader_transfer_required"},409,origin,env);
        }
      }
      const timestamp=new Date().toISOString();
      const statements=[];
      if(previousUniversityId) {
        statements.push(env.DB.prepare(`UPDATE leader_transfers SET status='expired',responded_at=?
          WHERE status='pending' AND team_id IN (SELECT id FROM teams WHERE university_id=?)
            AND (from_user_id=? OR to_user_id=?)`).bind(timestamp,previousUniversityId,user.id,user.id));
        statements.push(env.DB.prepare(`INSERT OR IGNORE INTO audit_logs(id,actor_type,actor_id,action,target_type,target_id,metadata_json)
          SELECT 'transfer-left-school-'||id,'user',?,'team.transfer.expired_on_school_reset','team',team_id,
            json_object('transferId',id,'universityId',?)
          FROM leader_transfers
          WHERE status='expired' AND responded_at=? AND team_id IN (SELECT id FROM teams WHERE university_id=?)
            AND (from_user_id=? OR to_user_id=?)`)
          .bind(user.id,previousUniversityId,timestamp,previousUniversityId,user.id,user.id));
        // The team-leader membership trigger requires releasing a sole-member leader
        // before the user row is detached from the old university.
        statements.push(env.DB.prepare(`UPDATE teams SET leader_user_id=NULL
          WHERE university_id=? AND leader_user_id=?
            AND NOT EXISTS(SELECT 1 FROM users member
              WHERE member.university_id=? AND member.deleted_at='' AND member.id<>?)`)
          .bind(previousUniversityId,user.id,previousUniversityId,user.id));
      }
      statements.push(env.DB.prepare(`UPDATE users SET
        university_id=NULL,name=NULL,high_school=NULL,class_name='',
        grade=NULL,province=NULL,city=NULL,bio=NULL,greeting='',
        gender='undisclosed',major_group='',major_discipline_code='',
        admission_category_id='',admission_type_id='',campus_id='',campus_name='',campus_tag='',
        secondary_phone='',wechat_id='',phone_visible_to_team=0,
        profile_review_status='approved',overseas_university_name='',
        profile_review_submitted_at='',profile_reviewed_at='',
        consent_given=0,consent_at='',consent_version='',
        account_consent_at='',account_consent_version='',updated_at=?
        WHERE id=? AND deleted_at='' AND COALESCE(university_id,'')=?`)
        .bind(timestamp,user.id,previousUniversityId));
      statements.push(env.DB.prepare(`INSERT INTO audit_logs(id,actor_type,actor_id,action,target_type,target_id,metadata_json)
        VALUES(?,'user',?,'profile.university_removed','user',?,?)`)
        .bind(randomHex(16),user.id,user.id,JSON.stringify({previousUniversityId:previousUniversityId||null,transferHistoryPreserved:true})));
      statements.push(env.DB.prepare("DELETE FROM group_chat_confirmations WHERE user_id=?").bind(user.id));
      const results=await env.DB.batch(statements);
      const userUpdateIndex=previousUniversityId?3:0;
      if(!results?.[userUpdateIndex]?.meta||Number(results[userUpdateIndex].meta.changes||0)!==1) {
        return response({error:"profile_reset_conflict"},409,origin,env);
      }
      return response({ok:true,profileReset:true,transferHistoryPreserved:true},200,origin,env);
    } catch(error) {
      const reason=String(error?.message||"");
      if(reason.includes("leader_must_transfer_team_first")) return response({error:"team_leader_transfer_required"},409,origin,env);
      console.error("Profile reset failed",reason||"unknown");
      return response({error:"profile_reset_failed"},500,origin,env);
    }
  }

  if(path==="/api/profile" && method==="GET") {
    const user=await currentUser(request,env); if(!user) return response({error:"unauthorized"},401,origin,env);
    let uni=null,profileCatalog=null;
    if(user.university_id) {
      uni=await env.DB.prepare("SELECT canonical_name,category,region_name,education_level,partner_name,project_tags_json,catalog_id FROM universities WHERE id=?").bind(user.university_id).first();
      profileCatalog=await env.DB.prepare("SELECT source_id FROM profile_university_catalog WHERE university_id=?").bind(user.university_id).first();
    }
    return response({profile:{
      name:user.name,phone:user.phone,highSchool:user.high_school,
      university:user.profile_review_status==="pending"?(user.overseas_university_name||""):uni?.canonical_name||"",
      universityCatalogId:uni?.catalog_id||null,profileUniversityId:profileCatalog?.source_id||null,
      universityCategory:uni?.category||(user.profile_review_status==="pending"?"overseas":""),
      regionName:uni?.region_name||"",educationLevel:uni?.education_level||"",
      partnerName:uni?.partner_name||"",projectTags:uni?.project_tags_json||"[]",
      grade:user.grade,province:user.province,city:user.city,greeting:user.greeting||'',
      gender:user.gender||"",majorDisciplineCode:user.major_discipline_code||"",
      admissionCategoryId:user.admission_category_id||"",
      campusId:user.campus_id||"",campusName:user.campus_name||"",campusTag:user.campus_tag||"",
      secondaryPhone:user.secondary_phone||"",wechatId:user.wechat_id||"",
      profileReviewStatus:user.profile_review_status||"approved",
      overseasUniversityName:user.overseas_university_name||"",
      profileReviewSubmittedAt:user.profile_review_submitted_at||"",profileReviewedAt:user.profile_reviewed_at||"",
      consentGiven:!!user.consent_given&&!!user.consent_at&&user.consent_version===PRIVACY_NOTICE_VERSION&&!!user.account_consent_at&&user.account_consent_version===PRIVACY_NOTICE_VERSION,
      consentAt:user.consent_at||"",consentVersion:user.consent_version||"",
      accountConsentGiven:!!user.account_consent_at&&user.account_consent_version===PRIVACY_NOTICE_VERSION
    }},200,origin,env);
  }
  if(path==="/api/profile" && method==="PUT") {
    const user=await currentUser(request,env); if(!user) return response({error:"unauthorized"},401,origin,env);
    try {
      const d=await body(request);
      if(d.consent!==true) return response({error:"consent_required"},400,origin,env);
      const name=String(d.name||"").trim();
      const highSchool=String(d.highSchool||"青岛五十八中").trim();
      const grade=String(d.grade||"").trim(),gender=String(d.gender||"").trim();
      const greeting=String(d.greeting||"").trim(),secondaryPhone=String(d.secondaryPhone||"").trim();
      const wechatId=String(d.wechatId||"").trim();
      const requestedCategory=String(d.universityCategory||"").trim();
      if(!name||!grade||!gender||!highSchool) return response({error:"profile_incomplete"},400,origin,env);
      if(!["male","female","undisclosed"].includes(gender)) return response({error:"gender_required"},400,origin,env);
      if(name.length>80||highSchool.length>100||grade.length>40||greeting.length>500||secondaryPhone.length>20||wechatId.length>80) return response({error:"profile_field_too_long"},400,origin,env);
      if(secondaryPhone&&!validPhone(secondaryPhone)) return response({error:"invalid_secondary_phone"},400,origin,env);

      let uni=null,profileCatalog=null,universityId=null,category="",regionName="",educationLevel="",partnerName="";
      let province="",city="",campusId="",campusName="",campusTag="",sourceTags=[];
      let overseasUniversityName="",reviewStatus="approved";
      const profileSourceId=String(d.profileUniversityId||"").trim();
      if(profileSourceId) {
        if(profileSourceId.length>80||/[\u0000-\u001f]/.test(profileSourceId)) return response({error:"profile_reference_invalid"},400,origin,env);
        profileCatalog=await env.DB.prepare("SELECT source_id,university_id,category,canonical_name,region_name,province_name,city_name,tags_json,campuses_json FROM profile_university_catalog WHERE source_id=?").bind(profileSourceId).first();
        if(!profileCatalog) return response({error:"profile_reference_invalid"},400,origin,env);
        category=String(profileCatalog.category||"");
        if(!["mainland","hmt"].includes(category)||requestedCategory!==category) return response({error:"profile_reference_invalid"},400,origin,env);
        uni=await env.DB.prepare("SELECT id,canonical_name,category,region_name,education_level,partner_name FROM universities WHERE id=?").bind(profileCatalog.university_id).first();
        if(!uni||uni.category!==category) return response({error:"profile_reference_invalid"},400,origin,env);
        universityId=uni.id;regionName=String(profileCatalog.region_name||"");
        educationLevel=category==="mainland"?"undergraduate":String(uni.education_level||"");
        partnerName=String(uni.partner_name||"");
        try{sourceTags=JSON.parse(profileCatalog.tags_json||"[]");if(!Array.isArray(sourceTags))sourceTags=[];}catch{return response({error:"profile_reference_invalid"},400,origin,env);}
        if(category==="mainland") {
          try {
            const campusGroups=JSON.parse(profileCatalog.campuses_json||"[]");
            if(!Array.isArray(campusGroups)) return response({error:"profile_reference_invalid"},400,origin,env);
            const choices=[];
            for(const root of campusGroups){if(root&&root.id)choices.push(root);for(const branch of root?.branches||[])if((branch.status||"active")==="active")choices.push(branch);}
            const chosen=choices.find(item=>item.id===String(d.campusId||""));
            if(!chosen) return response({error:"campus_selection_required"},400,origin,env);
            campusId=String(chosen.id);campusName=String(chosen.name||"校区");campusTag=String(chosen.tag||"");
            const campusCountry=String(chosen.country||"中国");
            const campusProvince=String(chosen.province||profileCatalog.province_name||"");
            province=campusCountry&&campusCountry!=="中国"?[campusCountry,campusProvince].filter(Boolean).join(" · "):campusProvince;
            city=String(chosen.city||profileCatalog.city_name||"");
            if(!province) return response({error:"profile_reference_invalid"},400,origin,env);
          }catch(error){if(error?.error)return response({error:error.error},error.status||400,origin,env);return response({error:"profile_reference_invalid"},400,origin,env);}
        } else {
          if(String(d.campusId||"")) return response({error:"profile_reference_invalid"},400,origin,env);
          province=regionName;city=String(profileCatalog.city_name||"");
        }
      } else if(requestedCategory==="overseas") {
        overseasUniversityName=String(d.university||"").trim().replace(/\s+/g," ");
        if(!overseasUniversityName||overseasUniversityName.length>160) return response({error:"overseas_university_required"},400,origin,env);
        category="overseas";reviewStatus="pending";province="";city="";
      } else {
        // Compatibility for accounts that were assigned before the source-ID catalog existed.
        if(!user.university_id) return response({error:"university_catalog_selection_required"},400,origin,env);
        uni=await env.DB.prepare("SELECT id,canonical_name,category,region_name,education_level,partner_name FROM universities WHERE id=?").bind(user.university_id).first();
        if(!uni) return response({error:"university_change_requires_support"},409,origin,env);
        const submitted=String(d.university||"").trim().replace(/\s+/g," ");
        const normalizeName=value=>String(value||"").normalize("NFKC").replace(/[\s\p{P}\p{S}]+/gu,"").toLowerCase();
        if(submitted&&normalizeName(submitted)!==normalizeName(uni.canonical_name)) return response({error:"university_change_requires_support"},409,origin,env);
        if(requestedCategory&&requestedCategory!==uni.category) return response({error:"university_change_requires_support"},409,origin,env);
        category=String(uni.category||"");universityId=uni.id;
        regionName=String(uni.region_name||"");educationLevel=String(uni.education_level||"");partnerName=String(uni.partner_name||"");
        province=String(d.province||"").trim();city=String(d.city||"").trim();
        if(!["mainland","hmt","sino_foreign","overseas"].includes(category)) return response({error:"university_change_requires_support"},409,origin,env);
      }
      const previousUniversityId=user.university_id||null;
      const changingUniversity=(previousUniversityId||null)!==(universityId||null);
      if(changingUniversity&&previousUniversityId){
        const oldTeam=await env.DB.prepare(`SELECT t.leader_user_id AS leaderUserId,
          (SELECT COUNT(*) FROM users member WHERE member.university_id=t.university_id AND member.deleted_at='') AS memberCount
          FROM teams t WHERE t.university_id=? LIMIT 1`).bind(previousUniversityId).first();
        if(oldTeam?.leaderUserId===user.id&&Number(oldTeam.memberCount||0)>1){
          return response({error:"team_leader_transfer_required"},409,origin,env);
        }
      }

      const majorDisciplineCode=String(d.majorDisciplineCode||"").trim();
      const major=await env.DB.prepare("SELECT code FROM profile_option_codes WHERE option_type='major_discipline' AND code=? AND is_active=1").bind(majorDisciplineCode).first();
      if(!major) return response({error:"major_discipline_required"},400,origin,env);
      if(majorDisciplineCode==="11"&&!sourceTags.includes("military_academy")) return response({error:"profile_reference_invalid"},400,origin,env);
      let admissionCategoryId="";
      if(category==="mainland") {
        admissionCategoryId=String(d.admissionCategoryId||"").trim();
        const admission=await env.DB.prepare("SELECT code FROM profile_option_codes WHERE option_type='admission_category' AND code=? AND is_active=1").bind(admissionCategoryId).first();
        if(!admission) return response({error:"admission_category_required"},400,origin,env);
      }

      const savedAt=new Date().toISOString();
      const statements=[];
      if(universityId) {
        statements.push(env.DB.prepare("UPDATE universities SET region_name=CASE WHEN region_name='' THEN ? ELSE region_name END,education_level=CASE WHEN education_level='' THEN ? ELSE education_level END,partner_name=CASE WHEN partner_name='' THEN ? ELSE partner_name END WHERE id=?")
          .bind(regionName,educationLevel,partnerName,universityId));
      }
      if(changingUniversity&&previousUniversityId){
        // Pending offers in the school being left are closed as expired, not deleted.
        statements.push(env.DB.prepare(`UPDATE leader_transfers SET status='expired',responded_at=?
          WHERE status='pending' AND team_id IN (SELECT id FROM teams WHERE university_id=?)
            AND (from_user_id=? OR to_user_id=?)`).bind(savedAt,previousUniversityId,user.id,user.id));
        statements.push(env.DB.prepare(`INSERT OR IGNORE INTO audit_logs(id,actor_type,actor_id,action,target_type,target_id,metadata_json)
          SELECT 'transfer-left-school-'||id,'user',?,'team.transfer.expired_on_school_change','team',team_id,
            json_object('transferId',id,'universityId',?)
          FROM leader_transfers
          WHERE status='expired' AND responded_at=? AND team_id IN (SELECT id FROM teams WHERE university_id=?)
            AND (from_user_id=? OR to_user_id=?)`)
          .bind(user.id,previousUniversityId,savedAt,previousUniversityId,user.id,user.id));
        // Release a sole-member leadership before changing users.university_id;
        // the database trigger rejects the reverse ordering.
        statements.push(env.DB.prepare(`UPDATE teams SET leader_user_id=NULL
          WHERE university_id=? AND leader_user_id=?
            AND NOT EXISTS(SELECT 1 FROM users member
              WHERE member.university_id=? AND member.deleted_at='' AND member.id<>?)`)
          .bind(previousUniversityId,user.id,previousUniversityId,user.id));
      }
      statements.push(env.DB.prepare("UPDATE users SET name=?,class_name='',high_school=?,university_id=?,grade=?,province=?,city=?,bio=NULL,greeting=?,gender=?,major_group='',major_discipline_code=?,admission_category_id=?,admission_type_id='',campus_id=?,campus_name=?,campus_tag=?,secondary_phone=?,wechat_id=?,phone_visible_to_team=1,profile_review_status=?,overseas_university_name=?,profile_review_submitted_at=CASE WHEN ?='pending' THEN ? ELSE '' END,profile_reviewed_at='',consent_given=1,consent_at=CASE WHEN consent_given=0 OR consent_version<>? THEN ? ELSE consent_at END,consent_version=?,account_consent_at=CASE WHEN account_consent_at='' OR account_consent_version<>? THEN ? ELSE account_consent_at END,account_consent_version=?,updated_at=? WHERE id=? AND deleted_at='' AND COALESCE(university_id,'')=?")
        .bind(name,highSchool,universityId,grade,province,city,greeting,gender,majorDisciplineCode,admissionCategoryId,campusId,campusName,campusTag,secondaryPhone,wechatId,reviewStatus,overseasUniversityName,reviewStatus,savedAt,PRIVACY_NOTICE_VERSION,savedAt,PRIVACY_NOTICE_VERSION,PRIVACY_NOTICE_VERSION,savedAt,PRIVACY_NOTICE_VERSION,savedAt,user.id,previousUniversityId||""));
      if(universityId) {
        statements.push(env.DB.prepare("UPDATE teams SET leader_user_id=? WHERE university_id=? AND leader_user_id IS NULL AND (SELECT COUNT(*) FROM users WHERE university_id=? AND deleted_at='')=1 AND EXISTS(SELECT 1 FROM users WHERE id=? AND university_id=? AND deleted_at='')").bind(user.id,universityId,universityId,user.id,universityId));
        statements.push(env.DB.prepare("INSERT OR IGNORE INTO teams(id,university_id,leader_user_id) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM users WHERE id=? AND university_id=? AND deleted_at='')").bind(randomHex(16),universityId,user.id,user.id,universityId));
      }
      if(changingUniversity) {
        statements.push(env.DB.prepare("DELETE FROM group_chat_confirmations WHERE user_id=?").bind(user.id));
      }
      const results=await env.DB.batch(statements);
      const userUpdateIndex=(universityId?1:0)+(changingUniversity&&previousUniversityId?3:0);
      if(!results?.[userUpdateIndex]?.meta||Number(results[userUpdateIndex].meta.changes||0)!==1) return response({error:"university_change_requires_support"},409,origin,env);
      return response({ok:true,reviewStatus,profileReviewStatus:reviewStatus},200,origin,env);
    }catch(error){
      if(error?.error)return response({error:error.error},error.status||400,origin,env);
      const reason=String(error?.message||"");
      if(reason.includes("leader_must_transfer_team_first")) return response({error:"team_leader_transfer_required"},409,origin,env);
      console.error("Profile save failed",reason||"unknown");
      return response({error:"profile_save_failed"},400,origin,env);
    }
  }
if(path==="/api/teams/transfer" && method==="POST") {
    const user=await currentUser(request,env); if(!user) return response({error:"unauthorized"},401,origin,env);
    try {
      const d=await body(request), targetId=String(d.toUserId||"").trim();
      if(!/^[a-f0-9]{32}$/.test(targetId)) return response({error:"invalid_transfer_target"},400,origin,env);
      await expirePendingTransfers(env.DB);
      const team=await env.DB.prepare("SELECT id,university_id FROM teams WHERE leader_user_id=?").bind(user.id).first();
      if(!team) return response({error:"not_team_leader"},403,origin,env);
      const target=await env.DB.prepare("SELECT id FROM users WHERE id=? AND university_id=?").bind(targetId,team.university_id).first();
      if(!target || targetId===user.id) return response({error:"transfer_target_not_in_team"},400,origin,env);
      const transferId=randomHex(16), createdAt=new Date().toISOString();
      const configuredTtl = Number(env.TRANSFER_TTL_SECONDS || 604800);
      const ttlSeconds = Number.isInteger(configuredTtl) && configuredTtl >= 3600 && configuredTtl <= 2592000 ? configuredTtl : 604800;
      const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
      const inserted=await env.DB.batch([
        env.DB.prepare(`INSERT INTO leader_transfers(
            id,team_id,from_user_id,to_user_id,status,created_at,expires_at,
            from_name_snapshot,to_name_snapshot,university_id_snapshot,university_name_snapshot
          )
          SELECT ?,t.id,?,?, 'pending',?,?,sender.name,recipient.name,t.university_id,uni.canonical_name
          FROM teams t
          JOIN universities uni ON uni.id=t.university_id
          JOIN users sender ON sender.id=?
          JOIN users recipient ON recipient.id=? AND recipient.university_id=t.university_id
          WHERE t.id=? AND t.leader_user_id=?
            AND sender.university_id=t.university_id
            AND NOT EXISTS(SELECT 1 FROM leader_transfers pending WHERE pending.team_id=t.id AND pending.status='pending')`)
          .bind(transferId,user.id,targetId,createdAt,expiresAt,user.id,targetId,team.id,user.id),
        env.DB.prepare(`INSERT OR IGNORE INTO audit_logs(id,actor_type,actor_id,action,target_type,target_id,metadata_json)
          SELECT ?, 'user', ?, 'team.transfer.requested', 'team', team_id, ?
          FROM leader_transfers WHERE id=? AND status='pending'`)
          .bind("transfer-requested-"+transferId,user.id,JSON.stringify({transferId,toUserId:targetId}),transferId)
      ]);
      if((inserted[0]?.meta?.changes||0)!==1) return response({error:"transfer_conflict_or_pending_exists"},409,origin,env);
      return response({ok:true,transferId,status:"pending"},201,origin,env);
    } catch(e) {
      const conflict=String(e.message||"").toLowerCase().includes("unique") || String(e.message||"").toLowerCase().includes("constraint");
      return response({error:conflict?"transfer_conflict_or_pending_exists":"transfer_request_failed"},conflict?409:400,origin,env);
    }
  }
  if(path==="/api/teams/transfers" && method==="GET") {
    const user=await currentUser(request,env); if(!user) return response({error:"unauthorized"},401,origin,env);
    await expirePendingTransfers(env.DB);
    const rows=await env.DB.prepare(`SELECT lt.id,lt.team_id,lt.from_user_id,lt.to_user_id,lt.status,
      lt.created_at,lt.expires_at AS expiresAt,lt.responded_at,
      COALESCE(NULLIF(lt.from_name_snapshot,''),sender.name,'') AS fromName,
      COALESCE(NULLIF(lt.to_name_snapshot,''),recipient.name,'') AS toName,
      COALESCE(NULLIF(lt.university_name_snapshot,''),uni.canonical_name,'未知高校') AS university,
      COALESCE(NULLIF(lt.university_id_snapshot,''),t.university_id) AS universityId,
      CASE WHEN t.university_id=(SELECT university_id FROM users WHERE id=?) THEN 1 ELSE 0 END AS isCurrentTeam
      FROM leader_transfers lt
      JOIN teams t ON t.id=lt.team_id
      JOIN universities uni ON uni.id=t.university_id
      LEFT JOIN users sender ON sender.id=lt.from_user_id
      LEFT JOIN users recipient ON recipient.id=lt.to_user_id
      WHERE COALESCE(NULLIF(lt.university_id_snapshot,''),t.university_id)=(SELECT university_id FROM users WHERE id=? AND deleted_at='')
      ORDER BY lt.created_at DESC LIMIT 100`).bind(user.id,user.id).all();
    return response({transfers:rows.results||[]},200,origin,env);
  }
  const transferParts=path.split("/");
  if(method==="POST" && transferParts.length===6 && transferParts[1]==="api" && transferParts[2]==="teams" && transferParts[3]==="transfer" && /^[a-f0-9]{32}$/.test(transferParts[4]) && ["accept","reject"].includes(transferParts[5])) {
    const user=await currentUser(request,env); if(!user) return response({error:"unauthorized"},401,origin,env);
    const transferId=transferParts[4], action=transferParts[5], status=action==="accept"?"accepted":"rejected", timestamp=new Date().toISOString();
    let transfer=await env.DB.prepare("SELECT lt.id,lt.to_user_id,lt.status,t.university_id AS transferUniversityId FROM leader_transfers lt JOIN teams t ON t.id=lt.team_id WHERE lt.id=?").bind(transferId).first();
    if(!transfer) return response({error:"transfer_not_found"},404,origin,env);
    if(transfer.to_user_id!==user.id) return response({error:"transfer_forbidden"},403,origin,env);
    if(transfer.transferUniversityId!==user.university_id) return response({error:"transfer_school_mismatch"},409,origin,env);
    await expirePendingTransfers(env.DB);
    transfer=await env.DB.prepare("SELECT lt.id,lt.to_user_id,lt.status,t.university_id AS transferUniversityId FROM leader_transfers lt JOIN teams t ON t.id=lt.team_id WHERE lt.id=?").bind(transferId).first();
    if(!transfer) return response({error:"transfer_not_found"},404,origin,env);
    if(transfer.status==="expired") return response({error:"transfer_expired"},409,origin,env);
    if(transfer.status!=="pending") return response({error:"transfer_state_conflict"},409,origin,env);
    try {
      await env.DB.batch([
        env.DB.prepare("UPDATE leader_transfers SET status=?,responded_at=? WHERE id=? AND to_user_id=? AND status='pending' AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')")
          .bind(status,timestamp,transferId,user.id),
        env.DB.prepare(`INSERT OR IGNORE INTO audit_logs(id,actor_type,actor_id,action,target_type,target_id,metadata_json)
          SELECT ?, 'user', ?, ?, 'team', team_id, ? FROM leader_transfers
          WHERE id=? AND status=? AND responded_at=? AND to_user_id=?`)
          .bind("transfer-"+status+"-"+transferId,user.id,"team.transfer."+status,JSON.stringify({transferId}),transferId,status,timestamp,user.id)
      ]);
    } catch(e) {
      return response({error:"transfer_state_conflict"},409,origin,env);
    }
    const latest=await env.DB.prepare(`SELECT lt.status,lt.expires_at,lt.from_user_id,lt.to_user_id,t.leader_user_id
      FROM leader_transfers lt JOIN teams t ON t.id=lt.team_id WHERE lt.id=?`).bind(transferId).first();
    if(latest?.status==="expired" || (latest?.status==="pending" && latest.expires_at && Date.parse(latest.expires_at)<=Date.now())) {
      await expirePendingTransfers(env.DB);
      return response({error:"transfer_expired"},409,origin,env);
    }
    const completed=latest && latest.status===status && (status==="accepted"?latest.leader_user_id===user.id:latest.leader_user_id===latest.from_user_id);
    if(!completed) return response({error:"transfer_state_conflict"},409,origin,env);
    return response({ok:true,status,alreadyApplied:transfer.status===status},200,origin,env);
  }
  if(path==="/api/group-chat/status" && method==="GET") {
    const user=await currentUser(request,env);
    if(!user) return response({error:"unauthorized"},401,origin,env);
    if(!user.consent_given||!user.consent_at||user.consent_version!==PRIVACY_NOTICE_VERSION||
       !user.account_consent_at||user.account_consent_version!==PRIVACY_NOTICE_VERSION) {
      return response({error:"consent_required"},403,origin,env);
    }
    if(!env.GROUP_QR) return response({error:"group_qr_storage_not_configured"},503,origin,env);
    try {
      const context=await getGroupChatContext(env.DB,user.id);
      const asset=await env.GROUP_QR.head(groupChatQrObjectKey(context.region.key));
      const metadata=groupChatAssetMetadata(asset);
      const confirmation=await env.DB.prepare(`SELECT university_id_snapshot,qr_uploaded_at_snapshot,confirmed_at
        FROM group_chat_confirmations WHERE user_id=? AND region_key=?`).bind(user.id,context.region.key).first();
      const confirmed=!!(metadata&&confirmation?.confirmed_at&&confirmation.qr_uploaded_at_snapshot===metadata.uploadedAt);
      return response({
        regionKey:context.region.key,regionLabel:context.region.label,university:context.university,
        mappingRule:"按高校校本部所在省份归组，不按本人就读的异地校区归组。",
        hmtRule:"港澳台高校统一使用港澳台群聊二维码。",
        overseasRule:"海外高校统一使用海外群聊二维码。",
        configured:!!metadata,asset:metadata,
        confirmed,confirmedAt:confirmation?.confirmed_at||null,
        needsReconfirm:!!(confirmation?.confirmed_at&&!confirmed)
      },200,origin,env);
    } catch(error) {
      if(error?.status) return response({error:error.error},error.status,origin,env);
      console.error("Group chat status failed",error?.message||"unknown");
      return response({error:"group_chat_status_failed"},500,origin,env);
    }
  }
  if(path==="/api/group-chat/qr-image" && method==="GET") {
    const user=await currentUser(request,env);
    if(!user) return response({error:"unauthorized"},401,origin,env);
    if(!user.consent_given||!user.consent_at||user.consent_version!==PRIVACY_NOTICE_VERSION||
       !user.account_consent_at||user.account_consent_version!==PRIVACY_NOTICE_VERSION) {
      return response({error:"consent_required"},403,origin,env);
    }
    if(!env.GROUP_QR) return response({error:"group_qr_storage_not_configured"},503,origin,env);
    try {
      const context=await getGroupChatContext(env.DB,user.id);
      const asset=await env.GROUP_QR.get(groupChatQrObjectKey(context.region.key));
      if(!asset) return response({error:"group_qr_not_configured"},404,origin,env);
      return new Response(asset.body,{status:200,headers:{
        ...corsHeaders(origin,env),
        "content-type":asset.httpMetadata?.contentType||"application/octet-stream",
        "cache-control":"private, no-store",
        "x-content-type-options":"nosniff",
        "content-disposition":"inline"
      }});
    } catch(error) {
      if(error?.status) return response({error:error.error},error.status,origin,env);
      console.error("Group chat QR read failed",error?.message||"unknown");
      return response({error:"group_qr_read_failed"},500,origin,env);
    }
  }
  if(path==="/api/group-chat/confirm" && method==="POST") {
    const user=await currentUser(request,env);
    if(!user) return response({error:"unauthorized"},401,origin,env);
    if(!user.consent_given||!user.consent_at||user.consent_version!==PRIVACY_NOTICE_VERSION||
       !user.account_consent_at||user.account_consent_version!==PRIVACY_NOTICE_VERSION) {
      return response({error:"consent_required"},403,origin,env);
    }
    if(!env.GROUP_QR) return response({error:"group_qr_storage_not_configured"},503,origin,env);
    try {
      const context=await getGroupChatContext(env.DB,user.id);
      const asset=await env.GROUP_QR.head(groupChatQrObjectKey(context.region.key));
      const metadata=groupChatAssetMetadata(asset);
      if(!metadata) return response({error:"group_qr_not_configured"},409,origin,env);
      const confirmedAt=new Date().toISOString();
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO group_chat_confirmations(user_id,region_key,university_id_snapshot,qr_uploaded_at_snapshot,confirmed_at)
          VALUES(?,?,?,?,?)
          ON CONFLICT(user_id,region_key) DO UPDATE SET
            university_id_snapshot=excluded.university_id_snapshot,
            qr_uploaded_at_snapshot=excluded.qr_uploaded_at_snapshot,
            confirmed_at=excluded.confirmed_at`)
          .bind(user.id,context.region.key,context.university_id,metadata.uploadedAt,confirmedAt),
        env.DB.prepare("INSERT INTO audit_logs(id,actor_type,actor_id,action,target_type,target_id,metadata_json) VALUES(?,'user',?,'student.group_chat.confirmed','group_chat',?,?)")
          .bind(randomHex(16),user.id,context.region.key,JSON.stringify({regionLabel:context.region.label,universityId:context.university_id,qrUploadedAt:metadata.uploadedAt}))
      ]);
      return response({ok:true,confirmed:true,regionKey:context.region.key,regionLabel:context.region.label,confirmedAt},200,origin,env);
    } catch(error) {
      if(error?.status) return response({error:error.error},error.status,origin,env);
      console.error("Group chat confirmation failed",error?.message||"unknown");
      return response({error:"group_chat_confirmation_failed"},500,origin,env);
    }
  }

  if(path==="/api/directory" && method==="GET") {
    const user=await currentUser(request,env); if(!user) return response({error:"unauthorized"},401,origin,env);
    if(!user.consent_given||!user.consent_at||user.consent_version!==PRIVACY_NOTICE_VERSION||
       !user.account_consent_at||user.account_consent_version!==PRIVACY_NOTICE_VERSION) {
      return response({error:"consent_required"},403,origin,env);
    }
    const own=await env.DB.prepare("SELECT university_id,province FROM users WHERE id=?").bind(user.id).first();
    const members=own?.university_id?await env.DB.prepare("SELECT u.id,u.name,u.high_school AS highSchool,u.grade,u.province,u.major_discipline_code AS majorDisciplineCode,u.campus_name AS campusName,u.campus_tag AS campusTag,uni.canonical_name AS university,uni.category AS universityCategory,CASE WHEN u.consent_given=1 AND u.consent_at<>'' AND u.consent_version=? AND u.account_consent_at<>'' AND u.account_consent_version=? THEN u.phone ELSE NULL END AS phone,CASE WHEN u.consent_given=1 AND u.consent_at<>'' AND u.consent_version=? AND u.account_consent_at<>'' AND u.account_consent_version=? THEN u.secondary_phone ELSE NULL END AS secondaryPhone,CASE WHEN u.consent_given=1 AND u.consent_at<>'' AND u.consent_version=? AND u.account_consent_at<>'' AND u.account_consent_version=? THEN u.wechat_id ELSE NULL END AS wechatId FROM users u JOIN universities uni ON uni.id=u.university_id WHERE u.university_id=? AND u.id<>? AND u.deleted_at='' ORDER BY u.created_at")
      .bind(PRIVACY_NOTICE_VERSION,PRIVACY_NOTICE_VERSION,PRIVACY_NOTICE_VERSION,PRIVACY_NOTICE_VERSION,PRIVACY_NOTICE_VERSION,PRIVACY_NOTICE_VERSION,own.university_id,user.id).all():{results:[]};
    const team=own?.university_id?await env.DB.prepare("SELECT t.id,t.leader_user_id AS leaderUserId,leader.name AS leaderName,leader.grade AS leaderGrade,COUNT(member.id) AS memberCount,uni.canonical_name AS university FROM teams t JOIN universities uni ON uni.id=t.university_id LEFT JOIN users leader ON leader.id=t.leader_user_id AND leader.deleted_at='' LEFT JOIN users member ON member.university_id=t.university_id AND member.deleted_at='' WHERE t.university_id=? GROUP BY t.id").bind(own.university_id).first():null;
    const leaders=await env.DB.prepare("SELECT u.name,u.grade,u.province,uni.canonical_name AS university,uni.category AS universityCategory,uni.region_name AS universityRegion,uni.education_level AS educationLevel,uni.project_tags_json AS projectTags FROM teams t JOIN users u ON u.id=t.leader_user_id JOIN universities uni ON uni.id=t.university_id WHERE u.province=? AND u.deleted_at='' ORDER BY uni.canonical_name").bind(own?.province||"").all();
    return response({members:members.results||[],team:team?{...team,isLeader:team.leaderUserId===user.id}:null,currentUserId:user.id,provinceLeaders:leaders.results||[]},200,origin,env);
  }

  if (path === "/api/admin/universities/import/status" && method === "GET") {
    if (env.UNIVERSITY_CATALOG_IMPORT_ENABLED !== "true") {
      return response({error:"catalog_import_disabled"},503,origin,env);
    }
    const admin = await currentAdmin(request,env);
    if (!admin) return response({error:"unauthorized"},401,origin,env);
    if (admin.role !== "owner" || !hasAdminPermission(admin,"universities:import")) {
      return response({error:"forbidden"},403,origin,env);
    }
    const datasetVersion = url.searchParams.get("datasetVersion") || "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datasetVersion)) {
      return response({error:"catalog_import_version_invalid"},400,origin,env);
    }
    try {
      const batch = await env.DB.prepare(
        "SELECT dataset_version,checksum_sha256,manifest_sha256,imported_at,record_count," +
        "inserted_count,updated_count,linked_existing_count,skipped_count,status " +
        "FROM university_catalog_imports WHERE dataset_version=?"
      ).bind(datasetVersion).first();
      if (!batch) return response({error:"catalog_import_not_found"},404,origin,env);
      const staged = await env.DB.prepare(
        "SELECT COUNT(*) AS staged_count FROM university_catalog_import_staging WHERE dataset_version=?"
      ).bind(datasetVersion).first();
      const recordCount = Number(batch.record_count || 0);
      const stagedCount = Number(staged?.staged_count || 0);
      const stagingComplete = batch.status === "applied"
        ? stagedCount === 0
        : batch.status === "validated" && recordCount > 0 && stagedCount === recordCount;
      return response({
        import: {
          datasetVersion: batch.dataset_version,
          checksumSha256: batch.checksum_sha256,
          manifestSha256: batch.manifest_sha256 || null,
          importedAt: batch.imported_at,
          recordCount,
          insertedCount: Number(batch.inserted_count || 0),
          updatedCount: Number(batch.updated_count || 0),
          linkedExistingCount: Number(batch.linked_existing_count || 0),
          skippedCount: Number(batch.skipped_count || 0),
          status: batch.status,
          stagedCount,
          stagingComplete
        }
      },200,origin,env);
    } catch (error) {
      console.error("University catalog import status failed",error?.message || "unknown");
      return response({error:"catalog_import_status_failed"},500,origin,env);
    }
  }

  if ((path === "/api/admin/universities/import/stage" ||
       path === "/api/admin/universities/import/finalize") && method === "POST") {
    if (origin !== env.APP_ORIGIN) return response({error:"origin_forbidden"},403,origin,env);
    if (env.UNIVERSITY_CATALOG_IMPORT_ENABLED !== "true") {
      return response({error:"catalog_import_disabled"},503,origin,env);
    }
    const admin = await currentAdmin(request,env);
    if (!admin) return response({error:"unauthorized"},401,origin,env);
    if (admin.role !== "owner" || !hasAdminPermission(admin,"universities:import")) {
      return response({error:"forbidden"},403,origin,env);
    }

    try {
      if (path.endsWith("/stage")) {
        const data = await limitedJsonBody(request,8*1024*1024);
        if (!data || typeof data !== "object" || Array.isArray(data) ||
            Object.keys(data).some(key => key !== "manifest") ||
            !data.manifest || typeof data.manifest !== "object") {
          return response({error:"invalid_import_request"},400,origin,env);
        }
        if (!Number.isInteger(data.manifest.record_count) || data.manifest.record_count > 5000) {
          return response({error:"catalog_import_record_limit"},413,origin,env);
        }
        const checked = await revalidateCatalogImportTargets(env.DB,data.manifest);
        if (checked.already_applied) {
          return response({ok:true,alreadyApplied:true,stagedCount:0},200,origin,env);
        }
        await writeAudit(env.DB,"admin",admin.id,"admin.university_catalog.stage_requested",
          "university_catalog_import",data.manifest.dataset_version,{
            datasetVersion:data.manifest.dataset_version,
            checksumSha256:data.manifest.checksum_sha256,
            manifestSha256:data.manifest.manifest_sha256,
            recordCount:data.manifest.record_count
          });
        const staged = await stageCatalogImport(env.DB,data.manifest);
        return response({
          ok:true,
          datasetVersion:data.manifest.dataset_version,
          manifestSha256:data.manifest.manifest_sha256,
          stagedCount:staged.staged_count,
          alreadyApplied:staged.already_applied===true
        },202,origin,env);
      }

      const data = await limitedJsonBody(request,4096);
      if (!data || typeof data !== "object" || Array.isArray(data) ||
          Object.keys(data).some(key => !["datasetVersion","manifestSha256","confirmManifestSha256"].includes(key)) ||
          typeof data.datasetVersion !== "string" ||
          typeof data.manifestSha256 !== "string" ||
          data.confirmManifestSha256 !== data.manifestSha256) {
        return response({error:"explicit_manifest_confirmation_required"},400,origin,env);
      }
      const loaded = await loadStagedCatalogImportManifest(env.DB,data.datasetVersion,data.manifestSha256);
      if (loaded.already_applied) {
        return response({ok:true,alreadyApplied:true,datasetVersion:data.datasetVersion},200,origin,env);
      }
      const checked = await revalidateCatalogImportTargets(env.DB,loaded.manifest);
      if (checked.already_applied) {
        return response({ok:true,alreadyApplied:true,datasetVersion:data.datasetVersion},200,origin,env);
      }
      const result = await finalizeCatalogImport(env.DB,loaded.manifest,admin.id);
      return response({ok:true,...result},200,origin,env);
    } catch (error) {
      if (error?.error) return response({error:error.error},error.status||400,origin,env);
      const code = String(error?.message || "catalog_import_failed");
      const conflict = /target_changed|target_unmatched|target_already_linked|batch_mismatch|version_conflict|not_resumable|not_finalizable|staging_incomplete|replay_conflict|manifest_immutable|manifest_mismatch|live_identity/i.test(code);
      const invalid = /invalid|checksum|verified|evidence|source_|undergraduate|required|normalized_identity|merge_target|manifest_|plan_|record_/i.test(code);
      console.error("University catalog import request failed",code);
      return response({error:conflict?"catalog_import_conflict":invalid?"catalog_import_invalid":"catalog_import_failed"},
        conflict?409:invalid?400:500,origin,env);
    }
  }

  if (path === "/api/admin/login" && method === "POST") {
    if (origin !== env.APP_ORIGIN) return response({error:"origin_forbidden"},403,origin,env);
    try {
      const d = await body(request);
      const username = String(d.username || "").trim();
      const password = String(d.password || "");
      if (!/^[A-Za-z0-9._-]{3,40}$/.test(username) || password.length < 1 || password.length > 128) {
        return response({error:"invalid_credentials"},401,origin,env);
      }
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const ipKey = await rateLimitKey(env,"admin:login:ip",ip);
      const usernameKey = await rateLimitKey(env,"admin:login:user",username.toLowerCase());
      const ipAllowed = await rateLimit(env.DB, ipKey, 20, 900);
      const usernameAllowed = await rateLimit(env.DB, usernameKey, 10, 900);
      if (!ipAllowed || !usernameAllowed) return response({error:"rate_limited"},429,origin,env);
      const account = await env.DB.prepare("SELECT id,username,password_hash,role,active FROM admin_users WHERE username=? COLLATE NOCASE")
        .bind(username).first();
      const passwordMatches = await verifyPassword(password, account?.password_hash);
      const supportedRole = ["owner","admin"].includes(account?.role);
      if (!account || Number(account.active) !== 1 || !passwordMatches || !supportedRole) {
        // Record credential rejection without storing the submitted username, IP,
        // password, or any other caller-controlled identifier in the audit trail.
        // Rate-limited requests are intentionally not logged here to avoid audit flooding.
        const reason = !account ? "unknown_account" : Number(account.active) !== 1 ? "inactive_account" : !supportedRole ? "unsupported_role" : "password_mismatch";
        try {
          await writeAudit(env.DB,"system",null,"admin.login.failed","admin_authentication",null,{reason});
        } catch {
          // Failed authentication remains a generic 401 even if audit storage is unavailable.
          console.error("Admin login failure audit write failed");
        }
        return response({error:"invalid_credentials"},401,origin,env);
      }
      const token = randomHex(32);
      const digest = await sha256(token);
      const created = now();
      const expires = created + ADMIN_SESSION_SECONDS;
      await env.DB.batch([
        env.DB.prepare("INSERT INTO admin_sessions(token_hash,admin_user_id,expires_at,created_at) VALUES(?,?,?,?)")
          .bind(digest,account.id,expires,created),
        env.DB.prepare("UPDATE admin_users SET last_login_at=?,updated_at=? WHERE id=? AND active=1")
          .bind(new Date().toISOString(),new Date().toISOString(),account.id),
        env.DB.prepare("INSERT INTO audit_logs(id,actor_type,actor_id,action,target_type,target_id,metadata_json) VALUES(?,?,?,?,?,?,?)")
          .bind(randomHex(16),"admin",account.id,"admin.login.succeeded","admin_user",account.id,JSON.stringify({role:account.role}))
      ]);
      return response({ok:true,admin:{id:account.id,username:account.username,role:account.role,permissions:ADMIN_PERMISSIONS[account.role]||[]}},
        200,origin,env,{"set-cookie":adminCookie(token,expires-created)});
    } catch (e) {
      if (e?.error) return response({error:e.error},e.status||500,origin,env);
      console.error("Admin login failed",e?.message||"unknown");
      return response({error:"admin_login_failed"},500,origin,env);
    }
  }
  if (path === "/api/admin/logout" && method === "POST") {
    const token = getNamedCookie(request, ADMIN_COOKIE);
    const admin = await currentAdmin(request,env);
    if (token) {
      const digest = await sha256(token);
      await env.DB.prepare("DELETE FROM admin_sessions WHERE token_hash=?").bind(digest).run();
      if (admin) await writeAudit(env.DB,"admin",admin.id,"admin.logout","admin_user",admin.id);
    }
    return response({ok:true},200,origin,env,{"set-cookie":adminCookie("",0)});
  }
  if (path === "/api/admin/me" && method === "GET") {
    const admin = await currentAdmin(request,env);
    if (!admin) return response({error:"unauthorized"},401,origin,env);
    return response({admin:{id:admin.id,username:admin.username,role:admin.role,permissions:ADMIN_PERMISSIONS[admin.role]||[]}},200,origin,env);
  }
  if(path==="/api/admin/donations" && (method==="GET"||method==="POST")) {
    const admin=await currentAdmin(request,env);
    if(!admin)return response({error:"unauthorized"},401,origin,env);
    if(!hasAdminPermission(admin,"donations:manage"))return response({error:"forbidden"},403,origin,env);
    if(method==="GET") {
      try {
        const rows=await env.DB.prepare("SELECT id,nickname,amount_cents AS amountCents,display_order AS displayOrder,created_at AS createdAt,updated_at AS updatedAt FROM donation_records ORDER BY display_order ASC,created_at ASC,id ASC LIMIT 300").all();
        return response({items:(rows.results||[]).map(item=>({
          id:item.id,nickname:item.nickname,amountCents:Number(item.amountCents)||0,
          displayOrder:Number(item.displayOrder)||0,createdAt:item.createdAt,updatedAt:item.updatedAt
        }))},200,origin,env);
      } catch(error) {
        console.error("Admin donation list failed",error?.message||"unknown");
        return response({error:"donation_list_unavailable"},500,origin,env);
      }
    }
    try {
      const data=await limitedJsonBody(request,4096),checked=validateDonationPayload(data);
      if(checked.error)return response({error:checked.error},400,origin,env);
      const id=randomHex(16),timestamp=new Date().toISOString();
      await env.DB.prepare("INSERT INTO donation_records(id,nickname,amount_cents,display_order,created_at,updated_at) VALUES(?,?,?,?,?,?)")
        .bind(id,checked.nickname,checked.amountCents,checked.displayOrder,timestamp,timestamp).run();
      await writeAudit(env.DB,"admin",admin.id,"admin.donation.created","donation",id,{amountCents:checked.amountCents,displayOrder:checked.displayOrder});
      return response({ok:true,id,nickname:checked.nickname,amountCents:checked.amountCents,displayOrder:checked.displayOrder},201,origin,env);
    } catch(error) {
      if(error?.error)return response({error:error.error},error.status||400,origin,env);
      console.error("Admin donation create failed",error?.message||"unknown");
      return response({error:"donation_save_failed"},500,origin,env);
    }
  }
  const donationRecordMatch=path.match(/^\/api\/admin\/donations\/([a-f0-9]{32})$/);
  if(donationRecordMatch&&(method==="PUT"||method==="DELETE")) {
    const admin=await currentAdmin(request,env);
    if(!admin)return response({error:"unauthorized"},401,origin,env);
    if(!hasAdminPermission(admin,"donations:manage"))return response({error:"forbidden"},403,origin,env);
    const id=donationRecordMatch[1];
    if(method==="PUT") {
      try {
        const data=await limitedJsonBody(request,4096),checked=validateDonationPayload(data);
        if(checked.error)return response({error:checked.error},400,origin,env);
        const timestamp=new Date().toISOString();
        const result=await env.DB.prepare("UPDATE donation_records SET nickname=?,amount_cents=?,display_order=?,updated_at=? WHERE id=?")
          .bind(checked.nickname,checked.amountCents,checked.displayOrder,timestamp,id).run();
        if((result.meta?.changes||0)!==1)return response({error:"donation_not_found"},404,origin,env);
        await writeAudit(env.DB,"admin",admin.id,"admin.donation.updated","donation",id,{amountCents:checked.amountCents,displayOrder:checked.displayOrder});
        return response({ok:true,id,nickname:checked.nickname,amountCents:checked.amountCents,displayOrder:checked.displayOrder},200,origin,env);
      } catch(error) {
        if(error?.error)return response({error:error.error},error.status||400,origin,env);
        console.error("Admin donation update failed",error?.message||"unknown");
        return response({error:"donation_save_failed"},500,origin,env);
      }
    }
    try {
      const result=await env.DB.prepare("DELETE FROM donation_records WHERE id=?").bind(id).run();
      if((result.meta?.changes||0)!==1)return response({error:"donation_not_found"},404,origin,env);
      await writeAudit(env.DB,"admin",admin.id,"admin.donation.deleted","donation",id);
      return response({ok:true,deleted:true,id},200,origin,env);
    } catch(error) {
      console.error("Admin donation delete failed",error?.message||"unknown");
      return response({error:"donation_delete_failed"},500,origin,env);
    }
  }

  if(path==="/api/admin/group-chat/qr" && method==="GET") {
    const admin=await currentAdmin(request,env);
    if(!admin) return response({error:"unauthorized"},401,origin,env);
    if(!hasAdminPermission(admin,"group-chat:manage")) return response({error:"forbidden"},403,origin,env);
    if(!env.GROUP_QR) return response({error:"group_qr_storage_not_configured"},503,origin,env);
    try {
      const regions=await Promise.all(GROUP_CHAT_REGIONS.map(async region=>{
        const object=await env.GROUP_QR.head(groupChatQrObjectKey(region.key));
        return {...region,configured:!!object,asset:groupChatAssetMetadata(object)};
      }));
      return response({regions},200,origin,env);
    } catch(error) {
      console.error("Admin group QR list failed",error?.message||"unknown");
      return response({error:"group_qr_list_failed"},500,origin,env);
    }
  }
  const groupQrUploadMatch=path.match(/^\/api\/admin\/group-chat\/qr\/([a-z0-9-]+)$/);
  if(groupQrUploadMatch && method==="PUT") {
    const admin=await currentAdmin(request,env);
    if(!admin) return response({error:"unauthorized"},401,origin,env);
    if(!hasAdminPermission(admin,"group-chat:manage")) return response({error:"forbidden"},403,origin,env);
    if(!env.GROUP_QR) return response({error:"group_qr_storage_not_configured"},503,origin,env);
    const region=GROUP_CHAT_REGION_BY_KEY.get(groupQrUploadMatch[1]);
    if(!region) return response({error:"group_qr_region_invalid"},400,origin,env);
    const declaredLength=Number(request.headers.get("content-length")||0);
    if(declaredLength>5*1024*1024) return response({error:"group_qr_file_too_large"},413,origin,env);
    let bytes;
    try { bytes=await request.arrayBuffer(); } catch { return response({error:"group_qr_file_invalid"},400,origin,env); }
    if(bytes.byteLength===0) return response({error:"group_qr_file_empty"},400,origin,env);
    if(bytes.byteLength>5*1024*1024) return response({error:"group_qr_file_too_large"},413,origin,env);
    const detected=detectGroupChatImageType(bytes);
    const declaredType=String(request.headers.get("content-type")||"").split(";")[0].trim().toLowerCase();
    if(!detected||detected!==declaredType) return response({error:"group_qr_image_type_invalid"},415,origin,env);
    const fileName=String(url.searchParams.get("fileName")||"group-chat-qr")
      .replace(/[\\/\u0000-\u001f]/g,"_").slice(0,120);
    const uploadedAt=new Date().toISOString();
    const objectKey=groupChatQrObjectKey(region.key);
    try {
      await env.GROUP_QR.put(objectKey,bytes,{
        httpMetadata:{contentType:detected,cacheControl:"private, no-store"},
        customMetadata:{regionKey:region.key,regionLabel:region.label,fileName,uploadedAt,uploadedBy:admin.username}
      });
      await writeAudit(env.DB,"admin",admin.id,"admin.group_chat_qr.uploaded","group_chat",region.key,{regionLabel:region.label,fileName,sizeBytes:bytes.byteLength,contentType:detected});
      return response({ok:true,regionKey:region.key,regionLabel:region.label,configured:true,asset:{fileName,contentType:detected,sizeBytes:bytes.byteLength,uploadedAt,uploadedBy:admin.username}},200,origin,env);
    } catch(error) {
      console.error("Admin group QR upload failed",error?.message||"unknown");
      return response({error:"group_qr_upload_failed"},500,origin,env);
    }
  }
  if(groupQrUploadMatch && method==="DELETE") {
    const admin=await currentAdmin(request,env);
    if(!admin) return response({error:"unauthorized"},401,origin,env);
    if(!hasAdminPermission(admin,"group-chat:manage")) return response({error:"forbidden"},403,origin,env);
    if(!env.GROUP_QR) return response({error:"group_qr_storage_not_configured"},503,origin,env);
    const region=GROUP_CHAT_REGION_BY_KEY.get(groupQrUploadMatch[1]);
    if(!region) return response({error:"group_qr_region_invalid"},400,origin,env);
    try {
      await env.GROUP_QR.delete(groupChatQrObjectKey(region.key));
      await writeAudit(env.DB,"admin",admin.id,"admin.group_chat_qr.deleted","group_chat",region.key,{regionLabel:region.label});
      return response({ok:true,deleted:true,regionKey:region.key},200,origin,env);
    } catch(error) {
      console.error("Admin group QR delete failed",error?.message||"unknown");
      return response({error:"group_qr_delete_failed"},500,origin,env);
    }
  }
  if(path==="/api/admin/group-chat/confirmations" && method==="GET") {
    const admin=await currentAdmin(request,env);
    if(!admin) return response({error:"unauthorized"},401,origin,env);
    if(!hasAdminPermission(admin,"group-chat:manage")) return response({error:"forbidden"},403,origin,env);
    const regionKey=url.searchParams.get("regionKey")||"";
    const region=GROUP_CHAT_REGION_BY_KEY.get(regionKey);
    if(!region) return response({error:"group_qr_region_invalid"},400,origin,env);
    if(!env.GROUP_QR) return response({error:"group_qr_storage_not_configured"},503,origin,env);
    try {
      const object=await env.GROUP_QR.head(groupChatQrObjectKey(region.key));
      const asset=groupChatAssetMetadata(object);
      const rows=await env.DB.prepare(`SELECT u.id,u.name,u.grade,u.campus_name AS campusName,
        uni.canonical_name AS university,uni.category AS category,
        COALESCE(NULLIF(uni.province_name_zh,''),NULLIF(profile_catalog.province_name,'')) AS mainProvince,
        uni.region_name AS legacyRegion,u.province AS userProvince,
        gc.confirmed_at AS confirmedAt,gc.qr_uploaded_at_snapshot AS qrUploadedAtSnapshot
        FROM users u
        JOIN universities uni ON uni.id=u.university_id
        LEFT JOIN profile_university_catalog profile_catalog ON profile_catalog.university_id=uni.id
        LEFT JOIN group_chat_confirmations gc ON gc.user_id=u.id AND gc.region_key=?
        WHERE u.deleted_at='' ORDER BY uni.canonical_name,u.created_at`).bind(region.key).all();
      const members=(rows.results||[]).filter(item=>
        resolveGroupChatRegion(item.category,[item.mainProvince,item.legacyRegion,item.userProvince])?.key===region.key
      ).map(item=>({
        id:item.id,name:item.name,grade:item.grade,campusName:item.campusName,university:item.university,
        confirmed:!!(asset&&item.confirmedAt&&item.qrUploadedAtSnapshot===asset.uploadedAt),
        hasPriorConfirmation:!!item.confirmedAt,confirmedAt:item.confirmedAt||null
      }));
      const confirmedCount=members.filter(item=>item.confirmed).length;
      return response({regionKey:region.key,regionLabel:region.label,configured:!!asset,total:members.length,confirmed:confirmedCount,pending:members.length-confirmedCount,members},200,origin,env);
    } catch(error) {
      console.error("Admin group confirmation list failed",error?.message||"unknown");
      return response({error:"group_chat_confirmations_failed"},500,origin,env);
    }
  }

  if (path === "/api/admin/overview" && method === "GET") {
    const admin = await currentAdmin(request,env);
    if (!admin) return response({error:"unauthorized"},401,origin,env);
    if (!hasAdminPermission(admin,"overview")) return response({error:"forbidden"},403,origin,env);
    const counts = await env.DB.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN university_id IS NOT NULL THEN 1 ELSE 0 END) AS completed, SUM(CASE WHEN consent_given=1 THEN 1 ELSE 0 END) AS consented FROM users WHERE deleted_at=''").first();
    const teamCount = await env.DB.prepare("SELECT COUNT(*) AS total FROM teams t WHERE EXISTS(SELECT 1 FROM users active_member WHERE active_member.university_id=t.university_id AND active_member.deleted_at='')").first();
    let teams = [];
    if (admin.role === "owner" || admin.role === "admin") {
      const rows = await env.DB.prepare(`SELECT t.id,uni.canonical_name AS university,COUNT(u.id) AS memberCount,
        leader.name AS leaderName,
        COALESCE(NULLIF(uni.province_name_zh,''),NULLIF(profile_catalog.province_name,''),NULLIF(uni.region_name,''),'') AS leaderProvince
        FROM teams t
        JOIN universities uni ON uni.id=t.university_id
        LEFT JOIN profile_university_catalog profile_catalog ON profile_catalog.university_id=uni.id
        LEFT JOIN users u ON u.university_id=t.university_id AND u.deleted_at=''
        LEFT JOIN users leader ON leader.id=t.leader_user_id AND leader.deleted_at=''
        GROUP BY t.id,uni.canonical_name,leader.name,uni.province_name_zh,profile_catalog.province_name,uni.region_name
        HAVING COUNT(u.id)>0 ORDER BY uni.canonical_name LIMIT 500`).all();
      teams = rows.results || [];
    }
    return response({counts:{total:Number(counts?.total||0),completed:Number(counts?.completed||0),consented:Number(counts?.consented||0)},teamCount:Number(teamCount?.total||0),teams},200,origin,env);
  }
  const adminPersonDeleteMatch = path.match(/^\/api\/admin\/people\/([a-f0-9]{32})$/);
  if (adminPersonDeleteMatch && method === "DELETE") {
    const admin = await currentAdmin(request,env);
    if (!admin) return response({error:"unauthorized"},401,origin,env);
    if (!hasAdminPermission(admin,"people:delete")) return response({error:"forbidden"},403,origin,env);
    const targetUserId = adminPersonDeleteMatch[1];
    try {
      const target = await env.DB.prepare("SELECT id,phone,university_id,name FROM users WHERE id=? AND deleted_at=''")
        .bind(targetUserId).first();
      if (!target) return response({error:"person_not_found"},404,origin,env);
      const leadership = await env.DB.prepare(`SELECT t.id,
        (SELECT COUNT(*) FROM users member
          WHERE member.university_id=t.university_id AND member.deleted_at='' AND member.id<>?) AS otherMembers
        FROM teams t WHERE t.leader_user_id=? LIMIT 1`)
        .bind(targetUserId,targetUserId).first();
      if (leadership && Number(leadership.otherMembers||0)>0) {
        return response({error:"team_leader_transfer_required"},409,origin,env);
      }
      const timestamp = new Date().toISOString();
      const auditId = randomHex(16);
      const statements = [
        env.DB.prepare("UPDATE leader_transfers SET status='expired',responded_at=? WHERE status='pending' AND (from_user_id=? OR to_user_id=?)")
          .bind(timestamp,targetUserId,targetUserId),
        env.DB.prepare(`UPDATE teams SET leader_user_id=NULL
          WHERE leader_user_id=?
            AND NOT EXISTS(SELECT 1 FROM users member
              WHERE member.university_id=teams.university_id AND member.deleted_at='' AND member.id<>?)`)
          .bind(targetUserId,targetUserId),
        env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(targetUserId),
        env.DB.prepare("DELETE FROM otp_challenges WHERE phone=?").bind(target.phone),
        env.DB.prepare(`UPDATE users SET
          phone='deleted:'||id,password_hash=NULL,name=NULL,high_school=NULL,class_name=NULL,
          university_id=NULL,grade=NULL,province=NULL,city=NULL,bio=NULL,greeting='',
          gender='undisclosed',major_group='',major_discipline_code='',admission_category_id='',
          admission_type_id='',campus_id='',campus_name='',campus_tag='',secondary_phone='',wechat_id='',
          profile_review_status='rejected',overseas_university_name='',profile_review_submitted_at='',
          profile_reviewed_at='',phone_visible_to_team=0,consent_at='',consent_given=0,
          consent_version='',account_consent_at='',account_consent_version='',
          auth_version=auth_version+1,deleted_at=?,updated_at=?
          WHERE id=? AND deleted_at=''`)
          .bind(timestamp,timestamp,targetUserId),
        env.DB.prepare("INSERT INTO audit_logs(id,actor_type,actor_id,action,target_type,target_id,metadata_json) VALUES(?,'admin',?,'admin.user.deleted','user',?,?)")
          .bind(auditId,admin.id,targetUserId,JSON.stringify({
            reason:"admin_roster_cleanup",
            transferHistoryPreserved:true,
            previousUniversityId:target.university_id||null
          })),
        env.DB.prepare("DELETE FROM group_chat_confirmations WHERE user_id=?").bind(targetUserId)
      ];
      const results = await env.DB.batch(statements);
      if (!results?.[4]?.meta || Number(results[4].meta.changes||0)!==1) {
        return response({error:"admin_delete_conflict"},409,origin,env);
      }
      return response({ok:true,deleted:true,transferHistoryPreserved:true},200,origin,env);
    } catch(error) {
      const reason=String(error?.message||"");
      if(reason.includes("leader_must_transfer_team_first")) return response({error:"team_leader_transfer_required"},409,origin,env);
      if(reason.includes("account_deletion_requires_no_pending_transfer")) return response({error:"admin_delete_conflict"},409,origin,env);
      console.error("Admin roster deletion failed",reason||"unknown");
      return response({error:"admin_person_delete_failed"},500,origin,env);
    }
  }
  if (path === "/api/admin/people" && method === "GET") {
    const admin = await currentAdmin(request,env);
    if (!admin) return response({error:"unauthorized"},401,origin,env);
    if (!hasAdminPermission(admin,"people:read")) return response({error:"forbidden"},403,origin,env);
    const filters = adminPeopleFilters(url);
    if (filters.error) return response({error:filters.error},400,origin,env);
    const page = adminPage(url.searchParams.get("page"),1,1000000);
    const pageSize = adminPage(url.searchParams.get("pageSize"),50,100);
    const base = " FROM users u LEFT JOIN universities uni ON uni.id=u.university_id WHERE u.deleted_at=''" + filters.clause.replace(/^ WHERE /," AND ");
    const count = await env.DB.prepare("SELECT COUNT(*) AS total" + base).bind(...filters.bindings).first();
    const total = Number(count?.total||0);
    const format = url.searchParams.get("format") || "";
    const isExport = format === "csv" || format === "xlsx";
    if (isExport && !hasAdminPermission(admin,"people:export")) return response({error:"forbidden"},403,origin,env);
    if (isExport && total > 5000) return response({error:"export_limit_exceeded",maxRows:5000},413,origin,env);
    const select = "SELECT u.id,u.name,u.high_school AS highSchool,uni.canonical_name AS university,uni.category AS universityCategory,u.grade,u.province,u.city,u.gender,u.major_discipline_code AS majorDisciplineCode,major.label AS majorDiscipline,u.admission_category_id AS admissionCategoryId,admission.label AS admissionCategory,u.campus_name AS campusName,u.campus_tag AS campusTag,u.greeting,u.profile_review_status AS profileReviewStatus,u.overseas_university_name AS overseasUniversityName,u.consent_version AS consentVersion,u.account_consent_version AS accountConsentVersion,u.created_at AS createdAt,u.updated_at AS updatedAt,u.consent_given AS consentGiven,uni.province_name_zh AS universityMainProvince,uni.region_name AS universityLegacyRegion,profile_catalog.province_name AS profileCatalogProvince";
    const detailJoins = " FROM users u LEFT JOIN universities uni ON uni.id=u.university_id LEFT JOIN profile_university_catalog profile_catalog ON profile_catalog.university_id=uni.id LEFT JOIN profile_option_codes major ON major.option_type='major_discipline' AND major.code=u.major_discipline_code LEFT JOIN profile_option_codes admission ON admission.option_type='admission_category' AND admission.code=u.admission_category_id WHERE u.deleted_at=''" + filters.clause.replace(/^ WHERE /," AND ");
    const sql = select + detailJoins + " ORDER BY u.created_at DESC LIMIT ? OFFSET ?";
    const rows = await env.DB.prepare(sql).bind(...filters.bindings,isExport?5000:pageSize,isExport?0:(page-1)*pageSize).all();
    const items = await attachAdminGroupChatStatus(env,rows.results || []);
    const header = ["用户编号","姓名","高中学校","大学","高校类别","年级","省份","城市","群聊归属地区","入群确认状态","入群确认时间","资料同意状态","创建时间","更新时间"];
    const keys = ["id","name","highSchool","university","universityCategory","grade","province","city","groupChatRegionLabel","groupChatStatusLabel","groupChatConfirmedAt","consentGiven","createdAt","updatedAt"];
    if (format === "csv") {
      const lines = [header.map(csvCell).join(",")];
      for (const item of items) lines.push(keys.map(key => csvCell(key==="consentGiven"?(item[key]?"已同意":"未同意"):item[key])).join(","));
      await writeAudit(env.DB,"admin",admin.id,"admin.people.exported","user_collection",null,{format:"csv",rowCount:items.length,filterCount:filters.filterCount});
      return new Response(String.fromCharCode(65279) + lines.join(String.fromCharCode(13,10)),{status:200,headers:{...corsHeaders(origin,env),"content-type":"text/csv; charset=utf-8","content-disposition":'attachment; filename="zhuoyue-2026-roster.csv"',"cache-control":"no-store","x-content-type-options":"nosniff"}});
    }
    if (format === "xlsx") {
      const exportRows = items.map(item => keys.map(key => key === "consentGiven" ? (item[key] ? "已同意" : "未同意") : item[key]));
      const workbook = buildXlsxWorkbook(header,exportRows);
      await writeAudit(env.DB,"admin",admin.id,"admin.people.exported","user_collection",null,{format:"xlsx",rowCount:items.length,filterCount:filters.filterCount});
      return new Response(workbook,{status:200,headers:{...corsHeaders(origin,env),"content-type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","content-disposition":'attachment; filename="zhuoyue-2026-roster.xlsx"',"cache-control":"no-store","x-content-type-options":"nosniff"}});
    }
    await writeAudit(env.DB,"admin",admin.id,"admin.people.listed","user_collection",null,{page,pageSize,filterCount:filters.filterCount});
    return response({items,pagination:{page,pageSize,total,totalPages:Math.ceil(total/pageSize)}},200,origin,env);
  }
  if (path === "/api/admin/audit" && method === "GET") {
    const admin = await currentAdmin(request,env);
    if (!admin) return response({error:"unauthorized"},401,origin,env);
    if (!hasAdminPermission(admin,"audit:read")) return response({error:"forbidden"},403,origin,env);
    const page = adminPage(url.searchParams.get("page"),1,1000000);
    const pageSize = adminPage(url.searchParams.get("pageSize"),10,10);
    await writeAudit(env.DB,"admin",admin.id,"admin.audit.viewed","audit_collection",null,{page,pageSize});
    const count = await env.DB.prepare("SELECT COUNT(*) AS total FROM audit_logs").first();
    const rows = await env.DB.prepare("SELECT l.id,l.actor_type AS actorType,l.actor_id AS actorId,a.username AS actorUsername,l.action,l.target_type AS targetType,l.target_id AS targetId,l.metadata_json AS metadata,l.created_at AS createdAt FROM audit_logs l LEFT JOIN admin_users a ON l.actor_type='admin' AND a.id=l.actor_id ORDER BY l.created_at DESC LIMIT ? OFFSET ?")
      .bind(pageSize,(page-1)*pageSize).all();
    const total = Number(count?.total||0);
    return response({items:rows.results||[],pagination:{page,pageSize,total,totalPages:Math.ceil(total/pageSize)}},200,origin,env);
  }
  if(path==="/api/admin/universities/review/pending" && method==="GET") {
    const admin=await currentAdmin(request,env);
    if(!admin) return response({error:"unauthorized"},401,origin,env);
    if(!hasAdminPermission(admin,"universities:review")) return response({error:"forbidden"},403,origin,env);
    try {
      const rows=await env.DB.prepare(`SELECT u.id,u.name,u.high_school AS highSchool,u.grade,
        u.overseas_university_name AS submittedName,u.profile_review_submitted_at AS submittedAt,u.created_at AS createdAt
        FROM users u WHERE u.deleted_at='' AND u.profile_review_status='pending'
        ORDER BY u.profile_review_submitted_at ASC,u.created_at ASC LIMIT 300`).all();
      return response({items:rows.results||[]},200,origin,env);
    } catch(error) {
      console.error("Overseas university review queue failed",error?.message||"unknown");
      return response({error:"university_review_queue_failed"},500,origin,env);
    }
  }

  const universityReviewMatch=path.match(new RegExp("^/api/admin/universities/review/([a-f0-9]{32})/(approve|reject)$"));
  if(universityReviewMatch && method==="POST") {
    const admin=await currentAdmin(request,env);
    if(!admin) return response({error:"unauthorized"},401,origin,env);
    if(!hasAdminPermission(admin,"universities:review")) return response({error:"forbidden"},403,origin,env);
    const targetUserId=universityReviewMatch[1],action=universityReviewMatch[2];
    try {
      const d=await limitedJsonBody(request,4096);
      const pending=await env.DB.prepare("SELECT id,name,overseas_university_name,profile_review_status FROM users WHERE id=? AND deleted_at=''").bind(targetUserId).first();
      if(!pending) return response({error:"review_user_not_found"},404,origin,env);
      if(pending.profile_review_status!=="pending") return response({error:"review_state_conflict"},409,origin,env);
      const timestamp=new Date().toISOString();
      if(action==="reject") {
        const reason=String(d.reason||"").trim().slice(0,240);
        const updated=await env.DB.prepare("UPDATE users SET profile_review_status='rejected',profile_reviewed_at=?,updated_at=? WHERE id=? AND deleted_at='' AND profile_review_status='pending'")
          .bind(timestamp,timestamp,targetUserId).run();
        if((updated.meta?.changes||0)!==1) return response({error:"review_state_conflict"},409,origin,env);
        await writeAudit(env.DB,"admin",admin.id,"admin.overseas_university.rejected","user",targetUserId,{reason});
        return response({ok:true,status:"rejected"},200,origin,env);
      }

      const canonicalName=String(d.canonicalName||"").trim().replace(/\s+/g," ");
      if(canonicalName.length<2||canonicalName.length>160||/[\u0000-\u001f]/.test(canonicalName)) {
        return response({error:"review_canonical_name_required"},400,origin,env);
      }
      const normalized=value=>String(value||"").normalize("NFKC").replace(/[\s\p{P}\p{S}]+/gu,"").toLowerCase();
      const normalizedName=normalized(canonicalName);
      if(!normalizedName) return response({error:"review_canonical_name_required"},400,origin,env);

      // Canonicalize by reusing an existing overseas university with the same normalized name.
      // Otherwise create a reviewed free-text overseas university record.
      const candidates=await env.DB.prepare("SELECT id,canonical_name,normalized_name FROM universities WHERE category='overseas'").all();
      const matched=(candidates.results||[]).find(row=>normalized(row.canonical_name)===normalizedName);
      const universityId=matched?.id||randomHex(16);
      const operations=[];
      if(!matched) {
        const normalizedKey="overseas:"+normalizedName;
        operations.push(env.DB.prepare("INSERT INTO universities(id,canonical_name,normalized_name,category,region_name,education_level,project_tags_json,partner_name) VALUES(?,?,?,'overseas','海外','undergraduate','[]','')")
          .bind(universityId,canonicalName,normalizedKey));
      }
      operations.push(env.DB.prepare(`UPDATE users SET university_id=?,province='海外',city='',overseas_university_name=?,
        profile_review_status='approved',profile_reviewed_at=?,updated_at=?
        WHERE id=? AND deleted_at='' AND profile_review_status='pending' AND university_id IS NULL`)
        .bind(universityId,canonicalName,timestamp,timestamp,targetUserId));
      operations.push(env.DB.prepare("UPDATE teams SET leader_user_id=? WHERE university_id=? AND leader_user_id IS NULL AND (SELECT COUNT(*) FROM users WHERE university_id=? AND deleted_at='')=1 AND EXISTS(SELECT 1 FROM users WHERE id=? AND university_id=? AND deleted_at='')")
        .bind(targetUserId,universityId,universityId,targetUserId,universityId));
      operations.push(env.DB.prepare("INSERT OR IGNORE INTO teams(id,university_id,leader_user_id) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM users WHERE id=? AND university_id=? AND deleted_at='')")
        .bind(randomHex(16),universityId,targetUserId,targetUserId,universityId));
      const results=await env.DB.batch(operations);
      const userUpdateIndex=matched?0:1;
      if(!results?.[userUpdateIndex]?.meta||Number(results[userUpdateIndex].meta.changes||0)!==1) return response({error:"review_state_conflict"},409,origin,env);
      await writeAudit(env.DB,"admin",admin.id,"admin.overseas_university.approved","user",targetUserId,{
        universityId,canonicalName,mergedExisting:!!matched
      });
      return response({ok:true,status:"approved",universityId,canonicalName,mergedExisting:!!matched},200,origin,env);
    } catch(error) {
      if(error?.error) return response({error:error.error},error.status||400,origin,env);
      const conflict=String(error?.message||"").toLowerCase().includes("unique")||String(error?.message||"").toLowerCase().includes("constraint");
      console.error("Overseas university review action failed",error?.message||"unknown");
      return response({error:conflict?"review_state_conflict":"university_review_action_failed"},conflict?409:500,origin,env);
    }
  }

  if (path === "/api/admin/admins" && (method === "GET" || method === "POST")) {
    const admin = await currentAdmin(request,env);
    if (!admin) return response({error:"unauthorized"},401,origin,env);
    if (!hasAdminPermission(admin,"admins:manage")) return response({error:"forbidden"},403,origin,env);
    if (method === "GET") {
      const rows = await env.DB.prepare("SELECT id,username,role,active,created_at AS createdAt,updated_at AS updatedAt,last_login_at AS lastLoginAt FROM admin_users ORDER BY created_at").all();
      return response({items:rows.results||[]},200,origin,env);
    }
    try {
      const d = await body(request);
      const username = String(d.username||"").trim();
      const password = String(d.password||"");
      const role = String(d.role||"admin");
      if (!/^[A-Za-z0-9._-]{3,40}$/.test(username)) return response({error:"invalid_admin_username"},400,origin,env);
      if (password.length < 14 || password.length > 128) return response({error:"admin_password_too_weak"},400,origin,env);
      if (role !== "admin") return response({error:"invalid_admin_role"},400,origin,env);
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const derived = await derivePassword(password,salt);
      const hash = "pbkdf2-sha256$" + PBKDF2_ITERATIONS + "$" + b64(salt) + "$" + b64(derived);
      const id = randomHex(16);
      await env.DB.prepare("INSERT INTO admin_users(id,username,password_hash,role,active,created_by,updated_at) VALUES(?,?,?,?,1,?,?)")
        .bind(id,username,hash,role,admin.id,new Date().toISOString()).run();
      await writeAudit(env.DB,"admin",admin.id,"admin.account.created","admin_user",id,{role});
      return response({ok:true,id,username,role},201,origin,env);
    } catch (e) {
      const conflict = String(e?.message||"").toLowerCase().includes("unique");
      return response({error:conflict?"admin_username_exists":"admin_create_failed"},conflict?409:400,origin,env);
    }
  }
  if (path === "/api/admin/backups" && (method === "GET" || method === "POST")) {
    const admin = await currentAdmin(request,env);
    if (!admin) return response({error:"unauthorized"},401,origin,env);
    if (!hasAdminPermission(admin,"backups:manage")) return response({error:"forbidden"},403,origin,env);
    if (!env.D1_BACKUPS) return response({error:"backup_storage_not_configured"},503,origin,env);
    if (method === "POST") {
      if (!env.D1_BACKUP_WORKFLOW || !env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_API_TOKEN ||
          !env.D1_DATABASE_ID || !env.BACKUP_MASTER_KEY_V1) {
        return response({error:"backup_configuration_incomplete"},503,origin,env);
      }
      const backupId = randomHex(16);
      try {
        const instance = await env.D1_BACKUP_WORKFLOW.create({
          id: backupId,
          params: { backupId, source: "manual", requestedBy: admin.id }
        });
        await writeAudit(env.DB,"admin",admin.id,"admin.backup.started","d1_backup",backupId,{source:"manual"});
        return response({ok:true,backupId,workflowInstanceId:instance.id},202,origin,env);
      } catch (error) {
        console.error("Manual D1 backup could not be started",error?.message||"unknown");
        return response({error:"backup_start_failed"},503,origin,env);
      }
    }
    try {
      const page = await env.D1_BACKUPS.list({prefix:"d1-backups/v1/manifests/",limit:100});
      const items = [];
      let unreadable = 0;
      for (const objectInfo of page.objects || []) {
        const object = await env.D1_BACKUPS.get(objectInfo.key);
        if (!object) continue;
        try {
          const manifest = await object.json();
          if (!manifest || !/^[a-f0-9]{32}$/.test(manifest.backupId||"") ||
              objectInfo.key !== backupManifestKey(manifest.backupId) ||
              manifest.format !== "qd58-d1-backup" || manifest.schemaVersion !== 1) {
            unreadable++;
            continue;
          }
          const master = await getBackupMasterKey(env,manifest.keyVersion);
          if (!(await verifyBackupManifest(manifest,master))) {
            unreadable++;
            continue;
          }
          items.push({
            backupId:manifest.backupId,status:manifest.status,
            createdAt:manifest.createdAt||"",completedAt:manifest.completedAt||"",
            plaintextBytes:Number(manifest.plaintextBytes)||0,
            ciphertextBytes:Number(manifest.ciphertextBytes)||0,
            partCount:Number(manifest.partCount)||0,
            source:manifest.source||"unknown",
            verification:manifest.verification?.status||"not_checked",
            verifiedAt:manifest.verification?.checkedAt||"",
            errorCode:manifest.errorCode||manifest.verification?.errorCode||""
          });
        } catch {
          unreadable++;
        }
      }
      items.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
      return response({
        items,unreadable,truncated:page.truncated===true,
        workflowConfigured:!!env.D1_BACKUP_WORKFLOW,
        exportConfigured:!!env.CLOUDFLARE_ACCOUNT_ID&&!!env.CLOUDFLARE_API_TOKEN&&!!env.D1_DATABASE_ID,
        encryptionConfigured:typeof env.BACKUP_MASTER_KEY_V1==="string"&&env.BACKUP_MASTER_KEY_V1.length>=32
      },200,origin,env);
    } catch (error) {
      console.error("D1 backup list failed",error?.message||"unknown");
      return response({error:"backup_list_failed"},500,origin,env);
    }
  }
  const backupMatch = path.match(/^\/api\/admin\/backups\/([a-f0-9]{32})(?:\/(manifest|download|verify))?$/);
  if (backupMatch) {
    const admin = await currentAdmin(request,env);
    if (!admin) return response({error:"unauthorized"},401,origin,env);
    if (!hasAdminPermission(admin,"backups:manage")) return response({error:"forbidden"},403,origin,env);
    if (!env.D1_BACKUPS) return response({error:"backup_storage_not_configured"},503,origin,env);
    const backupId = backupMatch[1];
    const action = backupMatch[2] || "";
    try {
      const manifestObject = await env.D1_BACKUPS.get(backupManifestKey(backupId));
      if (!manifestObject) return response({error:"backup_not_found"},404,origin,env);
      const manifest = await manifestObject.json();
      if (manifest?.backupId !== backupId || manifest?.format !== "qd58-d1-backup" || manifest?.schemaVersion !== 1) {
        return response({error:"backup_manifest_invalid"},409,origin,env);
      }
      const master = await getBackupMasterKey(env,manifest.keyVersion);
      if (!(await verifyBackupManifest(manifest,master))) {
        return response({error:"backup_manifest_signature_invalid"},409,origin,env);
      }
      if (action === "manifest" && method === "GET") {
        return response({manifest},200,origin,env);
      }
      if (action === "download" && method === "GET") {
        if (manifest.status !== "completed") return response({error:"backup_not_ready"},409,origin,env);
        const stored = await env.D1_BACKUPS.get(manifest.objectKey);
        if (!stored?.body) return response({error:"backup_object_missing"},404,origin,env);
        const headers = {
          "content-type":"application/octet-stream",
          "content-disposition":'attachment; filename="qd58-d1-' + backupId + '.qd58enc"',
          "content-length":String(stored.size),
          "cache-control":"no-store",
          "x-content-type-options":"nosniff",
          ...corsHeaders(origin,env)
        };
        return new Response(stored.body,{status:200,headers});
      }
      if (action === "verify" && method === "POST") {
        if (manifest.status !== "completed") return response({error:"backup_not_ready"},409,origin,env);
        if (!env.D1_BACKUP_WORKFLOW) return response({error:"backup_workflow_not_configured"},503,origin,env);
        const instanceId = "verify-" + backupId + "-" + randomHex(8);
        const instance = await env.D1_BACKUP_WORKFLOW.create({
          id:instanceId,params:{action:"verify",backupId,requestedBy:admin.id}
        });
        await writeAudit(env.DB,"admin",admin.id,"admin.backup.verification_started","d1_backup",backupId,{});
        return response({ok:true,workflowInstanceId:instance.id},202,origin,env);
      }
      if (!action && method === "DELETE") {
        if (manifest.status === "running") return response({error:"backup_running"},409,origin,env);
        if (manifest.status === "completed") {
          const page = await env.D1_BACKUPS.list({prefix:"d1-backups/v1/manifests/",limit:100});
          let otherCompleted = 0;
          for (const item of page.objects || []) {
            if (item.key === backupManifestKey(backupId)) continue;
            const otherObject = await env.D1_BACKUPS.get(item.key);
            if (!otherObject) continue;
            try {
              const other = await otherObject.json();
              if (other?.status !== "completed" || other?.format !== "qd58-d1-backup") continue;
              const otherMaster = await getBackupMasterKey(env,other.keyVersion);
              if (await verifyBackupManifest(other,otherMaster)) otherCompleted++;
            } catch {}
          }
          if (!otherCompleted) return response({error:"backup_last_successful_protected"},409,origin,env);
        }
        if (manifest.objectKey) await env.D1_BACKUPS.delete(manifest.objectKey);
        await env.D1_BACKUPS.delete(backupManifestKey(backupId));
        await writeAudit(env.DB,"admin",admin.id,"admin.backup.deleted","d1_backup",backupId,{status:manifest.status});
        return response({ok:true,deleted:true,backupId},200,origin,env);
      }
      return response({error:"method_not_allowed"},405,origin,env);
    } catch (error) {
      console.error("D1 backup management action failed",error?.message||"unknown");
      return response({error:"backup_management_failed"},500,origin,env);
    }
  }
  const adminAccountMatch = path.match(/^\/api\/admin\/admins\/([a-f0-9]{32})$/);
  if (adminAccountMatch && method === "POST") {
    const admin = await currentAdmin(request,env);
    if (!admin) return response({error:"unauthorized"},401,origin,env);
    if (!hasAdminPermission(admin,"admins:manage")) return response({error:"forbidden"},403,origin,env);
    const targetId = adminAccountMatch[1];
    const target = await env.DB.prepare("SELECT id,role,active FROM admin_users WHERE id=?").bind(targetId).first();
    if (!target) return response({error:"admin_not_found"},404,origin,env);
    if (target.role === "owner") return response({error:"owner_account_protected"},403,origin,env);
    try {
      const d = await body(request);
      const role = d.role === undefined ? target.role : String(d.role);
      const active = d.active === undefined ? Number(target.active) : (d.active === true ? 1 : d.active === false ? 0 : -1);
      if (role !== "admin" || ![0,1].includes(active)) return response({error:"invalid_admin_update"},400,origin,env);
      if (targetId === admin.id && active === 0) return response({error:"cannot_disable_self"},400,origin,env);
      const result = await env.DB.prepare("UPDATE admin_users SET role=?,active=?,updated_at=? WHERE id=? AND role='admin'")
        .bind(role,active,new Date().toISOString(),targetId).run();
      if ((result.meta?.changes||0)!==1) return response({error:"admin_update_conflict"},409,origin,env);
      await writeAudit(env.DB,"admin",admin.id,"admin.account.updated","admin_user",targetId,{role,active});
      return response({ok:true,id:targetId,role,active:!!active},200,origin,env);
    } catch {
      return response({error:"admin_update_failed"},400,origin,env);
    }
  }

  if (adminAccountMatch && method === "DELETE") {
    const admin = await currentAdmin(request,env);
    if (!admin) return response({error:"unauthorized"},401,origin,env);
    if (!hasAdminPermission(admin,"admins:manage")) return response({error:"forbidden"},403,origin,env);
    const targetId = adminAccountMatch[1];
    const target = await env.DB.prepare("SELECT id,role FROM admin_users WHERE id=?").bind(targetId).first();
    if (!target) return response({error:"admin_not_found"},404,origin,env);
    if (target.role === "owner") return response({error:"owner_account_protected"},403,origin,env);
    if (targetId === admin.id) return response({error:"cannot_delete_self"},400,origin,env);
    if (!["admin","viewer"].includes(target.role)) return response({error:"admin_account_delete_conflict"},409,origin,env);
    try {
      // admin_sessions.admin_user_id has ON DELETE CASCADE; deleting this account
      // also revokes every session belonging to the deleted administrator.
      const result = await env.DB.prepare("DELETE FROM admin_users WHERE id=? AND role IN ('admin','viewer')").bind(targetId).run();
      if ((result.meta?.changes||0)!==1) return response({error:"admin_account_delete_conflict"},409,origin,env);
      await writeAudit(env.DB,"admin",admin.id,"admin.account.deleted","admin_user",targetId,{role:target.role});
      return response({ok:true,deleted:true,id:targetId},200,origin,env);
    } catch (error) {
      console.error("Admin account deletion failed",error?.message||"unknown");
      return response({error:"admin_account_delete_failed"},500,origin,env);
    }
  }

  return response({error:"not_found"},404,origin,env);
}
export default {
  fetch(request,env) {
    return route(request,env).catch(e=>{
      console.error("Worker unhandled error",e?.message||"unknown");
      return json({error:"internal_error"},500);
    });
  },
  scheduled(_controller,env,ctx) {
    ctx.waitUntil(Promise.all([
      expirePendingTransfers(env.DB).catch(error=>{
        console.error("Scheduled transfer expiry failed",error?.message||"unknown");
      }),
      cleanupExpiredSecurityData(env.DB).catch(error=>{
        console.error("Scheduled security-data cleanup failed",error?.message||"unknown");
      })
    ]));
  }
};

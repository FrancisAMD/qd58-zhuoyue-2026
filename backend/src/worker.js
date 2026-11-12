import { pbkdf2 } from "node:crypto";

const encoder = new TextEncoder();
export const PBKDF2_ITERATIONS = 100000;
const PBKDF2_KEY_BYTES = 32;
const COOKIE = "__Host-qd58_session";
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const OTP_SECONDS = 300;
const COOLDOWN_SECONDS = 60;
const ALI_HOST = "dypnsapi.aliyuncs.com";
const ALI_VERSION = "2017-05-25";

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
}
function corsHeaders(origin, env) {
  if (!origin || origin !== env.APP_ORIGIN) return {};
  return { "access-control-allow-origin": origin, "access-control-allow-credentials": "true", "access-control-allow-methods": "GET,POST,PUT,OPTIONS", "access-control-allow-headers": "Content-Type", "vary": "Origin" };
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
export function derivePassword(password, salt) {
  return new Promise((resolve, reject) => {
    pbkdf2(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEY_BYTES, "sha256", (error, derived) => {
      if (error) reject(error);
      else resolve(new Uint8Array(derived));
    });
  });
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
function err(message, status = 400) { return { error: message, status }; }
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
async function createSession(db, userId, env) {
  const token = randomHex(32);
  const digest = await sha256(token);
  const expires = now() + Number(env.SESSION_TTL_SECONDS || SESSION_SECONDS);
  await db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)").bind(digest,userId,expires,now()).run();
  return { token, maxAge: expires-now() };
}
async function currentUser(request, env) {
  const token = getCookie(request);
  if (!token) return null;
  const digest = await sha256(token);
  const row = await env.DB.prepare("SELECT u.id,u.phone,u.name,u.high_school,u.class_name,u.university_id,u.grade,u.province,u.city,u.bio,u.phone_visible_to_team FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?").bind(digest,now()).first();
  return row || null;
}
async function sendCode(phone, purpose, token, request, env) {
  if (!validPhone(phone)) throw err("invalid_phone");
  const exists = await env.DB.prepare("SELECT id FROM users WHERE phone=?").bind(phone).first();
  if (purpose === "register" && exists) throw err("phone_already_registered");
  if (purpose === "password_reset" && !exists) throw err("phone_not_registered");
  if (!(await turnstile(token, purpose, request, env))) throw err("turnstile_failed",403);
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (!(await rateLimit(env.DB, "sms:cooldown:" + phone, 1, Number(env.OTP_SEND_COOLDOWN_SECONDS || COOLDOWN_SECONDS)))) throw err("rate_limited",429);
  if (!(await rateLimit(env.DB, "sms:phone:" + phone, 5, 86400))) throw err("rate_limited",429);
  if (!(await rateLimit(env.DB, "sms:ip:" + ip, 20, 3600))) throw err("rate_limited",429);
  const outId = randomHex(16);
  const params = {
    CountryCode: "86", PhoneNumber: phone,
    SignName: env.ALIBABA_SIGN_NAME || "恒创联众",
    TemplateCode: env.ALIBABA_TEMPLATE_CODE || "100001",
    TemplateParam: JSON.stringify({ code: "##code##", min: "5" }),
    ValidTime: Number(env.OTP_TTL_SECONDS || OTP_SECONDS),
    DuplicatePolicy: 1, Interval: Number(env.OTP_SEND_COOLDOWN_SECONDS || COOLDOWN_SECONDS),
    CodeType: 1, CodeLength: 6, ReturnVerifyCode: false, AutoRetry: 1, OutId: outId
  };
  if (env.ALIBABA_SCHEME_NAME) params.SchemeName = env.ALIBABA_SCHEME_NAME;
  const sent = await aliyun("SendSmsVerifyCode", params, env);
  await env.DB.prepare("INSERT INTO otp_challenges(id,phone,code_hash,expires_at,attempts,consumed_at,created_at,purpose,out_id) VALUES(?,?,?, ?,0,NULL,?,?,?)")
    .bind(randomHex(16),phone,"ALIYUN",now()+Number(env.OTP_TTL_SECONDS || OTP_SECONDS),now(),purpose,outId).run();
  return { ok: true, requestId: sent.RequestId || null };
}
async function verifyCode(phone, code, purpose, env) {
  if (!validPhone(phone) || !/^\d{4,8}$/.test(String(code || ""))) throw err("invalid_code");
  const challenge = await env.DB.prepare("SELECT id,out_id,expires_at,consumed_at,attempts FROM otp_challenges WHERE phone=? AND purpose=? ORDER BY created_at DESC LIMIT 1").bind(phone,purpose).first();
  if (!challenge || challenge.consumed_at || challenge.expires_at < now() || challenge.attempts >= 5) throw err("invalid_code");
  const attempt = await env.DB.prepare("UPDATE otp_challenges SET attempts=attempts+1 WHERE id=? AND consumed_at IS NULL AND attempts<5").bind(challenge.id).run();
  if ((attempt.meta?.changes || 0) !== 1) throw err("invalid_code");
  const checked = await aliyun("CheckSmsVerifyCode", { CountryCode:"86", PhoneNumber:phone, VerifyCode:String(code), OutId:challenge.out_id, SchemeName:env.ALIBABA_SCHEME_NAME || undefined }, env);
  if (checked.Model?.VerifyResult !== "PASS") throw err("invalid_code");
  const consumed = await env.DB.prepare("UPDATE otp_challenges SET consumed_at=? WHERE id=? AND consumed_at IS NULL").bind(now(),challenge.id).run();
  if ((consumed.meta?.changes || 0) !== 1) throw err("invalid_code");
}
async function register(data, env) {
  const phone=String(data.phone||""), password=String(data.password||"");
  if (!validPhone(phone)) throw err("invalid_phone");
  if (password.length < 10 || password.length > 128) throw err("weak_password");
  const salt=crypto.getRandomValues(new Uint8Array(16));
  const derived=await derivePassword(password,salt);
  // Derive the password hash before consuming the one-time code.
  await verifyCode(phone,data.code,"register",env);
  const hash="pbkdf2-sha256$"+PBKDF2_ITERATIONS+"$"+b64(salt)+"$"+b64(derived);
  const id=randomHex(16);
  try { await env.DB.prepare("INSERT INTO users(id,phone,password_hash,consent_at) VALUES(?,?,?,?)").bind(id,phone,hash,new Date().toISOString()).run(); }
  catch { throw err("phone_already_registered",409); }
  return id;
}
async function verifyPassword(password, stored) {
  const [kind,iterations,salt,expected]=String(stored||"").split("$");
  if(kind!=="pbkdf2-sha256" || Number(iterations)!==PBKDF2_ITERATIONS || !salt || !expected) return false;
  const derived=await derivePassword(password,unb64(salt));
  const a=unb64(expected),b=derived;
  return a.length===b.length && a.every((v,i)=>v===b[i]);
}
async function route(request, env) {
  const url=new URL(request.url), path=url.pathname, method=request.method, origin=request.headers.get("Origin");
  if(method==="OPTIONS") return new Response(null,{status:204,headers:corsHeaders(origin,env)});
  if(origin && origin!==env.APP_ORIGIN) return response({error:"origin_forbidden"},403,origin,env);
  if(path==="/api/health" && method==="GET") return response({ok:true,service:"zhuoyue-2026-api",build:"pbkdf2-100k-20261112",passwordKdf:"pbkdf2-sha256-100000"},200,origin,env);
  if(path==="/api/auth/register/request-code" && method==="POST") {
    try { const d=await body(request); return response(await sendCode(String(d.phone||""),"register",d.turnstileToken,request,env),200,origin,env); }
    catch(e) { return response({error:e.error||e.message||"request_failed"},e.status||400,origin,env); }
  }
  if(path==="/api/auth/password/request-code" && method==="POST") {
    try { const d=await body(request); return response(await sendCode(String(d.phone||""),"password_reset",d.turnstileToken,request,env),200,origin,env); }
    catch(e) { return response({error:e.error||e.message||"request_failed"},e.status||400,origin,env); }
  }
  if(path==="/api/auth/register" && method==="POST") {
    try { const d=await body(request); const userId=await register(d,env); const s=await createSession(env.DB,userId,env); return response({ok:true},201,origin,env,{"set-cookie":cookie(s.token,s.maxAge)}); }
    catch(e) { return response({error:e.error||e.message||"registration_failed"},e.status||400,origin,env); }
  }
  if(path==="/api/auth/login" && method==="POST") {
    try {
      const d=await body(request),phone=String(d.phone||""),password=String(d.password||"");
      if(!validPhone(phone) || !password) return response({error:"invalid_credentials"},400,origin,env);
      const ip=request.headers.get("CF-Connecting-IP")||"unknown";
      if(!(await rateLimit(env.DB,"login:ip:"+ip,30,900)) || !(await rateLimit(env.DB,"login:phone:"+phone,10,900))) return response({error:"rate_limited"},429,origin,env);
      const user=await env.DB.prepare("SELECT id,password_hash FROM users WHERE phone=?").bind(phone).first();
      if(!user || !(await verifyPassword(password,user.password_hash))) return response({error:"invalid_credentials"},401,origin,env);
      const s=await createSession(env.DB,user.id,env);
      return response({ok:true},200,origin,env,{"set-cookie":cookie(s.token,s.maxAge)});
    } catch { return response({error:"login_failed"},500,origin,env); }
  }
  if(path==="/api/auth/password/reset" && method==="POST") {
    try {
      const d=await body(request),phone=String(d.phone||""),password=String(d.newPassword||"");
      if(password.length<10 || password.length>128) return response({error:"weak_password"},400,origin,env);
      const salt=crypto.getRandomValues(new Uint8Array(16));
      const derived=await derivePassword(password,salt);
      // Avoid consuming the reset code if password derivation fails.
      await verifyCode(phone,d.code,"password_reset",env);
      const hash="pbkdf2-sha256$"+PBKDF2_ITERATIONS+"$"+b64(salt)+"$"+b64(derived);
      await env.DB.prepare("UPDATE users SET password_hash=?,updated_at=? WHERE phone=?").bind(hash,new Date().toISOString(),phone).run();
      await env.DB.prepare("DELETE FROM sessions WHERE user_id=(SELECT id FROM users WHERE phone=?)").bind(phone).run();
      return response({ok:true},200,origin,env,{"set-cookie":cookie("",0)});
    } catch(e) { return response({error:e.error||e.message||"password_reset_failed"},e.status||400,origin,env); }
  }
  if(path==="/api/auth/logout" && method==="POST") {
    const token=getCookie(request); if(token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(await sha256(token)).run();
    return response({ok:true},200,origin,env,{"set-cookie":cookie("",0)});
  }
  if(path==="/api/profile" && method==="GET") {
    const user=await currentUser(request,env); if(!user) return response({error:"unauthorized"},401,origin,env);
    const uni = user.university_id ? await env.DB.prepare("SELECT canonical_name FROM universities WHERE id=?").bind(user.university_id).first() : null;
    return response({profile:{name:user.name,className:user.class_name,highSchool:user.high_school,university:uni?.canonical_name || "",grade:user.grade,province:user.province,city:user.city,bio:user.bio,phoneVisible:!!user.phone_visible_to_team}},200,origin,env);
  }
  if(path==="/api/profile" && method==="PUT") {
    const user=await currentUser(request,env); if(!user) return response({error:"unauthorized"},401,origin,env);
    try {
      const d=await body(request);
      if(!d.name || !d.className || !d.university || !d.grade || !d.province) return response({error:"profile_incomplete"},400,origin,env);
      const normalized=String(d.university).normalize("NFKC").replace(/[\s\p{P}\p{S}]+/gu,"").toLowerCase();
      let uni=await env.DB.prepare("SELECT id FROM universities WHERE normalized_name=?").bind(normalized).first();
      if(!uni){const id=randomHex(16);await env.DB.prepare("INSERT INTO universities(id,canonical_name,normalized_name) VALUES(?,?,?)").bind(id,String(d.university).trim(),normalized).run();uni={id};await env.DB.prepare("INSERT INTO teams(id,university_id,leader_user_id) VALUES(?,?,?)").bind(randomHex(16),id,user.id).run();}
      await env.DB.prepare("UPDATE users SET name=?,class_name=?,high_school=?,university_id=?,grade=?,province=?,city=?,bio=?,phone_visible_to_team=?,updated_at=? WHERE id=?").bind(String(d.name).trim(),String(d.className).trim(),String(d.highSchool||"青岛五十八中"),uni.id,String(d.grade),String(d.province),String(d.city||""),String(d.bio||""),d.phoneVisible?1:0,new Date().toISOString(),user.id).run();
      return response({ok:true},200,origin,env);
    }catch(e){return response({error:e.error||"profile_save_failed"},400,origin,env);}
  }
  if(path==="/api/directory" && method==="GET") {
    const user=await currentUser(request,env); if(!user) return response({error:"unauthorized"},401,origin,env);
    const own=await env.DB.prepare("SELECT university_id,province FROM users WHERE id=?").bind(user.id).first();
    const members=own.university_id?await env.DB.prepare("SELECT u.name,u.class_name AS className,u.grade,u.province,uni.canonical_name AS university,CASE WHEN u.phone_visible_to_team=1 THEN u.phone ELSE NULL END AS phone FROM users u JOIN universities uni ON uni.id=u.university_id WHERE u.university_id=? ORDER BY u.created_at").bind(own.university_id).all():{results:[]};
    const leaders=await env.DB.prepare("SELECT u.name,u.grade,u.province,uni.canonical_name AS university FROM teams t JOIN users u ON u.id=t.leader_user_id JOIN universities uni ON uni.id=t.university_id WHERE u.province=? ORDER BY uni.canonical_name").bind(own.province||"").all();
    return response({members:members.results||[],provinceLeaders:leaders.results||[]},200,origin,env);
  }
  return response({error:"not_found"},404,origin,env);
}
export default { fetch(request,env) { return route(request,env).catch(e=>{console.error("Worker unhandled error",e.message);return json({error:"internal_error"},500);}); } };

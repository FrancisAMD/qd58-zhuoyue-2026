import worker from "./worker.js";

export { D1BackupWorkflow } from "./d1-backup-workflow.js";

const SESSION_COOKIE = "__Host-qd58_session";
const encoder = new TextEncoder();

function cookieValue(request, name) {
  const raw = request.headers.get("cookie") || "";
  const prefix = name + "=";
  const item = raw.split(";").map(part => part.trim()).find(part => part.startsWith(prefix));
  return item ? item.slice(prefix.length) : "";
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function apiJson(data, status, origin, env) {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  };
  if (origin && origin === env.APP_ORIGIN) {
    headers["access-control-allow-origin"] = origin;
    headers["access-control-allow-credentials"] = "true";
    headers["access-control-allow-methods"] = "GET,POST,PUT,DELETE,OPTIONS";
    headers["access-control-allow-headers"] = "Content-Type";
    headers.vary = "Origin";
  }
  return new Response(JSON.stringify(data), { status, headers });
}

async function getAuthenticatedUserId(request, env) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const timestamp = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare(`SELECT u.id
    FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>? AND u.deleted_at=''
      AND s.auth_version=u.auth_version`)
    .bind(tokenHash, timestamp).first();
  return row?.id || null;
}

async function hasOtherTeamMembers(env, userId) {
  const leadership = await env.DB.prepare(`SELECT t.id,
    (SELECT COUNT(*) FROM users member
      WHERE member.university_id=t.university_id
        AND member.deleted_at='' AND member.id<>?) AS other_members
    FROM teams t WHERE t.leader_user_id=? LIMIT 1`)
    .bind(userId, userId).first();
  return !!leadership && Number(leadership.other_members || 0) > 0;
}

async function guardAccountDeletion(request, env, context, path) {
  const origin = request.headers.get("origin") || "";
  if (!env.APP_ORIGIN || origin !== env.APP_ORIGIN) {
    return apiJson({ error: "origin_not_allowed" }, 403, origin, env);
  }

  try {
    const userId = await getAuthenticatedUserId(request, env);
    if (!userId) return apiJson({ error: "unauthorized" }, 401, origin, env);

    const blocked = await hasOtherTeamMembers(env, userId);
    if (path === "/api/account/delete/preflight") {
      return apiJson({
        ok: true,
        canDelete: !blocked,
        reason: blocked ? "leader_transfer_required" : null
      }, 200, origin, env);
    }

    // Check before forwarding to the original SMS or deletion handlers. A blocked
    // leader never reaches Turnstile verification, OTP reservation, or SMS.
    if (blocked) return apiJson({ error: "leader_transfer_required" }, 409, origin, env);
    return worker.fetch(request, env, context);
  } catch (error) {
    console.error("Account deletion eligibility check failed", error?.message || "unknown");
    return apiJson({ error: "account_delete_preflight_unavailable" }, 503, origin, env);
  }
}

export default {
  fetch(request, env, context) {
    const url = new URL(request.url);
    const isPreflight = url.pathname === "/api/account/delete/preflight" && request.method === "GET";
    const isDeleteRequestCode = url.pathname === "/api/account/delete/request-code" && request.method === "POST";
    const isDelete = url.pathname === "/api/account/delete" && request.method === "POST";
    if (isPreflight || isDeleteRequestCode || isDelete) {
      return guardAccountDeletion(request, env, context, url.pathname);
    }
    return worker.fetch(request, env, context);
  },
  scheduled(controller, env, context) {
    return worker.scheduled?.(controller, env, context);
  }
};

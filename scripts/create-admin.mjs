#!/usr/bin/env node
// Bootstrap an initial owner account without putting its password in source control.
// Usage: ADMIN_BOOTSTRAP_PASSWORD='...' node scripts/create-admin.mjs <username> [owner|admin|viewer]
// The script prints SQL containing only the derived PBKDF2 hash. It does not connect to D1.
import { pbkdf2Sync, randomBytes, randomUUID } from "node:crypto";

const username = String(process.argv[2] || "").trim();
const role = String(process.argv[3] || "owner");
const password = process.env.ADMIN_BOOTSTRAP_PASSWORD || "";
if (!/^[A-Za-z0-9._-]{3,40}$/.test(username)) {
  console.error("Username must be 3-40 characters: letters, digits, dot, underscore or hyphen.");
  process.exit(2);
}
if (!["owner", "admin", "viewer"].includes(role)) {
  console.error("Role must be owner, admin or viewer.");
  process.exit(2);
}
if (password.length < 14 || password.length > 128) {
  console.error("Set ADMIN_BOOTSTRAP_PASSWORD to a 14-128 character password before running this script.");
  process.exit(2);
}
const salt = randomBytes(16);
const derived = pbkdf2Sync(password, salt, 100000, 32, "sha256");
const b64 = value => value.toString("base64");
const id = randomUUID().replace(/-/g, "");
const hash = "pbkdf2-sha256$100000$" + b64(salt) + "$" + b64(derived);
const sql = "INSERT INTO admin_users(id,username,password_hash,role,active,updated_at) VALUES(" +
  "'" + id + "','" + username.replace(/'/g, "''") + "','" + hash + "','" + role + "',1,'" + new Date().toISOString() + "');";
console.log(sql);
console.error("SQL generated. Apply only after migration 0006 is present; clear ADMIN_BOOTSTRAP_PASSWORD afterwards.");

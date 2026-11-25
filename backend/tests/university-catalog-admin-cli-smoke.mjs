import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { runCommand, verifyManifest } from "../../scripts/university-catalog-admin-cli.mjs";

const sha = value => createHash("sha256").update(value).digest("hex");
const payload = JSON.stringify({ target_university_id: "uni-1", record: { id: "mainland:CN-1" } });
const row = { catalog_id: "mainland:CN-1", target_university_id: "uni-1", action: "insert", payload_json: payload, payload_sha256: sha(payload) };
const digest = sha("2026-11-25\n" + row.catalog_id + ":" + row.payload_sha256 + "\n");
const manifest = { manifest_version: "1.0.0", already_applied: false, dataset_version: "2026-11-25", checksum_sha256: "b".repeat(64), manifest_sha256: digest, record_count: 1, records: [row] };
assert.deepEqual(verifyManifest(manifest), { dataset_version: manifest.dataset_version, record_count: 1, checksum_sha256: manifest.checksum_sha256, manifest_sha256: digest });

const baseArgs = ["--api-base", "https://api.test.invalid", "--app-origin", "https://app.test.invalid"];
const credentials = async () => ({ username: "owner-test", password: "not-logged" });
const output = [];
let logoutCount = 0, stageCount = 0;
const fetchStage = async (url, init) => {
  if (url.endsWith("/api/admin/login")) return new Response("{}", { status: 200, headers: { "set-cookie": "__Host-qd58_admin=secret-cookie; Path=/; HttpOnly" } });
  if (url.endsWith("/api/admin/logout")) { logoutCount++; return new Response("{}", { status: 200 }); }
  if (url.endsWith("/stage")) { stageCount++; const body = JSON.parse(init.body); assert.equal(body.manifest.manifest_sha256, digest); return new Response(JSON.stringify({ ok: true }), { status: 202 }); }
  if (url.includes("/status?")) return new Response(JSON.stringify({ import: { datasetVersion: manifest.dataset_version, checksumSha256: manifest.checksum_sha256, manifestSha256: digest, recordCount: 1, stagedCount: 1, stagingComplete: true, status: "validated" } }), { status: 200 });
  throw new Error("unexpected request " + url);
};
const result = await runCommand({ argv: ["stage", ...baseArgs, "--manifest", "manifest.json"], fetchImpl: fetchStage, promptCredentials: credentials, readFileImpl: async () => JSON.stringify(manifest), output: value => output.push(value) });
assert.equal(result.status, "validated"); assert.equal(stageCount, 1); assert.equal(logoutCount, 1);
assert.ok(output[0].includes(digest)); assert.equal(output[0].includes("secret-cookie"), false); assert.equal(output[0].includes("not-logged"), false);

let finalizeCount = 0, state = "validated";
const fetchFinalize = async (url, init) => {
  if (url.endsWith("/api/admin/login")) return new Response("{}", { status: 200, headers: { "set-cookie": "__Host-qd58_admin=another-secret; Path=/" } });
  if (url.endsWith("/api/admin/logout")) return new Response("{}", { status: 200 });
  if (url.includes("/status?")) return new Response(JSON.stringify({ import: { datasetVersion: manifest.dataset_version, checksumSha256: manifest.checksum_sha256, manifestSha256: digest, recordCount: 1, stagedCount: state === "applied" ? 0 : 1, stagingComplete: true, status: state } }), { status: 200 });
  if (url.endsWith("/finalize")) { const body = JSON.parse(init.body); assert.equal(body.confirmManifestSha256, digest); finalizeCount++; state = "applied"; return new Response(JSON.stringify({ ok: true }), { status: 200 }); }
  throw new Error("unexpected request " + url);
};
const finalized = await runCommand({ argv: ["finalize", ...baseArgs, "--dataset-version", manifest.dataset_version, "--manifest-sha256", digest], fetchImpl: fetchFinalize, promptCredentials: credentials, promptConfirm: async phrase => phrase === "APPLY " + digest, output: value => output.push(value) });
assert.equal(finalized.status, "applied"); assert.equal(finalizeCount, 1);

const corrupted = structuredClone(manifest); corrupted.records[0].payload_sha256 = "0".repeat(64);
assert.throws(() => verifyManifest(corrupted), /payload SHA-256/);
const noConfirmFetch = async () => { throw new Error("network must not be called for invalid manifest"); };
await assert.rejects(runCommand({ argv: ["stage", ...baseArgs, "--manifest", "manifest.json"], fetchImpl: noConfirmFetch, promptCredentials: credentials, readFileImpl: async () => JSON.stringify(corrupted), output: () => {} }));

console.log("university-catalog-admin-cli-smoke: all assertions passed");

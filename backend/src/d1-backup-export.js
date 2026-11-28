export function normalizeD1ExportResponse(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("backup_d1_export_response_invalid");
  }
  const nested = payload.result && typeof payload.result === "object" ? payload.result : {};
  const status = payload.status === "complete" || payload.status === "error"
    ? payload.status : "pending";
  return {
    status,
    bookmark: typeof payload.at_bookmark === "string" ? payload.at_bookmark : "",
    error: typeof payload.error === "string" ? payload.error : "",
    signedUrl: typeof nested.signed_url === "string" ? nested.signed_url : "",
    filename: typeof nested.filename === "string"
      ? nested.filename
      : (typeof payload.filename === "string" ? payload.filename : "")
  };
}

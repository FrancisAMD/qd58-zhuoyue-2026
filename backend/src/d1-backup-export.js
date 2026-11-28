export function normalizeD1ExportResponse(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || payload.success !== true ||
      !payload.result || typeof payload.result !== "object" || Array.isArray(payload.result)) {
    throw new Error("backup_d1_export_response_invalid");
  }
  const exportState = payload.result;
  const fileResult = exportState.result && typeof exportState.result === "object"
    ? exportState.result : {};
  const status = exportState.status === "complete" || exportState.status === "error"
    ? exportState.status : "pending";
  return {
    status,
    bookmark: typeof exportState.at_bookmark === "string" ? exportState.at_bookmark : "",
    error: typeof exportState.error === "string" ? exportState.error : "",
    signedUrl: typeof fileResult.signed_url === "string" ? fileResult.signed_url : "",
    filename: typeof fileResult.filename === "string"
      ? fileResult.filename
      : (typeof exportState.filename === "string" ? exportState.filename : "")
  };
}

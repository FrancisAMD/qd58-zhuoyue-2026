const DB_NAME = "qd58-zhuoyue-db";

export function parseSeedArgs(argv) {
  const seen = new Set();
  let targetMode = "";
  let apply = false;
  let dryRun = false;
  let confirmRemote = "";
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (seen.has(arg)) throw new Error("参数重复：" + arg);
    seen.add(arg);
    if (arg === "--remote" || arg === "--local") {
      if (targetMode) throw new Error("--remote 与 --local 不能同时使用。");
      targetMode = arg;
    } else if (arg === "--apply") {
      apply = true;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--confirm-remote") {
      if (!argv[i + 1] || argv[i + 1].startsWith("--")) throw new Error("--confirm-remote 必须提供数据库名称。");
      confirmRemote = argv[++i];
      seen.add("--confirm-remote-value");
    } else {
      throw new Error("不支持的参数：" + arg);
    }
  }
  if (apply && dryRun) throw new Error("--apply 与 --dry-run 不能同时使用。");
  if (confirmRemote && targetMode !== "--remote") throw new Error("--confirm-remote 只能与 --remote 一起使用。");
  if (!apply && confirmRemote) throw new Error("--confirm-remote 仅用于明确的写入模式。");
  if (apply && !targetMode) throw new Error("写入必须明确指定 --local 或 --remote。");
  if (apply && targetMode === "--remote" && confirmRemote !== DB_NAME) throw new Error("远程写入必须通过 --confirm-remote " + DB_NAME + " 明确确认目标数据库。");
  if (targetMode === "--remote" && apply && !confirmRemote) throw new Error("远程写入需要 --confirm-remote " + DB_NAME + "。");
  return { targetMode, apply, dryRun: !apply, confirmRemote };
}

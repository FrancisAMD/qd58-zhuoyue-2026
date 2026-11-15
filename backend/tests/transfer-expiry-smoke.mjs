import worker from "../src/worker.js";

const statements=[];
const db={
  prepare(sql){
    return {bind(...args){return {sql,args};}};
  },
  async batch(items){statements.push(...items);return [{meta:{changes:1}},{meta:{changes:1}}];}
};
let task;
worker.scheduled({cron:"*/15 * * * *"},{DB:db},{waitUntil(p){task=p;}});
if(!task) throw new Error("scheduled expiry task was not registered");
await task;
if(statements.length!==6) throw new Error("scheduled maintenance must run transfer expiry plus four bounded security-data cleanup statements");
if(!statements[0].sql.includes("status='expired'") || !statements[0].sql.includes("expires_at<=?")) throw new Error("expiry sweep must select only overdue pending transfers");
if(!statements[1].sql.includes("'system'") || !statements[1].sql.includes("team.transfer.expired")) throw new Error("expiry sweep must create a system audit event");
const cleanup=statements.slice(2);
if(!cleanup[0].sql.includes("DELETE FROM otp_challenges") || !cleanup[0].sql.includes("LIMIT 500")) throw new Error("OTP cleanup must be bounded");
if(!cleanup[1].sql.includes("DELETE FROM sessions") || !cleanup[2].sql.includes("DELETE FROM admin_sessions")) throw new Error("expired user/admin sessions must be purged");
if(!cleanup[3].sql.includes("DELETE FROM rate_limits") || !cleanup[3].sql.includes("rl:v1:%")) throw new Error("legacy and pseudonymous rate-limit records must be purged by retention window");
console.log("Transfer expiry scheduler tests: PASS (scheduled sweep, pending-only deadline transition and audit insert).");

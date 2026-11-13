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
if(statements.length!==2) throw new Error("expiry sweep must update transfers and append an audit event");
if(!statements[0].sql.includes("status='expired'") || !statements[0].sql.includes("expires_at<=?")) throw new Error("expiry sweep must select only overdue pending transfers");
if(!statements[1].sql.includes("'system'") || !statements[1].sql.includes("team.transfer.expired")) throw new Error("expiry sweep must create a system audit event");
console.log("Transfer expiry scheduler tests: PASS (scheduled sweep, pending-only deadline transition and audit insert).");

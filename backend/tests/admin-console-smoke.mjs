import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../../",import.meta.url);
const html = readFileSync(new URL("admin.html",root),"utf8");
const js = readFileSync(new URL("admin.js",root),"utf8");
const css = readFileSync(new URL("style.css",root),"utf8");

for(const id of ["adminLogin","adminMsg","demoPanel","demoTabs","demoContent","demoSearch","dashboard","adminPanelStatus"]) {
  assert.match(html,new RegExp('id="'+id+'"'),"admin.html must contain #"+id);
}
assert.match(html,/演示模式/);
assert.match(html,/不读取、不写入 D1/);
assert.match(html,/内置 Demo 后台预览/);
assert.match(js,/async function enter\(options=\{\}\)/);
assert.match(js,/await req\("\/admin\/me"\)/);
assert.match(js,/Promise\.allSettled/);
assert.match(js,/密码已被登录接口接受，但随后读取管理员会话返回 401/);
assert.match(js,/已登录；部分面板加载失败/);
assert.match(js,/const DEMO_DATA=/);
assert.match(js,/function renderDemo\(\)/);
assert.match(js,/虚构报名数据/);
assert.match(js,/不会接受或拒绝任何真实转让/);
assert.match(css,/\.admin-demo/);
assert.match(css,/\.demo-warning/);

const renderStart=js.indexOf("function renderDemo()");
const renderEnd=js.indexOf("function openDemo()",renderStart);
assert.ok(renderStart>=0 && renderEnd>renderStart,"demo renderer must exist");
assert.doesNotMatch(js.slice(renderStart,renderEnd),/\breq\s*\(/,"demo renderer must not call admin API");
console.log("Admin console UI tests: PASS (login/session separation, panel isolation and API-free fictional demo).");

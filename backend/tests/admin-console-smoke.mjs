import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../../",import.meta.url);
const html = readFileSync(new URL("admin.html",root),"utf8");
const js = readFileSync(new URL("admin.js",root),"utf8");
const css = readFileSync(new URL("style.css",root),"utf8");

for(const id of ["adminLogin","adminMsg","demoPanel","demoTabs","demoContent","demoSearch","dashboard","adminPanelStatus","universityReviewPanel","universityReviewRows","refreshUniversityReviews","teamsPanel","teamsGrid"]) {
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
assert.match(js,/loadUniversityReviews/);
assert.match(js,/universities:review/);
assert.match(html,/OVERSEAS UNIVERSITY REVIEW/);
assert.match(js,/loadUniversityReviews/);
assert.match(js,/universities:review/);
assert.match(js,/\/admin\/universities\/review/);
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

assert.match(html,/ACTIVE UNIVERSITY TEAMS/);
assert.match(html,/资料概览 \/ 完整资料/);
assert.match(js,/function renderPersonDetails\(item\)/);
assert.match(js,/data-profile-toggle/);
assert.match(js,/尚未选择高校/);
assert.match(js,/当前有成员的大学团队/);
assert.match(js,/item\.majorDiscipline/);
assert.match(js,/item\.admissionCategory/);
assert.doesNotMatch(js,/item\.phone|item\.secondaryPhone|item\.wechatId/,"admin details must not read private contact fields");
assert.match(css,/\.admin-profile-details/);
assert.match(css,/\.admin-team-grid/);
assert.match(css,/justify-self:center/);

assert.match(html,/资料概览 \/ 完整资料/);
assert.match(html,/仅显示最近 10 条记录/);
assert.match(js,/function renderProfilePreview\(item\)/);
assert.match(js,/pageSize=10/);
assert.match(js,/slice\(0,10\)/);
assert.match(js,/30_000|30000/);
assert.match(css,/\.admin-profile-preview/);

assert.match(html,/id="province"><option value="">全部省份 \/ 地区<\/option>/);
assert.match(html,/id="grade"><option value="">全部年级<\/option>/);
assert.match(js,/people:delete/);
assert.match(js,/data-person-delete/);
assert.match(js,/methodOverride\|\|\(data\?"POST":"GET"\)/);
assert.match(css,/#dashboard[\s\S]*?row-gap:22px/);
assert.match(css,/#results\.cards[\s\S]*?gap:20px!important/);
assert.match(css,/#teamSummary[\s\S]*?directory-team-grid[\s\S]*?gap:16px/);

assert.match(js,/colspan="10"/);

for(const id of ["groupChatQrPanel","groupQrRegion","groupQrFile","uploadGroupQr","groupQrAssetList","refreshGroupQr"]) {
  assert.match(html,new RegExp('id="'+id+'"'),"admin QR management must include #"+id);
}
assert.match(js,/async function loadGroupQrAssets\(\)/);
assert.doesNotMatch(js,/loadGroupChatConfirmations|groupChatConfirmationRegion|groupChatConfirmationRows/,"join confirmation is managed in the roster, not a separate QR panel list");
assert.match(js,/method:"PUT",credentials:"include"/);
assert.match(js,/data-qr-delete/);

assert.match(html,/入群确认/,"roster table must include a group-chat confirmation column");
assert.match(js,/groupChatStatusMarkup\(item\)/);
assert.match(js,/profileDetailField\("入群确认状态",item\.groupChatStatusLabel\)/);
assert.doesNotMatch(html,/group-chat-confirmation-block/,"confirmation status must not be a separate admin section");
assert.doesNotMatch(html,/groupChatConfirmationRows|groupChatConfirmationRegion/);
assert.ok(html.indexOf('id="universityReviewPanel"')<html.indexOf('id="peoplePanel"'),"overseas review must be near the top of the dashboard");
assert.ok(html.indexOf('id="groupChatQrPanel"')<html.indexOf('id="peoplePanel"'),"regional QR management must be near the top of the dashboard");

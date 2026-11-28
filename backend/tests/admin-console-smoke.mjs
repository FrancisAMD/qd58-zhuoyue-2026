import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../../",import.meta.url);
const html = readFileSync(new URL("admin.html",root),"utf8");
const js = readFileSync(new URL("admin.js",root),"utf8");
const css = readFileSync(new URL("style.css",root),"utf8");
const backupCss = readFileSync(new URL("backup-admin.css",root),"utf8");

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

assert.match(html,/id="adminSectionNav"/,"authenticated dashboard must provide a sidebar navigation container");
assert.match(html,/class="admin-workspace"/,"dashboard panels must be arranged beside the sidebar");
const navPermissions = [
  ["overviewPanel","overview"],
  ["teamsPanel","overview"],
  ["universityReviewPanel","universities:review"],
  ["groupChatQrPanel","group-chat:manage"],
  ["peoplePanel","people:read"],
  ["donationManagementPanel","donations:manage"],
  ["auditPanel","audit:read"],
  ["backupPanel","backups:manage"],
  ["managePanel","admins:manage"]
];
for(const [target,permission] of navPermissions){
  assert.match(html,new RegExp('data-nav-target="'+target+'" data-nav-permission="'+permission+'"'),
    "sidebar entry "+target+" must use the same permission as its panel");
  assert.match(html,new RegExp('id="'+target+'"'),"sidebar target "+target+" must exist");
}
assert.match(js,/function syncAdminNavigation\(\)/,"sidebar access must be derived from current administrator permissions");
assert.match(js,/const allowed=has\(button\.dataset\.navPermission\)/,"sidebar entries must be filtered using current permission set");
assert.match(js,/\$\("adminSectionNav"\)\.addEventListener\("click"/,"sidebar links must navigate to their target panels");
assert.match(js,/target\.scrollIntoView\(\{behavior:"smooth",block:"start"\}\)/,"sidebar navigation must smoothly jump to sections");
assert.match(js,/\$\("overviewPanel"\)\.hidden=!has\("overview"\)/,"overview section must follow overview permission");
assert.match(css,/\.admin-workspace\{[\s\S]*?grid-template-columns:minmax\(190px,230px\) minmax\(0,1fr\)/,"desktop dashboard must use a left sidebar and main content");
assert.match(css,/\.admin-sidebar\{[\s\S]*?position:sticky/,"desktop sidebar should remain visible while scrolling");
assert.match(css,/@media\(max-width:760px\)[\s\S]*?\.admin-section-nav\{[\s\S]*?overflow-x:auto/,"sidebar should become a horizontally scrollable section bar on mobile");

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
assert.match(js,/let current=null,page=1,pageSize=10/,"roster should default to ten rows per page");
assert.match(html,/id="firstPage"/,"roster pagination should provide a first-page control");
assert.match(html,/id="lastPage"/,"roster pagination should provide a last-page control");
assert.match(js,/\$\("firstPage"\)\.onclick/,"first-page control must be wired");
assert.match(js,/\$\("lastPage"\)\.onclick/,"last-page control must be wired");
assert.match(js,/本页 "\+items\.length\+" 条 · 共 "/,"pagination label should show current-page and total row counts");
assert.match(css,/\.admin-shell\{width:min\(100%,1680px\);max-width:1680px\}/,"admin console should use a wider desktop layout");
assert.match(backupCss,/background:var\(--paper\)/,"backup cards should use the active light/dark theme surface");
assert.doesNotMatch(backupCss,/var\(--panel,\s*rgba\(255,255,255,\.5\)\)/,"backup cards must not fall back to a translucent white wash");
assert.match(backupCss,/:root\[data-theme="dark"\] body \.backup-card\{background:#27372f/,"backup card must remain opaque in dark mode");
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
assert.doesNotMatch(html,/value="viewer"/,"new administrator creation must not offer a read-only role");
assert.match(html,/普通管理员仅可查看统计概览、审核海外高校、管理地区群聊二维码/);
assert.match(js,/teamsPanel"\)\.hidden=!has\("overview"\)/,"ordinary admins retain team-level overview without roster access");
assert.match(js,/data-admin-delete/,"owner UI must provide admin deletion actions");
assert.match(js,/历史只读账号（待删除）/,"legacy viewer accounts must be identifiable for cleanup");

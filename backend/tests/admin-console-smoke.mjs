import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../../",import.meta.url);
const html = readFileSync(new URL("admin.html",root),"utf8");
const js = readFileSync(new URL("admin.js",root),"utf8");
const css = readFileSync(new URL("style.css",root),"utf8");
const backupCss = readFileSync(new URL("backup-admin.css",root),"utf8");
const typography = readFileSync(new URL("typography.css",root),"utf8");

for(const id of ["adminLogin","adminMsg","dashboard","adminPanelStatus","universityReviewPanel","universityReviewRows","refreshUniversityReviews","teamsPanel","teamsGrid","teamFilters","teamRegion","teamLevel","teamMinMembers","teamMaxMembers","teamPageLabel","adminFooter"]) {
  assert.match(html,new RegExp('id="'+id+'"'),"admin.html must contain #"+id);
}
assert.doesNotMatch(html,/<header[\s>]/,"admin page no longer needs a site-wide top header");
assert.doesNotMatch(html,/demoPanel|openDemo|dashboardDemo|内置 Demo|演示模式/i,"admin demo markup and entry points must be removed");
assert.match(html,/class="site-footer"[\s\S]*?去远方求证，回原点作答。[\s\S]*?返回首页/,"admin footer should reuse the homepage identity and return-home action");
assert.doesNotMatch(html,/class="site-footer-button site-footer-github"/,"admin footer should replace the GitHub action with Return Home");
assert.match(js,/async function enter\(options=\{\}\)/);
assert.match(js,/await req\("\/admin\/me"\)/);
assert.match(js,/Promise\.allSettled/);
assert.match(js,/密码已被登录接口接受，但随后读取管理员会话返回 401/);
assert.match(js,/已登录；部分面板加载失败/);
assert.doesNotMatch(js,/DEMO_DATA|renderDemo|openDemo|dashboardDemo/,"admin JavaScript must not contain fictional demo datasets or renderers");
assert.doesNotMatch(css,/\.admin-demo|\.demo-warning|\.demo-tabs/,"admin stylesheet must not retain the demo UI");
assert.match(html,/style\.css\?v=20261128-local-fonts-v1/,"admin must load the latest sidebar account layout stylesheet");
assert.match(html,/typography\.css\?v=20261128-local-fonts-v1/,"admin must load the shared typography system after its component stylesheets");
assert.match(typography,/--type-body:15px/,"admin body copy should share the fifteen-pixel body tier");
assert.match(typography,/--type-secondary:13\.5px/,"admin secondary text should share the readable secondary tier");
assert.match(typography,/body h3\{font-size:var\(--type-subsection\)!important/,"admin section headings should follow the shared hierarchy");
assert.doesNotMatch(typography,/body :where\([^)]*(?:span|strong|b)[^)]*\)\s*\{[^}]*font-size/,"inline emphasis must not be independently enlarged");
assert.match(typography,/body :is\(\.admin-profile-field b,\.donation-list-row>strong/,"admin profile values should use a consistent data-value size");
assert.ok(typography.includes(".admin-sidebar-heading")&&typography.includes(".directory-school>div>span"),"admin navigation and metadata should not use micro typography");
assert.doesNotMatch(typography,/font-size:\s*(?:[89]|1[01]|12)px(?:\s|!|;|\/)/,"admin shared typography must not define micro-sized text");
assert.match(css,/--field-bg:#edf0ed/,"admin light mode must share the neutral field surface");
assert.match(css,/--field-bg:#1A241E/,"admin dark mode must share the neutral field surface");
assert.match(css,/\.admin-team-card,[\s\S]*?\.admin-profile-field,[\s\S]*?background:var\(--field-bg\)!important/,"admin team and profile tiles must use the neutral inner surface");
assert.match(js,/loadUniversityReviews/);
assert.match(js,/universities:review/);
assert.match(html,/OVERSEAS UNIVERSITY REVIEW/);
assert.match(js,/loadUniversityReviews/);
assert.match(js,/universities:review/);
assert.match(js,/\/admin\/universities\/review/);
assert.doesNotMatch(js,/DEMO_DATA|renderDemo|openDemo|dashboardDemo/,"admin JavaScript must not contain demo data or renderer functions");
assert.doesNotMatch(css,/\.admin-demo|\.demo-warning|\.demo-tabs/,"admin CSS must not retain demo-specific styles");
console.log("Admin console UI tests: PASS (login/session separation, no demo data, homepage footer and team filters).");

assert.match(html,/id="adminSectionNav"/,"authenticated dashboard must provide a sidebar navigation container");
assert.match(html,/class="admin-workspace"/,"dashboard panels must be arranged beside the sidebar");

assert.match(html,/id="adminSidebarToggle"[^>]*aria-controls="adminSidebar"/,"admin workspace must provide an accessible sidebar toggle");
assert.match(html,/id="adminWorkspace"/,"sidebar toggle must control the authenticated workspace");
assert.doesNotMatch(html,/class="admin-toolbar"/,"the separate top admin toolbar must be removed");
const sidebarRoleCard=html.slice(html.indexOf('<aside class="admin-sidebar"'),html.indexOf('<div class="admin-main-content">'));
assert.match(sidebarRoleCard,/class="admin-section-nav"/);
assert.ok(sidebarRoleCard.indexOf('class="admin-section-nav"')<sidebarRoleCard.indexOf('class="admin-sidebar-role-card"'),"account controls must be placed below the sidebar navigation");
for(const id of ["adminRole","adminIdentity","adminLogout"]) assert.ok(sidebarRoleCard.includes('id="'+id+'"'),"sidebar role card must contain #"+id);
assert.ok(js.includes('window.matchMedia("(max-width:760px)")'),"mobile sidebar default should be detected from the viewport");
assert.ok(js.includes("setAdminSidebarCollapsed(adminSidebarMedia.matches)"),"desktop should default expanded while mobile defaults collapsed");
assert.ok(js.includes('$("adminSidebarToggle").addEventListener("click"'),"sidebar toggle should be interactive");
assert.ok(js.includes('adminSidebarMedia.addEventListener("change",handleAdminSidebarViewportChange)'),"sidebar should adapt when the viewport crosses the mobile breakpoint");
assert.ok(js.includes('$("adminRole").textContent=({owner:"所有者",admin:"普通管理员"}[current.role]||current.role)'),"role card should show the correct role label");
assert.ok(css.includes(".admin-sidebar-toggle{")&&css.includes("grid-column:1/-1;"),"sidebar toggle should appear at the upper-left of the dashboard workspace");
assert.ok(css.includes(".admin-workspace.is-sidebar-collapsed .admin-sidebar{")&&css.includes("display:none!important"),"collapsed state should hide the sidebar while preserving the content area");
assert.ok(css.includes(".admin-sidebar-role-card{")&&css.includes("background:var(--field-bg);"),"role indicator should be a small card under navigation");
assert.ok(css.includes(".admin-section-nav{")&&css.includes("grid-template-columns:repeat(2,minmax(0,1fr));"),"expanded mobile navigation should stack into a compact grid");

const navPermissions = [
  ["overviewPanel","overview"],
  ["peoplePanel","people:read"],
  ["teamsPanel","overview"],
  ["universityReviewPanel","universities:review"],
  ["groupChatQrPanel","group-chat:manage"],
  ["donationManagementPanel","donations:manage"],
  ["backupPanel","backups:manage"],
  ["auditPanel","audit:read"],
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
assert.match(js,/\$\(button\.dataset\.navTarget\)\.scrollIntoView\(\{behavior:"smooth",block:"start"\}\)/,"sidebar navigation must smoothly jump to the selected view");
assert.match(js,/function showAdminView\(targetId,\{pushHistory=false,replaceHistory=false\}=\{\}\)/,"navigation should switch the active view rather than scroll across a continuous page");
assert.match(js,/panel\.hidden=panel!==target\|\|!has\(panel\.dataset\.viewPermission\)/,"switching views must hide every other panel and deny unauthorized panels");
assert.match(js,/window\.addEventListener\("popstate"/,"browser back/forward should restore the selected admin view");
for(const [target] of navPermissions){
  assert.match(html,new RegExp('<section id="'+target+'"[^>]*data-admin-view="'+target+'"[^>]*hidden>'),
    "each dashboard module must start hidden and be rendered only when selected");
}
const sectionOrder=navPermissions.map(([target])=>html.indexOf('<section id="'+target+'"'));
assert.deepEqual(sectionOrder,[...sectionOrder].sort((a,b)=>a-b),"dashboard section DOM order must match the sidebar order");
assert.match(js,/if\(!target\|\|!has\(target\.dataset\.viewPermission\)\)return false/,"view switching must reject panels outside the current permission set");
assert.match(css,/\.admin-workspace\{[\s\S]*?grid-template-columns:minmax\(190px,230px\) minmax\(0,1fr\)/,"desktop dashboard must use a left sidebar and main content");
assert.match(css,/\.admin-sidebar\{[\s\S]*?position:sticky/,"desktop sidebar should remain visible while scrolling");
assert.match(css,/@media\(max-width:760px\)[\s\S]*?\.admin-section-nav\{[\s\S]*?overflow-x:auto/,"sidebar should become a horizontally scrollable section bar on mobile");

assert.match(html,/ACTIVE UNIVERSITY TEAMS/);
assert.match(html,/id="peopleRows" class="admin-roster-grid"/,"roster should use a card grid instead of a wide table");
assert.match(js,/function renderPersonDetails\(item\)/);
assert.match(js,/data-profile-toggle/);
assert.match(js,/尚未选择高校/);
assert.match(js,/当前有成员的大学团队/);
assert.match(js,/item\.majorDiscipline/);
assert.match(js,/item\.admissionCategory/);
assert.doesNotMatch(js,/item\.phone|item\.secondaryPhone|item\.wechatId/,"admin details must not read private contact fields");
assert.match(html,/id="teamRegion"/,"team filters should include catalog regions");
assert.match(html,/id="teamLevel"/,"team filters should include project tiers");
assert.match(html,/id="teamMinMembers"/);
assert.match(html,/id="teamMaxMembers"/);
assert.match(js,/async function loadTeams\(\)/,"teams should load from the dedicated server-side listing endpoint");
assert.match(js,/req\(\"\/admin\/teams\?\"/,"team filters must be sent to the Worker API");
assert.match(js,/teamFilters=\{\}/);
assert.match(js,/project_985_legacy/);
assert.match(js,/project_211_legacy/);
assert.match(js,/double_first_class_round1/);
assert.match(js,/teamMinMembers/);
assert.match(js,/teamMaxMembers/);
assert.match(css,/\.team-filters/);
assert.match(css,/\.admin-team-card-tags/);
assert.match(html,/id="teamFirstPage"/);
assert.match(html,/id="teamNextPage"/);
assert.match(css,/\.admin-profile-details/);
assert.match(css,/\.admin-team-grid/);
assert.match(css,/justify-self:center/);

assert.match(js,/每位同学以独立卡片展示高校、年级、地区、入群确认和资料摘要/,"roster guidance should describe the new card layout");
assert.match(js,/pageSize=10/,"roster should retain ten records per page");
assert.match(html,/仅显示最近 10 条记录/);
assert.match(js,/function renderProfilePreview\(item\)/);
assert.doesNotMatch(js,/58ER · MEMBER/,"roster cards must not show the decorative member kicker");

assert.match(js,/class="admin-person-grade admin-person-info-box"><small>当前年级/,"roster card grade must have its own labeled block");
assert.match(js,/class="admin-person-high-school admin-person-info-box"><small>高中/,"roster card high school must have its own labeled block");
assert.match(css,/#peoplePanel \.admin-person-info-row\{\s*display:grid!important;\s*grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\)!important;/,"high school and grade blocks should appear side by side");
assert.match(html,/style\.css\?v=20261128-local-fonts-v1/,"admin must load the latest shared stylesheet");
assert.match(html,/admin\.js\?v=20261128-team-tier-tag-codes-v2/,"admin must load the current admin script");
assert.ok(js.includes("'<h4 class=\"admin-person-name\">'+safe(name)+'</h4>'+"),"member name should render directly inside the card, without a wrapping header module");
assert.doesNotMatch(js,/<header class="admin-person-card-heading"/,"roster name must not use the global site header element");
assert.match(css,/#peoplePanel \.admin-person-card > \.admin-person-name\{[\s\S]*?background:transparent[\s\S]*?font-family:"LXGW WenKai Lite"/,"member name should be unboxed and use the intended serif title font");
assert.match(css,/#peoplePanel \.admin-person-card > \.admin-person-name\{[\s\S]*?margin:0 0 12px/,"member name spacing should be controlled without an empty header gap");
assert.doesNotMatch(css,/admin-person-card-heading|admin-person-identity/,"obsolete name-header styles should be removed");
assert.match(js,/class="admin-person-card"/,"each person must render as an independent card");
assert.match(js,/class="admin-person-facts"/,"person cards must group key account facts");
assert.match(js,/class="admin-person-details"/,"full profile details must expand inside the person card");
assert.match(js,/card\?\.querySelector\("\[data-profile-detail-row\]"\)/,"profile detail toggle must target the current card only");
assert.match(js,/has\("people:delete"\)/,"delete action must continue to obey the people:delete permission");
assert.match(css,/\.admin-person-card\{/,"person cards should have a dedicated visual surface");
assert.match(css,/#peoplePanel \.admin-roster-grid\{[\s\S]*?grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/,"wide screens should use a two-column roster card layout");
assert.match(css,/@media\(max-width:760px\)[\s\S]*?#peoplePanel \.admin-roster-grid\{gap:12px/,"mobile roster cards should reduce spacing");
assert.match(css,/\.admin-person-card \.admin-profile-details\{/,"expanded profile details should stay inside the profile card");

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

assert.match(js, /admin-roster-empty/, "empty roster state should be rendered as a card-list message");

for(const id of ["groupChatQrPanel","groupQrRegion","groupQrFile","uploadGroupQr","groupQrAssetList","refreshGroupQr"]) {
  assert.match(html,new RegExp('id="'+id+'"'),"admin QR management must include #"+id);
}
assert.match(js,/async function loadGroupQrAssets\(\)/);
assert.doesNotMatch(js,/loadGroupChatConfirmations|groupChatConfirmationRegion|groupChatConfirmationRows/,"join confirmation is managed in the roster, not a separate QR panel list");
assert.match(js,/method:"PUT",credentials:"include"/);
assert.match(js,/data-qr-delete/);

assert.match(js,/入群确认/,"each roster card must display the group-chat confirmation status");
assert.match(js,/groupChatStatusMarkup\(item\)/);
assert.match(js,/profileDetailField\("入群确认状态",item\.groupChatStatusLabel\)/);
assert.doesNotMatch(html,/group-chat-confirmation-block/,"confirmation status must not be a separate admin section");
assert.doesNotMatch(html,/groupChatConfirmationRows|groupChatConfirmationRegion/);
assert.ok(html.indexOf('id="peoplePanel"')<html.indexOf('id="teamsPanel"')&&html.indexOf('id="teamsPanel"')<html.indexOf('id="universityReviewPanel"'),"roster and teams must precede operational modules in the agreed order");
assert.doesNotMatch(html,/value="viewer"/,"new administrator creation must not offer a read-only role");
assert.match(html,/普通管理员仅可查看统计概览、审核海外高校、管理地区群聊二维码/);
for(const code of ["project_985","project_211","double_first_class"]) {
  assert.ok(js.includes('"'+code+'"'),"team card labels must recognize imported catalog tag "+code);
}
assert.ok(js.includes("team.catalogProjectTagsJson"),"team cards must also read normalized university tags from the API");
assert.ok(js.includes("team.profileCatalogTagsJson"),"team cards must read the original tags maintained by the profile catalog seeder");

assert.match(html,/data-nav-target="teamsPanel" data-nav-permission="overview"/,"ordinary admins can access teams through the overview permission");
assert.match(html,/admin\.js\?v=20261128-team-tier-tag-codes-v2/,"admin script cache must be refreshed for the imported university tier mapping");
assert.match(js,/async function downloadRosterExport\(format\)/,"CSV and XLSX should share the blob download path");
assert.match(js,/credentials:"include"/,"roster exports must include the admin session cookie");
assert.match(js,/mode:"cors"/,"roster exports must use CORS fetch instead of a top-level cross-origin navigation");
assert.match(js,/response\.blob\(\)/,"roster export responses must be downloaded as binary blobs");
assert.match(js,/URL\.createObjectURL\(blob\)/,"roster export must create a browser download URL");
assert.match(js,/downloadRosterExport\("csv"\)/,"CSV button must use the authenticated fetch download path");
assert.match(js,/downloadRosterExport\("xlsx"\)/,"XLSX button must use the authenticated fetch download path");
assert.doesNotMatch(js,/location\.href=API\+"\/admin\/people\?"/,"roster exports must not navigate directly to the API host without an Origin header");
assert.match(js,/roster_export_unexpected_content_type/,"unexpected response formats must not be downloaded as roster files");
assert.match(js,/roster_export_empty/,"empty export files must be reported instead of downloaded");
assert.match(js,/data-admin-delete/,"owner UI must provide admin deletion actions");
assert.match(js,/历史只读账号（待删除）/,"legacy viewer accounts must be identifiable for cleanup");

assert.ok(js.includes('admin-person-info-row'),"high school and grade should share one horizontal row");
assert.match(css,/#peoplePanel \.admin-person-info-row\{\s*display:grid!important;\s*grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\)!important;/,"the school/grade row must use a two-column grid");
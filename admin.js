const API="https://api.58er.eon21.space/api", $=id=>document.getElementById(id);
let current=null,page=1,pageSize=10,totalPages=1,filters={},overviewRefreshTimer=null;
let teamPage=1,teamPageSize=20,teamTotalPages=1,teamFilters={},teamRegionOptions=[];

async function req(path,data,methodOverride){
  let response;
  try {
    response=await fetch(API+path,{
      method:methodOverride||(data?"POST":"GET"),
      credentials:"include",
      headers:data?{"Content-Type":"application/json"}:{},
      body:data?JSON.stringify(data):undefined
    });
  } catch {
    const error=new Error("network_error");
    error.status=0;
    throw error;
  }
  let payload={};
  try { payload=await response.json(); } catch {}
  if(!response.ok){
    const error=new Error(payload.error||"request_failed");
    error.status=response.status;
    error.payload=payload;
    throw error;
  }
  return payload;
}
function safe(value){
  return String(value??"").replace(/[&<>"]/g,character=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[character]));
}
const ERROR_MESSAGES={
  unauthorized:"管理员会话无效或已过期，请重新登录。",
  invalid_credentials:"用户名或密码不正确。请确认 root 用户名及该账号创建时设置的密码。",
  rate_limited:"登录尝试过于频繁，请稍后再试。",
  rate_limit_secret_not_configured:"Worker 缺少 RATE_LIMIT_HMAC_SECRET，登录已安全暂停。",
  origin_forbidden:"后台页面来源与 Worker 的 APP_ORIGIN 不一致。",
  admin_login_failed:"管理员登录服务发生内部错误，请检查 Worker Logs。",
  network_error:"无法连接管理员 API，请检查网络和 api.58er.eon21.space。",
  roster_export_failed:"导出请求失败，请刷新页面后重试。",
  roster_export_empty:"服务器返回了空文件，请稍后重试。",
  roster_export_unexpected_content_type:"服务器返回的文件格式不正确，未执行下载。",
  forbidden:"当前管理员角色没有此项权限。",
  team_leader_transfer_required:"该同学仍是有其他成员的团队组长，请先完成组长转让后再删除。",
  person_not_found:"该报名记录不存在，可能已被其他管理员删除。",
  admin_delete_conflict:"删除状态发生冲突，请刷新名单后重试。",
  admin_person_delete_failed:"删除报名记录失败，请稍后重试。",
  group_qr_storage_not_configured:"Worker 尚未绑定 GROUP_QR R2 Bucket，请先创建并绑定 qd58-group-chat-qr。",
  backup_storage_not_configured:"Worker 尚未绑定专用 D1_BACKUPS R2 Bucket。",
  backup_dispatch_not_configured:"Worker 尚未配置 GitHub Actions 手动触发权限；可从 GitHub Actions 页面手动运行备份。",
  backup_dispatch_failed:"无法触发 GitHub Actions，请检查 GITHUB_BACKUP_DISPATCH_TOKEN 的权限、有效期和仓库 Actions 设置。",
  github_token_invalid:"GitHub Token 无效、已过期或已撤销。请检查 Worker Secret GITHUB_BACKUP_DISPATCH_TOKEN。",
  github_actions_permission_denied:"GitHub 拒绝了 Workflow Dispatch。请确认 Fine-grained Token 对本仓库具有 Actions: Read and write 权限，并检查组织策略。",
  github_repository_or_workflow_not_found:"GitHub 找不到目标仓库或备份 Workflow；请确认仓库名、Workflow 文件名及 main 分支。",
  github_workflow_dispatch_rejected:"GitHub 收到请求但拒绝启动 Workflow。请检查 Workflow 是否已在默认分支启用 workflow_dispatch，以及请求输入是否匹配。",
  github_rate_limited:"GitHub API 已触发限流，请稍后重试。",
  github_api_unavailable:"GitHub API 暂时不可用，请稍后重试。",
  github_api_network_error:"Worker 无法连接 GitHub API，请检查网络或稍后重试。",
  backup_configuration_incomplete:"Worker 缺少备份清单校验所需的 BACKUP_MASTER_KEY_V1。",
  backup_start_failed:"无法启动 GitHub Actions 备份任务，请检查 Worker 日志和 GitHub Actions 配置。",
  backup_list_failed:"备份列表加载失败，请检查专用 R2 Bucket 和备份密钥。",
  backup_not_found:"找不到这份备份。",
  backup_not_ready:"该备份尚未成功完成。",
  backup_last_successful_protected:"不能删除最后一份成功备份。",
  backup_running:"备份任务正在进行，不能删除。",
  backup_management_failed:"备份管理操作失败，请检查 Worker 日志。",
  backup_export_already_running:"当前已有一次 D1 导出正在运行，请稍后重试。",
  backup_export_lock_busy:"备份任务锁正在被其他任务获取，请稍后重试。",
  backup_export_lock_lost:"备份导出锁已丢失，当前任务已安全终止。",
  group_qr_region_invalid:"所选地区不正确，请刷新页面后重试。",
  group_qr_file_too_large:"二维码图片不能超过 5 MB。",
  group_qr_file_empty:"请先选择二维码图片。",
  group_qr_image_type_invalid:"仅支持 PNG、JPG 或 WebP 图片，请确认文件格式。",
  group_qr_upload_failed:"二维码上传失败，请检查 R2 Bucket 和 Worker 日志。",
  group_qr_delete_failed:"删除二维码失败，请稍后重试。",
  group_chat_confirmations_failed:"入群确认名单加载失败，请稍后重试。",
  admin_not_found:"管理员账号不存在，可能已被其他所有者删除。",
  cannot_delete_self:"不能删除当前登录的管理员账号。",
  owner_account_protected:"所有者账号受到保护，不能通过此操作删除。",
  admin_account_delete_conflict:"管理员账号状态已变化，请刷新管理员列表后重试。",
  admin_account_delete_failed:"删除管理员账号失败，请检查 Worker 日志。",
  admin_username_exists:"用户名已存在。",
  admin_password_too_weak:"管理员密码至少需要14位。",
  donation_nickname_invalid:"赞助昵称需填写 1–40 个字符，且不能包含控制字符。",
  donation_amount_invalid:"金额必须在 0.01 元至 1,000,000 元之间，最多保留两位小数。",
  donation_order_invalid:"显示顺序必须是 -10000 至 10000 之间的整数。",
  donation_payload_invalid:"赞助记录格式不正确，请刷新页面后重试。",
  donation_not_found:"这条赞助记录已不存在，请刷新名单。",
  donation_save_failed:"保存赞助记录失败，请稍后重试。",
  donation_delete_failed:"删除赞助记录失败，请稍后重试。"
};
function errorMessage(error){
  const message=ERROR_MESSAGES[error?.message]||"操作失败，请稍后重试。";
  const details=[];
  if(error?.status)details.push("HTTP "+error.status);
  if(Number.isInteger(error?.payload?.upstreamStatus))details.push("GitHub HTTP "+error.payload.upstreamStatus);
  return details.length?message+"（"+details.join("；")+"）":message;
}
function showError(id,error){
  const element=$(id);
  if(element) element.textContent=errorMessage(error);
}
function has(permission){return !!current?.permissions?.includes(permission);}
function setActiveAdminNav(targetId){
  document.querySelectorAll("[data-admin-nav]").forEach(button=>{
    const active=button.dataset.navTarget===targetId;
    button.classList.toggle("active",active);
    if(active)button.setAttribute("aria-current","page");
    else button.removeAttribute("aria-current");
    if(active && window.matchMedia("(max-width: 760px)").matches){
      button.scrollIntoView({behavior:"smooth",block:"nearest",inline:"nearest"});
    }
  });
}
function showAdminView(targetId,{pushHistory=false,replaceHistory=false}={}){
  const target=$(targetId);
  if(!target||!has(target.dataset.viewPermission))return false;
  document.querySelectorAll("[data-admin-view]").forEach(panel=>{
    panel.hidden=panel!==target||!has(panel.dataset.viewPermission);
  });
  setActiveAdminNav(targetId);
  if(pushHistory && location.hash!=="#"+targetId){
    history.pushState({adminView:targetId},"","#"+targetId);
  }else if(replaceHistory && location.hash!=="#"+targetId){
    history.replaceState({adminView:targetId},"","#"+targetId);
  }
  return true;
}
function syncAdminNavigation(){
  const nav=$("adminSectionNav");
  if(!nav)return;
  const buttons=Array.from(nav.querySelectorAll("[data-admin-nav]"));
  let firstVisible="";
  for(const button of buttons){
    const allowed=has(button.dataset.navPermission);
    button.hidden=!allowed;
    if(allowed&&!firstVisible)firstVisible=button.dataset.navTarget;
  }
  nav.hidden=!buttons.some(button=>!button.hidden);
  const panels=Array.from(document.querySelectorAll("[data-admin-view]"));
  for(const panel of panels)panel.hidden=true;
  const requested=location.hash.slice(1);
  const selected=buttons.find(button=>!button.hidden&&button.dataset.navTarget===requested)?.dataset.navTarget||firstVisible;
  if(selected)showAdminView(selected,{replaceHistory:true});
}
function setPanelFailure(target,message){
  const element=$(target);
  if(element) element.textContent=message;
}
async function enter(options={}){
  let identity;
  try {
    identity=await req("/admin/me");
  } catch(error) {
    current=null;
    $("adminLogin").hidden=false;
    $("dashboard").hidden=true;
    if(options.afterLogin && error.status===401){
      $("adminMsg").textContent="密码已被登录接口接受，但随后读取管理员会话返回 401。浏览器没有保存或回传管理员 Cookie。请检查登录响应 Set-Cookie、后续请求 Cookie，以及 API 的 CORS 凭据配置；不要重复重置密码。";
    } else if(error.status===401){
      $("adminMsg").textContent="";
    } else {
      showError("adminMsg",error);
    }
    return false;
  }

  current=identity.admin;
  $("adminLogin").hidden=true;
  $("dashboard").hidden=false;
  $("adminMsg").textContent="";
  $("adminIdentity").textContent=current.username;
  $("adminRole").textContent=({owner:"所有者",admin:"普通管理员"}[current.role]||current.role);
  syncAdminNavigation();
  if(!overviewRefreshTimer){
    overviewRefreshTimer=setInterval(()=>{
      if(current&&$("dashboard")&&!$("dashboard").hidden&&has("overview")){
        Promise.all([loadOverview(),loadTeams()]).catch(error=>console.warn("Automatic team refresh failed",error?.message||"unknown"));
      }
    },30000);
  }

  // Authentication is complete at /admin/me. A later panel failure must not
  // send a valid administrator back to the login screen.
  const jobs=[
    ["overview",loadOverview,()=>setPanelFailure("summary","统计暂时无法加载。")],
    ["teams",loadTeams,()=>setPanelFailure("teamsMeta","高校团队加载失败，请检查高校目录元数据和报名统计接口。")],
    ["people",()=>has("people:read")?loadPeople():Promise.resolve(),()=>setPanelFailure("peopleMeta","名单加载失败，请检查 people:read 权限及接口响应。")],
    ["audit",()=>has("audit:read")?loadAudit():Promise.resolve(),()=>setPanelFailure("auditRows","审计记录加载失败，请稍后刷新。")],
    ["admins",()=>has("admins:manage")?loadAdmins():Promise.resolve(),()=>setPanelFailure("createAdminMsg","管理员账户列表加载失败。")],
    ["universityReviews",()=>has("universities:review")?loadUniversityReviews():Promise.resolve(),()=>setPanelFailure("universityReviewMsg","海外高校审核队列加载失败。")],
    ["groupChatQr",()=>has("group-chat:manage")?loadGroupQrAssets():Promise.resolve(),()=>setPanelFailure("groupQrAssetList","群聊二维码配置加载失败，请检查 GROUP_QR R2 绑定。")],
    ["donations",()=>has("donations:manage")?loadDonations():Promise.resolve(),()=>setPanelFailure("donationAdminMsg","赞助名单加载失败。")],
    ["backups",()=>has("backups:manage")?loadBackups():Promise.resolve(),()=>setPanelFailure("backupAdminMsg","数据库备份列表加载失败。")]
  ];
  const results=await Promise.allSettled(jobs.map(job=>job[1]()));
  results.forEach((result,index)=>{
    if(result.status==="rejected"){
      jobs[index][2]();
      const panelName={overview:"统计",teams:"高校团队",people:"名单",audit:"审计",admins:"管理员列表",universityReviews:"海外高校审核",groupChatQr:"群聊二维码",donations:"赞助名单"}[jobs[index][0]];
      console.error("Admin panel load failed:",jobs[index][0],result.reason?.message||"unknown");
      const status=$("adminPanelStatus");
      if(status) status.textContent="已登录；部分面板加载失败："+panelName+"。这不影响当前登录会话。";
    }
  });
  if(results.every(result=>result.status==="fulfilled")){
    const status=$("adminPanelStatus");
    if(status) status.textContent="管理员会话正常。";
  }
  return true;
}

async function loadOverview(){
  const data=await req("/admin/overview"),counts=data.counts||{};
  $("summary").innerHTML=
    '<div class="stat"><small>账号总数</small><b>'+Number(counts.total||0)+'</b></div>'+
    '<div class="stat"><small>已完成高校登记</small><b>'+Number(counts.completed||0)+'</b></div>'+
    '<div class="stat"><small>资料同意记录</small><b>'+Number(counts.consented||0)+'</b></div>'+
    '<div class="stat"><small>当前有成员的大学团队</small><b>'+Number(data.teamCount||0)+'</b></div>';
}
function parseTeamJsonArray(value){
  try{
    const parsed=JSON.parse(value||"[]");
    return Array.isArray(parsed)?parsed.filter(item=>typeof item==="string"):[];
  }catch{return [];}
}
function teamLevelLabels(team){
  const tags=parseTeamJsonArray(team.projectTagsJson);
  const labels=[];
  if(tags.includes("project_985_legacy"))labels.push("985");
  if(tags.includes("project_211_legacy"))labels.push("211");
  if(tags.includes("double_first_class_round1")||tags.includes("double_first_class_round2"))labels.push("双一流");
  if(!labels.length)labels.push("其他 / 未标注");
  return labels;
}
function teamDegreeLabels(team){
  const levels=parseTeamJsonArray(team.degreeLevelsJson);
  const labels=[];
  if(levels.includes("undergraduate")||team.educationLevel==="undergraduate")labels.push("本科");
  if(levels.includes("postgraduate"))labels.push("研究生");
  if(levels.includes("doctoral"))labels.push("博士");
  return labels.length?labels:["学历层级未标注"];
}
function renderTeamCard(team){
  const category=({mainland:"中国内地",hmt:"港澳台",overseas:"海外",unclassified:"未分类"})[team.universityCategory]||"高校";
  const badges=teamLevelLabels(team).concat(teamDegreeLabels(team));
  return '<article class="admin-team-card">'+
    '<div class="admin-team-card-heading"><b>'+safe(team.university||"未命名高校")+'</b><span>'+safe(team.region||"地区未填写")+'</span></div>'+
    '<div class="admin-team-card-tags">'+badges.map(label=>'<span>'+safe(label)+'</span>').join("")+'<span>'+safe(category)+'</span></div>'+
    '<strong>'+Number(team.memberCount||0)+' <small>位报名同学</small></strong>'+
    '<p>组长：'+safe(team.leaderName||"待指定")+'</p>'+
  '</article>';
}
function readTeamFilters(){
  teamFilters={
    q:$("teamQuery").value.trim(),
    region:$("teamRegion").value,
    level:$("teamLevel").value,
    minMembers:$("teamMinMembers").value.trim(),
    maxMembers:$("teamMaxMembers").value.trim()
  };
}
function teamParams(){
  const query=new URLSearchParams({page:String(teamPage),pageSize:String(teamPageSize)});
  for(const [key,value] of Object.entries(teamFilters))if(value!=="")query.set(key,value);
  return query;
}
async function loadTeams(){
  const data=await req("/admin/teams?"+teamParams());
  const regions=Array.isArray(data.filterOptions?.regions)?data.filterOptions.regions:[];
  const selectedRegion=$("teamRegion").value||teamFilters.region||"";
  if(regions.join("|")!==teamRegionOptions.join("|")){
    teamRegionOptions=regions;
    $("teamRegion").innerHTML='<option value="">全部地区</option>'+
      regions.map(region=>'<option value="'+safe(region)+'">'+safe(region)+'</option>').join("");
  }
  $("teamRegion").value=regions.includes(selectedRegion)?selectedRegion:"";
  teamTotalPages=Math.max(1,Number(data.pagination?.totalPages)||1);
  if(teamPage>teamTotalPages){
    teamPage=teamTotalPages;
    return loadTeams();
  }
  const items=Array.isArray(data.items)?data.items:[];
  $("teamsGrid").innerHTML=items.map(renderTeamCard).join("")||
    '<div class="directory-empty"><strong>没有符合条件的高校团队</strong><p>尝试放宽地区、层级或报名人数条件。</p></div>';
  const total=Number(data.pagination?.total)||0;
  const start=total?((teamPage-1)*teamPageSize+1):0;
  const end=Math.min(teamPage*teamPageSize,total);
  $("teamsMeta").textContent="共 "+total+" 支高校团队"+
    (total?"，当前显示第 "+start+"–"+end+" 支。":"。")+
    " 地区与层级来自高校目录，报名人数按当前有效账号统计。";
  $("teamPageLabel").textContent="第 "+teamPage+" / "+teamTotalPages+" 页 · 共 "+total+" 支";
  $("teamFirstPage").disabled=teamPage<=1;
  $("teamPrevPage").disabled=teamPage<=1;
  $("teamNextPage").disabled=teamPage>=teamTotalPages;
  $("teamLastPage").disabled=teamPage>=teamTotalPages;
}
function readFilters(){
  filters={
    q:$("q").value.trim(),
    province:$("province").value.trim(),
    university:$("university").value.trim(),
    grade:$("grade").value.trim(),
    category:$("category").value
  };
}
function params(extra={}){
  const query=new URLSearchParams({page:String(page),pageSize:String(pageSize)});
  for(const [key,value] of Object.entries({...filters,...extra})) if(value) query.set(key,value);
  return query;
}
function profileDetailField(label,value){
  return '<div class="admin-profile-field"><small>'+safe(label)+'</small><b>'+safe(value||"未填写")+'</b></div>';
}
function profileReviewLabel(item){
  if(item.profileReviewStatus==="pending")return "海外高校待审核";
  if(item.profileReviewStatus==="rejected")return "海外高校审核未通过";
  return item.university?"已完成高校归属":"尚未选择高校";
}
function renderProfilePreview(item){
  const gender=({male:"男",female:"女",undisclosed:"不愿透露"})[item.gender]||"性别未填";
  const major=item.majorDiscipline||"专业未填";
  const admission=item.admissionCategory||"招生大类未填";
  const campus=[item.campusName,item.campusTag].filter(Boolean).join(" · ");
  const greeting=String(item.greeting||"").trim();
  const greetingText=greeting.length>34?greeting.slice(0,34)+"…":greeting;
  return '<div class="admin-profile-preview">'+
    '<span>'+safe(gender)+'</span><span>'+safe(major)+'</span><span>'+safe(admission)+'</span>'+
    (campus?'<span>'+safe(campus)+'</span>':'')+
    (greetingText?'<small>寄语：'+safe(greetingText)+'</small>':'')+
  '</div>';
}
function groupChatStatusMarkup(item){
  const status=item.groupChatStatus||"unavailable";
  const variant=status==="confirmed"?"confirmed":status==="pending"||status==="reconfirm"?"pending":"missing";
  return '<div class="group-chat-roster-cell"><span class="group-chat-roster-status '+variant+'">'+safe(item.groupChatStatusLabel||"状态未知")+'</span>'+
    (item.groupChatRegionLabel?'<small>'+safe(item.groupChatRegionLabel)+'</small>':"")+'</div>';
}
function renderPersonDetails(item){
  const gender=({male:"男",female:"女",undisclosed:"不愿透露"})[item.gender]||"未填写";
  const category=({mainland:"中国内地",hmt:"港澳台",sino_foreign:"中外合作办学",overseas:"海外"})[item.universityCategory]||"未选择";
  const campus=[item.campusName,item.campusTag].filter(Boolean).join(" · ");
  return '<div class="admin-person-details" id="person-details-'+safe(item.id)+'" data-profile-detail-row="'+safe(item.id)+'" hidden>'+
    '<div class="admin-profile-details">'+
    profileDetailField("用户编号",item.id)+profileDetailField("性别",gender)+profileDetailField("高中学校",item.highSchool)+
    profileDetailField("当前大学",item.university||"尚未选择高校")+profileDetailField("高校类别",category)+profileDetailField("年级",item.grade)+
    profileDetailField("地区",[item.province,item.city].filter(Boolean).join(" · "))+profileDetailField("专业学科门类",item.majorDiscipline)+
    profileDetailField("招生大类",item.admissionCategory)+profileDetailField("校区",campus)+
    profileDetailField("群聊归属地区",item.groupChatRegionLabel)+profileDetailField("入群确认状态",item.groupChatStatusLabel)+
    profileDetailField("入群确认时间",item.groupChatConfirmedAt)+
    profileDetailField("海外高校填写",item.overseasUniversityName)+profileDetailField("高校审核状态",profileReviewLabel(item))+
    profileDetailField("资料隐私版本",item.consentVersion)+profileDetailField("账号隐私版本",item.accountConsentVersion)+
    profileDetailField("资料更新时间",item.updatedAt)+
    '<div class="admin-profile-field admin-profile-greeting"><small>寄语</small><p>'+safe(item.greeting||"未填写")+'</p></div>'+
    '</div></div>';
}
async function loadPeople(){
  let data=await req("/admin/people?"+params());
  let pagination=data.pagination||{};
  totalPages=Math.max(1,Number(pagination.totalPages)||1);
  if(page>totalPages){
    page=totalPages;
    data=await req("/admin/people?"+params());
    pagination=data.pagination||{};
    totalPages=Math.max(1,Number(pagination.totalPages)||1);
  }
  const items=data.items||[];
  $("peopleMeta").textContent="共 "+(pagination.total||0)+" 条账号记录。每位同学以独立卡片展示高校、年级、地区、入群确认和资料摘要；点击“完整资料”查看详细信息。手机号、第二手机号、微信号和密码不会在管理员页面或导出中展示。";
  $("peopleRows").innerHTML=items.map(item=>{
    const school=item.university||"尚未选择高校";
    const state=item.profileReviewStatus==="pending"?"待审核":"";
    const province=item.province||"暂无地区";
    const grade=item.grade||"年级未填写";
    const name=item.name||"未填写";
    const consent=item.consentGiven?"已同意资料使用":"未同意资料使用";
    return '<article class="admin-person-card" data-person-card="'+safe(item.id)+'">'+
      '<header class="admin-person-card-heading">'+
        '<div class="admin-person-identity"><h4>'+safe(name)+'</h4></div>'+
      '</header>'+
      '<div class="admin-person-high-school admin-person-info-box"><small>高中</small><strong>'+safe(item.highSchool||"高中学校未填写")+'</strong></div>'+
      '<div class="admin-person-grade admin-person-info-box"><small>当前年级</small><strong>'+safe(grade)+'</strong></div>'+
      '<div class="admin-person-university"><small>当前高校</small><b>'+safe(school)+
        (state?'<span class="admin-person-review-state">'+safe(state)+'</span>':"")+'</b></div>'+
      '<div class="admin-person-facts">'+
        '<div><small>所在省份 / 地区</small><strong>'+safe(province)+'</strong></div>'+
        '<div><small>入群确认</small>'+groupChatStatusMarkup(item)+'</div>'+
        '<div><small>资料授权</small><strong class="admin-person-consent">'+safe(consent)+'</strong></div>'+
        '<div><small>登记时间</small><strong>'+safe(item.createdAt||"未记录")+'</strong></div>'+
      '</div>'+
      renderProfilePreview(item)+
      '<div class="admin-person-actions">'+
        '<button type="button" class="ghost admin-detail-toggle" data-profile-toggle="'+safe(item.id)+'" aria-controls="person-details-'+safe(item.id)+'" aria-expanded="false">完整资料</button>'+
        (has("people:delete")?'<button type="button" class="admin-delete-button" data-person-delete="'+safe(item.id)+'" data-person-name="'+safe(name)+'">删除报名</button>':"")+
      '</div>'+
      renderPersonDetails(item)+
    '</article>';
  }).join("")||'<div class="admin-roster-empty">没有符合条件的报名记录</div>';
  $("pageLabel").textContent="第 "+(pagination.page||page)+" / "+totalPages+" 页 · 本页 "+items.length+" 条 · 共 "+(pagination.total||0)+" 条";
  $("firstPage").disabled=page<=1;
  $("prevPage").disabled=page<=1;
  $("nextPage").disabled=page>=totalPages;
  $("lastPage").disabled=page>=totalPages;
}
async function loadAudit(){
  const data=await req("/admin/audit?page=1&pageSize=10");
  $("auditRows").innerHTML=(data.items||[]).slice(0,10).map(item=>
    '<tr><td>'+safe(item.createdAt)+'</td><td>'+safe(item.actorUsername||item.actorType)+'</td><td>'+safe(item.action)+'</td><td>'+safe(item.targetType)+' / '+safe(item.targetId)+'</td><td>'+safe(item.metadata)+'</td></tr>'
  ).join("")||'<tr><td colspan="5">暂无审计记录</td></tr>';
}

function formatBackupBytes(value){
  const bytes=Number(value||0);
  if(bytes>=1024*1024*1024)return (bytes/1024/1024/1024).toFixed(2)+" GB";
  if(bytes>=1024*1024)return (bytes/1024/1024).toFixed(2)+" MB";
  if(bytes>=1024)return (bytes/1024).toFixed(1)+" KB";
  return bytes+" B";
}
function backupStatusLabel(status){
  return ({running:"进行中",completed:"已完成",failed:"失败"})[status]||"未知状态";
}
async function loadBackups(){
  const data=await req("/admin/backups");
  const flags=[
    ["后台触发 GitHub Actions",data.dispatchConfigured],
    ["Worker 清单校验密钥",data.encryptionConfigured]
  ];
  $("backupConfigStatus").textContent=flags.map(([name,ok])=>name+"："+(ok?"已配置":"未配置")).join("　·　")+
    "　·　R2 存储由服务端检查";
  const items=data.items||[];
  $("backupRows").innerHTML=items.map(item=>{
    const passed=item.verification==="passed";
    const verification=item.verification==="passed"?"完整性验证通过":item.verification==="failed"?"完整性验证失败":"尚未验证";
    const statusClass=item.status==="completed"?"backup-state-success":item.status==="failed"?"backup-state-failed":"backup-state-running";
    const actions=item.status==="completed"?
      '<button type="button" class="ghost" data-backup-action="verify" data-backup-id="'+safe(item.backupId)+'">验证完整性</button>'+
      '<button type="button" class="ghost" data-backup-action="download" data-backup-id="'+safe(item.backupId)+'">下载加密文件</button>'+
      '<button type="button" class="ghost" data-backup-action="manifest" data-backup-id="'+safe(item.backupId)+'">下载清单</button>':'';
    const deleteAction=item.status!=="running"?
      '<button type="button" class="admin-delete-button" data-backup-action="delete" data-backup-id="'+safe(item.backupId)+'">删除</button>':'';

    return '<article class="backup-card"><div class="backup-card-heading"><div><b>'+safe(item.createdAt)+'</b><small>'+safe(item.source==="scheduled"?"每日自动备份":item.source==="manual"?"手动备份":"系统任务")+'</small></div><span class="'+statusClass+'">'+backupStatusLabel(item.status)+'</span></div>'+
      '<div class="backup-card-meta"><span>明文大小：'+formatBackupBytes(item.plaintextBytes)+'</span><span>加密大小：'+formatBackupBytes(item.ciphertextBytes)+'</span><span>加密分块：'+safe(item.partCount)+'</span></div>'+
      '<div class="backup-card-verification">'+safe(verification)+(item.verifiedAt?" · "+safe(item.verifiedAt):"")+(item.errorCode?" · "+safe(item.errorCode):"")+'</div>'+
      '<div class="backup-card-actions">'+actions+deleteAction+'</div></article>';
  }).join("")||'<div class="muted">暂时没有备份记录。完成首次配置后，可以手动触发一次备份进行验证。</div>';
  if(data.unreadable)$("backupAdminMsg").textContent="有 "+data.unreadable+" 条备份清单无法通过签名验证，已从列表隐藏；请勿删除或覆盖相关 R2 对象。";
  else $("backupAdminMsg").textContent=data.truncated?"备份列表只显示最近 100 条记录。":"";
}
async function downloadBackupArtifact(backupId,kind){
  const response=await fetch(API+"/admin/backups/"+encodeURIComponent(backupId)+"/"+kind,{
    credentials:"include",headers:{}
  });
  if(!response.ok){
    let payload={};try{payload=await response.json();}catch{}
    const error=new Error(payload.error||"backup_management_failed");error.status=response.status;throw error;
  }
  const blob=await response.blob();
  const filename="qd58-d1-"+backupId+(kind==="manifest"?".manifest.json":".qd58enc");
  const url=URL.createObjectURL(blob);
  try{
    const link=document.createElement("a");link.href=url;link.download=filename;
    document.body.appendChild(link);link.click();link.remove();
  }finally{setTimeout(()=>URL.revokeObjectURL(url),1000);}
}
async function startManualBackup(){
  $("createBackup").disabled=true;
  $("backupAdminMsg").textContent="正在提交备份任务……";
  try{
    const result=await req("/admin/backups",{});
    $("backupAdminMsg").textContent="GitHub Actions 备份任务已触发："+result.backupId+"。完成后刷新列表即可查看。"+(result.auditRecorded===false?"（注意：审计记录写入失败，请查看 Worker 日志。）":"");
    await loadBackups();
  }catch(error){showError("backupAdminMsg",error);}
  finally{$("createBackup").disabled=false;}
}
async function handleBackupAction(action,backupId){
  try{
    if(action==="download"||action==="manifest"){
      await downloadBackupArtifact(backupId,action);
      return;
    }
    if(action==="verify"){
      if(!window.confirm("将读取并解密这份备份的每个分块，检查 AES-GCM 认证标签和 SHA-256 摘要。不会修改 D1。继续吗？"))return;
      const result=await req("/admin/backups/"+backupId+"/verify",{});
      $("backupAdminMsg").textContent="GitHub Actions 完整性验证已触发，请稍后刷新。"+(result.auditRecorded===false?"（注意：审计记录写入失败，请查看 Worker 日志。）":"");
      return;
    }
    if(action==="delete"){
      if(!window.confirm("确定删除这份 R2 加密备份及其清单吗？此操作不可撤销。系统会保护最后一份成功备份。"))return;
      const result=await req("/admin/backups/"+backupId,null,"DELETE");
      $("backupAdminMsg").textContent="备份已删除。"+(result.auditRecorded===false?"（注意：审计记录写入失败，请查看 Worker 日志。）":"");
      await loadBackups();
    }
  }catch(error){showError("backupAdminMsg",error);}
}
const formatQrSize=value=>{
  const bytes=Number(value||0);
  return bytes>=1024*1024?(bytes/1024/1024).toFixed(2)+" MB":Math.max(1,Math.round(bytes/1024))+" KB";
};
async function loadGroupQrAssets(){
  const data=await req("/admin/group-chat/qr");
  const regions=data.regions||[];
  const options=regions.map(item=>'<option value="'+safe(item.key)+'">'+safe(item.label)+'</option>').join("");
  const currentQrRegion=$("groupQrRegion").value;
  $("groupQrRegion").innerHTML=options;
  if(regions.some(item=>item.key===currentQrRegion))$("groupQrRegion").value=currentQrRegion;
  $("groupQrAssetList").innerHTML=regions.map(item=>
    '<article class="group-qr-asset-card"><div><b>'+safe(item.label)+'</b><span class="'+(item.configured?"group-qr-ready":"group-qr-missing")+'">'+(item.configured?"已上传":"未上传")+'</span></div>'+
    (item.asset?'<small>'+safe(item.asset.fileName)+' · '+formatQrSize(item.asset.sizeBytes)+'</small><small>更新时间：'+safe(item.asset.uploadedAt||"")+'</small>':'<small>尚未配置该区域二维码</small>')+
    '<div class="group-qr-card-actions"><button type="button" class="ghost" data-qr-select="'+safe(item.key)+'">选择此区域</button>'+
    (item.configured?'<button type="button" class="admin-delete-button" data-qr-delete="'+safe(item.key)+'" data-qr-label="'+safe(item.label)+'">删除二维码</button>':'')+
    '</div></article>'
  ).join("");
}
async function uploadGroupQr(){
  const regionKey=$("groupQrRegion").value,file=$("groupQrFile").files?.[0];
  if(!regionKey)return showError("groupQrUploadMsg",new Error("group_qr_region_invalid"));
  if(!file)return showError("groupQrUploadMsg",new Error("group_qr_file_empty"));
  if(file.size>5*1024*1024)return showError("groupQrUploadMsg",new Error("group_qr_file_too_large"));
  if(!["image/png","image/jpeg","image/webp"].includes(file.type))return showError("groupQrUploadMsg",new Error("group_qr_image_type_invalid"));
  const button=$("uploadGroupQr");button.disabled=true;
  $("groupQrUploadMsg").textContent="正在上传二维码…";
  try{
    const response=await fetch(API+"/admin/group-chat/qr/"+encodeURIComponent(regionKey)+"?fileName="+encodeURIComponent(file.name),{
      method:"PUT",credentials:"include",headers:{"Content-Type":file.type},body:file,cache:"no-store"
    });
    let payload={};try{payload=await response.json()}catch{}
    if(!response.ok){const error=new Error(payload.error||"group_qr_upload_failed");error.status=response.status;throw error;}
    $("groupQrFile").value="";
    $("groupQrUploadMsg").textContent=payload.regionLabel+"二维码已保存到 R2。";
    await loadGroupQrAssets();
  }catch(error){showError("groupQrUploadMsg",error);}
  finally{button.disabled=false;}
}
async function loadUniversityReviews(){
  const data=await req("/admin/universities/review/pending");
  const rows=data.items||[];
  $("universityReviewRows").innerHTML=rows.map(item=>
    '<article class="admin-review-card" data-review-card="'+safe(item.id)+'">'+
      '<div class="admin-review-summary"><div><b>'+safe(item.name||"未填写姓名")+'</b><small>'+safe(item.highSchool||"")+' · '+safe(item.grade||"")+'</small></div>'+
      '<span class="demo-status pending">待审核</span></div>'+
      '<p>学生填写：<strong>'+safe(item.submittedName||"")+'</strong></p>'+
      '<small>提交时间：'+safe(item.submittedAt||item.createdAt||"")+'</small>'+
      '<label>规范后的学校名称<input data-review-name="'+safe(item.id)+'" maxlength="160" value="'+safe(item.submittedName||"")+'" placeholder="核对后填写标准校名"></label>'+
      '<div class="admin-actions"><button type="button" class="btn" data-review-action="approve" data-review-id="'+safe(item.id)+'">审核通过并加入团队</button><button type="button" class="ghost" data-review-action="reject" data-review-id="'+safe(item.id)+'">拒绝</button></div>'+
    '</article>'
  ).join("")||'<div class="directory-empty"><strong>当前没有待审核高校</strong><p>新提交的海外高校资料会显示在这里。</p></div>';
  $("universityReviewMsg").textContent="待审核 "+rows.length+" 条。批准时若存在规范名称相同的海外高校，将自动归并到已有团队。";
}
async function loadAdmins(){
  const data=await req("/admin/admins");
  $("adminAccounts").innerHTML=(data.items||[]).map(item=>{
    const roleLabel=item.role==="owner"?"所有者":item.role==="viewer"?"历史只读账号（待删除）":"普通管理员";
    const actions=item.role==="owner"
      ? '<span class="muted">所有者账号受保护</span>'
      : (item.role==="admin"?
          '<button type="button" class="ghost" data-admin-id="'+safe(item.id)+'" data-active="'+(!item.active)+'">'+(item.active?"停用":"重新启用")+'</button>'
          :"")+
        '<button type="button" class="admin-delete-button" data-admin-delete="'+safe(item.id)+'" data-admin-name="'+safe(item.username)+'">删除账号</button>';
    return '<div class="admin-account"><div><b>'+safe(item.username)+'</b><small>'+roleLabel+' · '+(item.active?"启用":"停用")+' · 最近登录：'+safe(item.lastLoginAt||"从未")+'</small></div><div class="admin-actions">'+actions+'</div></div>';
  }).join("");
}

let adminDonationRows=[];
function donationYuan(cents){return (Number(cents||0)/100).toFixed(2);}
async function loadDonations(){
  const data=await req("/admin/donations");
  adminDonationRows=data.items||[];
  renderDonationAdminRows();
  $("donationAdminMsg").textContent="当前共有 "+adminDonationRows.length+" 条公开赞助记录。";
}
function renderDonationAdminRows(){
  const container=$("donationAdminRows");
  container.innerHTML=adminDonationRows.map(item=>
    '<article class="donation-admin-row" data-donation-row="'+safe(item.id)+'">'+
      '<div class="donation-admin-fields">'+
        '<label>赞助昵称<input data-donation-nickname maxlength="40" value="'+safe(item.nickname)+'"></label>'+
        '<label>金额（元）<input data-donation-amount type="number" min="0.01" max="1000000" step="0.01" value="'+donationYuan(item.amountCents)+'"></label>'+
        '<label>显示顺序<input data-donation-order type="number" min="-10000" max="10000" step="1" value="'+Number(item.displayOrder||0)+'"></label>'+
      '</div>'+
      '<div class="donation-admin-actions"><button type="button" class="btn" data-donation-save="'+safe(item.id)+'">保存修改</button><button type="button" class="admin-delete-button" data-donation-delete="'+safe(item.id)+'" data-donation-name="'+safe(item.nickname)+'">删除记录</button></div>'+
    '</article>'
  ).join("")||'<div class="directory-empty"><strong>目前还没有赞助记录</strong><p>可以在上方录入第一条记录。保存后会自动显示在同校同学页面。</p></div>';
}
async function saveDonationRow(button){
  const id=button.dataset.donationSave,row=button.closest("[data-donation-row]");
  if(!row)return;
  const nickname=row.querySelector("[data-donation-nickname]").value.trim();
  const amount=Number(row.querySelector("[data-donation-amount]").value);
  const displayOrder=Number(row.querySelector("[data-donation-order]").value);
  if(!Number.isFinite(amount)||Math.abs(amount*100-Math.round(amount*100))>0.000001){
    $("donationAdminMsg").textContent="金额最多只能保留两位小数。";return;
  }
  const payload={nickname,amountCents:Math.round(amount*100),displayOrder};
  button.disabled=true;
  try{
    await req("/admin/donations/"+encodeURIComponent(id),payload,"PUT");
    $("donationAdminMsg").textContent="「"+nickname+"」的赞助记录已更新，前台名单已同步。";
    await loadDonations();
  }catch(error){showError("donationAdminMsg",error);button.disabled=false;}
}
async function deleteDonationRow(button){
  const id=button.dataset.donationDelete,nickname=button.dataset.donationName||"这条记录";
  if(!confirm("确定删除「"+nickname+"」的赞助记录？删除后前台名单会同步移除。"))return;
  button.disabled=true;
  try{
    await req("/admin/donations/"+encodeURIComponent(id),null,"DELETE");
    $("donationAdminMsg").textContent="赞助记录已删除，前台名单已同步。";
    await loadDonations();
  }catch(error){showError("donationAdminMsg",error);button.disabled=false;}
}

const adminSidebarMedia=window.matchMedia("(max-width:760px)");
function setAdminSidebarCollapsed(collapsed){
  const workspace=$("adminWorkspace");
  const toggle=$("adminSidebarToggle");
  if(!workspace||!toggle)return;
  workspace.classList.toggle("is-sidebar-collapsed",collapsed);
  toggle.setAttribute("aria-expanded",String(!collapsed));
  toggle.setAttribute("aria-label",collapsed?"展开功能导航":"收起功能导航");
  $("adminSidebarToggleLabel").textContent=collapsed?"展开导航":"收起导航";
}
setAdminSidebarCollapsed(adminSidebarMedia.matches);
$("adminSidebarToggle").addEventListener("click",()=>{
  const collapsed=$("adminWorkspace").classList.contains("is-sidebar-collapsed");
  setAdminSidebarCollapsed(!collapsed);
});
const handleAdminSidebarViewportChange=event=>setAdminSidebarCollapsed(event.matches);
if(typeof adminSidebarMedia.addEventListener==="function"){
  adminSidebarMedia.addEventListener("change",handleAdminSidebarViewportChange);
}else if(typeof adminSidebarMedia.addListener==="function"){
  adminSidebarMedia.addListener(handleAdminSidebarViewportChange);
}

$("adminSectionNav").addEventListener("click",event=>{
  const button=event.target.closest("[data-admin-nav]");
  if(!button||button.hidden)return;
  const shown=showAdminView(button.dataset.navTarget,{pushHistory:true});
  if(shown)$(button.dataset.navTarget).scrollIntoView({behavior:"smooth",block:"start"});
});
window.addEventListener("popstate",()=>{
  if(current&&$("dashboard")&&!$("dashboard").hidden)syncAdminNavigation();
});




$("donationCreateForm").onsubmit=async event=>{
  event.preventDefault();
  const nickname=$("donationNewNickname").value.trim();
  const amount=Number($("donationNewAmount").value);
  const displayOrder=Number($("donationNewOrder").value||0);
  if(!Number.isFinite(amount)||Math.abs(amount*100-Math.round(amount*100))>0.000001){
    $("donationAdminMsg").textContent="金额最多只能保留两位小数。";return;
  }
  const button=$("donationCreateSubmit");button.disabled=true;
  try{
    await req("/admin/donations",{nickname,amountCents:Math.round(amount*100),displayOrder});
    $("donationCreateForm").reset();
    $("donationNewOrder").value=String(Math.max(0,...adminDonationRows.map(item=>Number(item.displayOrder)||0))+10);
    $("donationAdminMsg").textContent="已新增「"+nickname+"」的赞助记录，前台名单已同步。";
    await loadDonations();
  }catch(error){showError("donationAdminMsg",error);}
  finally{button.disabled=false;}
};
$("refreshDonations").onclick=()=>loadDonations().catch(error=>showError("donationAdminMsg",error));
$("donationAdminRows").addEventListener("click",async event=>{
  const saveButton=event.target.closest("[data-donation-save]");
  if(saveButton){await saveDonationRow(saveButton);return;}
  const deleteButton=event.target.closest("[data-donation-delete]");
  if(deleteButton)await deleteDonationRow(deleteButton);
});
$("adminLogin").onsubmit=async event=>{
  event.preventDefault();
  const submit=$("adminLogin").querySelector('button[type="submit"]')||$("adminLogin").querySelector("button");
  submit.disabled=true;
  $("adminMsg").textContent="正在验证管理员凭据…";
  try {
    await req("/admin/login",{username:$("username").value.trim(),password:$("password").value});
    $("password").value="";
    $("adminMsg").textContent="凭据验证成功，正在确认管理员会话…";
    await enter({afterLogin:true});
  } catch(error) {
    showError("adminMsg",error);
  } finally {
    submit.disabled=false;
  }
};
$("adminLogout").onclick=async()=>{
  try { await req("/admin/logout",{}); }
  catch(error) { console.error("Admin logout failed:",error?.message||"unknown"); }
  finally { location.reload(); }
};
$("peopleRows").addEventListener("click",async event=>{
  const deleteButton=event.target.closest("[data-person-delete]");
  if(deleteButton){
    const userId=deleteButton.dataset.personDelete;
    const name=deleteButton.dataset.personName||"该同学";
    const confirmed=confirm("确定删除「"+name+"」的报名及账号？\\n\\n此操作会永久注销账号、清除个人资料并撤销登录；历史组长转让记录会保留。若该同学仍是有其他成员的团队组长，需要先转让组长身份。此操作不可撤销。");
    if(!confirmed)return;
    deleteButton.disabled=true;
    try{
      await req("/admin/people/"+encodeURIComponent(userId),null,"DELETE");
      $("adminPanelStatus").textContent="已删除「"+name+"」的报名及账号，历史组长转让记录已保留。";
      await Promise.all([loadPeople(),loadOverview(),loadTeams()]);
    }catch(error){
      $("adminPanelStatus").textContent=errorMessage(error);
      deleteButton.disabled=false;
    }
    return;
  }
  const button=event.target.closest("[data-profile-toggle]");
  if(!button)return;
  const card=button.closest("[data-person-card]");
  const details=card?.querySelector("[data-profile-detail-row]");
  if(!details)return;
  const expanded=details.hidden;
  details.hidden=!expanded;
  button.setAttribute("aria-expanded",String(expanded));
  button.textContent=expanded?"收起资料":"完整资料";
});
$("refreshAdminData").onclick=async()=>{
  const button=$("refreshAdminData");button.disabled=true;
  try{
    await Promise.all([loadOverview(),loadTeams()]);
    $("adminPanelStatus").textContent="高校团队和统计数据已刷新。";
  }catch(error){
    $("teamsMeta").textContent="刷新失败："+errorMessage(error);
    console.error("Admin team refresh failed",error?.message||"unknown");
  }finally{button.disabled=false;}
};
$("teamFilters").onsubmit=event=>{
  event.preventDefault();
  readTeamFilters();
  teamPage=1;
  loadTeams().catch(error=>showError("teamsMeta",error));
};
$("clearTeamFilters").onclick=()=>{
  $("teamFilters").reset();
  readTeamFilters();
  teamPage=1;
  loadTeams().catch(error=>showError("teamsMeta",error));
};
$("teamFirstPage").onclick=()=>{if(teamPage>1){teamPage=1;loadTeams().catch(error=>showError("teamsMeta",error));}};
$("teamPrevPage").onclick=()=>{if(teamPage>1){teamPage--;loadTeams().catch(error=>showError("teamsMeta",error));}};
$("teamNextPage").onclick=()=>{if(teamPage<teamTotalPages){teamPage++;loadTeams().catch(error=>showError("teamsMeta",error));}};
$("teamLastPage").onclick=()=>{if(teamPage<teamTotalPages){teamPage=teamTotalPages;loadTeams().catch(error=>showError("teamsMeta",error));}};
$("filters").onsubmit=async event=>{
  event.preventDefault();
  readFilters();
  page=1;
  try { await loadPeople(); } catch(error) { showError("peopleMeta",error); }
};
$("clearFilters").onclick=()=>{
  setTimeout(()=>{
    readFilters();page=1;
    loadPeople().catch(error=>showError("peopleMeta",error));
  },0);
};
$("firstPage").onclick=()=>{
  if(page>1){page=1;loadPeople().catch(error=>showError("peopleMeta",error));}
};
$("prevPage").onclick=()=>{
  if(page>1){page--;loadPeople().catch(error=>showError("peopleMeta",error));}
};
$("nextPage").onclick=()=>{
  if(page<totalPages){page++;loadPeople().catch(error=>showError("peopleMeta",error));}
};
$("lastPage").onclick=()=>{
  if(page<totalPages){page=totalPages;loadPeople().catch(error=>showError("peopleMeta",error));}
};
async function downloadRosterExport(format){
  const button=$(format==="xlsx"?"exportXlsx":"export");
  const originalText=button.textContent;
  button.disabled=true;
  $("peopleMeta").textContent=format==="xlsx"?"正在生成 Excel 文件……":"正在生成 CSV 文件……";
  try{
    readFilters();
    const query=params({format});
    const response=await fetch(API+"/admin/people?"+query,{
      method:"GET",
      mode:"cors",
      credentials:"include",
      cache:"no-store",
      headers:{Accept:format==="xlsx"
        ?"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        :"text/csv"}
    });
    if(!response.ok){
      let payload={};
      try{payload=await response.json();}catch{}
      const error=new Error(payload.error||"roster_export_failed");
      error.status=response.status;
      error.payload=payload;
      throw error;
    }
    const blob=await response.blob();
    if(!blob.size)throw new Error("roster_export_empty");
    const contentType=(response.headers.get("content-type")||"").toLowerCase();
    if(format==="xlsx"&&!contentType.includes("spreadsheetml.sheet")){
      throw new Error("roster_export_unexpected_content_type");
    }
    if(format==="csv"&&!contentType.includes("text/csv")){
      throw new Error("roster_export_unexpected_content_type");
    }
    const filename=format==="xlsx"?"zhuoyue-2026-roster.xlsx":"zhuoyue-2026-roster.csv";
    const objectUrl=URL.createObjectURL(blob);
    try{
      const link=document.createElement("a");
      link.href=objectUrl;
      link.download=filename;
      link.style.display="none";
      document.body.appendChild(link);
      link.click();
      link.remove();
    }finally{
      setTimeout(()=>URL.revokeObjectURL(objectUrl),30000);
    }
    $("peopleMeta").textContent=(format==="xlsx"?"Excel":"CSV")+" 导出完成，已按当前筛选条件生成文件。";
  }catch(error){
    showError("peopleMeta",error);
  }finally{
    button.disabled=false;
    button.textContent=originalText;
  }
}
$("export").onclick=()=>downloadRosterExport("csv");
$("exportXlsx").onclick=()=>downloadRosterExport("xlsx");
$("refreshAudit").onclick=()=>loadAudit().catch(error=>showError("auditRows",error));
$("refreshUniversityReviews").onclick=()=>loadUniversityReviews().catch(error=>showError("universityReviewMsg",error));
$("uploadGroupQr").onclick=uploadGroupQr;
$("refreshGroupQr").onclick=()=>loadGroupQrAssets().catch(error=>showError("groupQrUploadMsg",error));
$("groupQrAssetList").addEventListener("click",async event=>{
  const selectButton=event.target.closest("[data-qr-select]");
  if(selectButton){$("groupQrRegion").value=selectButton.dataset.qrSelect;$("groupQrFile").focus();return;}
  const deleteButton=event.target.closest("[data-qr-delete]");
  if(!deleteButton)return;
  const regionKey=deleteButton.dataset.qrDelete,label=deleteButton.dataset.qrLabel||"该地区";
  if(!confirm("确定删除"+label+"的群聊二维码？删除后同学端将暂时无法查看二维码。"))return;
  deleteButton.disabled=true;
  try{
    await req("/admin/group-chat/qr/"+encodeURIComponent(regionKey),null,"DELETE");
    $("groupQrUploadMsg").textContent=label+"二维码已删除。";
    await loadGroupQrAssets();
  }catch(error){showError("groupQrUploadMsg",error);deleteButton.disabled=false;}
});

$("universityReviewRows").addEventListener("click",async event=>{
  const button=event.target.closest("[data-review-action]");
  if(!button)return;
  const userId=button.dataset.reviewId,action=button.dataset.reviewAction;
  const card=button.closest("[data-review-card]");
  const input=card?.querySelector("[data-review-name]");
  const canonicalName=input?.value.trim()||"";
  if(action==="approve"&&canonicalName.length<2){
    $("universityReviewMsg").textContent="请先填写核对后的规范学校名称。";
    input?.focus();return;
  }
  button.disabled=true;
  const siblings=card?.querySelectorAll("button")||[];
  siblings.forEach(item=>item.disabled=true);
  try{
    if(action==="approve"){
      const result=await req("/admin/universities/review/"+encodeURIComponent(userId)+"/approve",{canonicalName});
      $("universityReviewMsg").textContent=result.mergedExisting
        ?"已批准并归并到现有海外高校团队。"
        :"已批准，系统创建了高校记录并建立团队。";
    }else{
      await req("/admin/universities/review/"+encodeURIComponent(userId)+"/reject",{reason:"经组织者审核未通过"});
      $("universityReviewMsg").textContent="已拒绝该条海外高校登记。";
    }
    await loadUniversityReviews();
    await Promise.all([loadOverview(),loadTeams()]);
  }catch(error){
    showError("universityReviewMsg",error);
    siblings.forEach(item=>item.disabled=false);
  }
});

$("createAdmin").onsubmit=async event=>{
  event.preventDefault();
  try {
    await req("/admin/admins",{username:$("newUsername").value.trim(),password:$("newPassword").value,role:"admin"});
    $("newPassword").value="";
    $("createAdminMsg").textContent="普通管理员账号已创建。";
    await loadAdmins();
  } catch(error) { showError("createAdminMsg",error); }
};
$("adminAccounts").onclick=async event=>{
  const deleteButton=event.target.closest("[data-admin-delete]");
  if(deleteButton){
    const id=deleteButton.dataset.adminDelete;
    const username=deleteButton.dataset.adminName||"该账号";
    if(!window.confirm("确定删除管理员“"+username+"”吗？删除后，该账号的所有登录会话都会立即失效，且无法恢复。"))return;
    try {
      await req("/admin/admins/"+id,null,"DELETE");
      $("createAdminMsg").textContent="管理员账号已删除，其登录会话已撤销。";
      await loadAdmins();
    } catch(error) { showError("createAdminMsg",error); }
    return;
  }
  const button=event.target.closest("[data-admin-id]");
  if(!button)return;
  try {
    await req("/admin/admins/"+button.dataset.adminId,{active:button.dataset.active==="true"});
    await loadAdmins();
  } catch(error) { showError("createAdminMsg",error); }
};

$("refreshBackups").onclick=()=>loadBackups().catch(error=>showError("backupAdminMsg",error));
$("createBackup").onclick=()=>{
  if(!window.confirm("现在启动一次 D1 数据库完整导出？导出期间数据库可能暂时无法响应查询。建议在低访问量时段操作。"))return;
  startManualBackup();
};
$("backupRows").onclick=event=>{
  const button=event.target.closest("[data-backup-action]");
  if(!button)return;
  handleBackupAction(button.dataset.backupAction,button.dataset.backupId);
};
window.addEventListener("DOMContentLoaded",()=>enter());

const API="https://api.58er.eon21.space/api", $=id=>document.getElementById(id);
let current=null,page=1,pageSize=10,totalPages=1,filters={},overviewRefreshTimer=null;

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
  $("adminRole").textContent="角色："+({owner:"所有者",admin:"普通管理员"}[current.role]||current.role);
  syncAdminNavigation();
  if(!overviewRefreshTimer){
    overviewRefreshTimer=setInterval(()=>{
      if(current&&$("dashboard")&&!$("dashboard").hidden&&has("overview")){
        loadOverview().catch(error=>console.warn("Automatic team refresh failed",error?.message||"unknown"));
      }
    },30000);
  }

  // Authentication is complete at /admin/me. A later panel failure must not
  // send a valid administrator back to the login screen.
  const jobs=[
    ["overview",loadOverview,()=>setPanelFailure("summary","统计暂时无法加载。")],
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
      const panelName={overview:"统计",people:"名单",audit:"审计",admins:"管理员列表",universityReviews:"海外高校审核",groupChatQr:"群聊二维码",donations:"赞助名单"}[jobs[index][0]];
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
  const teams=data.teams||[];
  $("teamsGrid").innerHTML=teams.map(team=>
    '<article class="admin-team-card"><div><b>'+safe(team.university||"未命名高校")+'</b><span>'+safe(team.leaderProvince||"地区未填写")+'</span></div>'+
    '<strong>'+Number(team.memberCount||0)+' <small>人</small></strong>'+
    '<p>组长：'+safe(team.leaderName||"待指定")+'</p></article>'
  ).join("")||'<div class="directory-empty"><strong>目前没有在籍成员的高校团队</strong><p>同学移除高校后，空团队不会继续占据此列表。</p></div>';
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
  return '<tr class="admin-profile-detail-row" data-profile-detail-row="'+safe(item.id)+'" hidden><td colspan="10"><div class="admin-profile-details">'+
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
    '</div></td></tr>';
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
  $("peopleMeta").textContent="共 "+(pagination.total||0)+" 条账号记录。每行直接显示性别、专业、招生大类和寄语摘要；点击“完整资料”查看详细信息。手机号、第二手机号、微信号和密码不会在管理员页面或导出中展示。";
  $("peopleRows").innerHTML=items.map(item=>{
    const school=item.university||"尚未选择高校";
    const state=item.profileReviewStatus==="pending"?" · 待审核":"";
    return '<tr><td>'+safe(item.name||"未填写")+'</td><td>'+safe(item.highSchool||"")+'</td><td>'+safe(school)+safe(state)+'</td><td>'+safe(item.grade||"")+'</td><td>'+safe(item.province||"")+'</td><td>'+groupChatStatusMarkup(item)+'</td><td>'+(item.consentGiven?"已同意":"未同意")+'</td><td>'+safe(item.createdAt||"")+'</td><td>'+renderProfilePreview(item)+'<button type="button" class="ghost admin-detail-toggle" data-profile-toggle="'+safe(item.id)+'" aria-expanded="false">完整资料</button></td><td><div class="admin-row-actions">'+
      (has("people:delete")?'<button type="button" class="admin-delete-button" data-person-delete="'+safe(item.id)+'" data-person-name="'+safe(item.name||"该同学")+'">删除报名</button>':"")+
      '</div></td></tr>'+
      renderPersonDetails(item);
  }).join("")||'<tr><td colspan="10">没有符合条件的记录</td></tr>';
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
/* The built-in demo uses fictional in-memory records only. It never calls the API. */
const DEMO_DATA={
  people:[
    {name:"林知远",highSchool:"青岛五十八中",university:"山东大学",grade:"大一",province:"山东省",consent:true,created:"2026-11-18"},
    {name:"陈予安",highSchool:"青岛五十八中",university:"中国海洋大学",grade:"大一",province:"山东省",consent:true,created:"2026-11-19"},
    {name:"周星禾",highSchool:"青岛五十八中",university:"复旦大学",grade:"大一",province:"上海市",consent:true,created:"2026-11-20"},
    {name:"许闻溪",highSchool:"青岛五十八中",university:"香港大学",grade:"大一",province:"香港",consent:false,created:"2026-11-21"},
    {name:"沈嘉树",highSchool:"青岛五十八中",university:"University of Tokyo",grade:"大一",province:"日本",consent:true,created:"2026-11-22"}
  ],
  teams:[
    {university:"山东大学",members:18,leader:"林知远",region:"山东省",status:"队伍正常"},
    {university:"中国海洋大学",members:12,leader:"陈予安",region:"山东省",status:"队伍正常"},
    {university:"复旦大学",members:9,leader:"周星禾",region:"上海市",status:"待补充信息"},
    {university:"香港大学",members:6,leader:"许闻溪",region:"香港",status:"队伍正常"}
  ],
  transfers:[
    {from:"林知远",to:"陈予安",university:"山东大学",status:"pending",date:"2026-11-24"},
    {from:"周星禾",to:"沈嘉树",university:"复旦大学",status:"accepted",date:"2026-11-22"},
    {from:"许闻溪",to:"林知远",university:"香港大学",status:"rejected",date:"2026-11-20"},
    {from:"陈予安",to:"周星禾",university:"中国海洋大学",status:"expired",date:"2026-11-15"}
  ],
  audit:[
    {time:"2026-11-25 14:20",actor:"demo-owner",action:"admin.login.succeeded",target:"admin_user"},
    {time:"2026-11-25 13:48",actor:"demo-admin",action:"admin.people.listed",target:"user_collection"},
    {time:"2026-11-24 18:05",actor:"demo-owner",action:"team.transfer.accepted",target:"team"},
    {time:"2026-11-23 09:30",actor:"system",action:"team.transfer.expired",target:"team"}
  ]
};
let demoView="overview";
function demoStatus(status){
  return ({pending:"待确认",accepted:"已接受",rejected:"已拒绝",expired:"已过期"}[status]||status);
}
function renderDemo(){
  const content=$("demoContent");
  const query=($("demoSearch")?.value||"").trim().toLowerCase();
  $("demoSearchWrap").hidden=!["people","teams"].includes(demoView);

  if(demoView==="overview"){
    content.innerHTML=
      '<div class="admin-stats demo-stats">'+
      '<div class="stat"><small>演示报名人数</small><b>50</b></div>'+
      '<div class="stat"><small>已完成资料</small><b>45</b></div>'+
      '<div class="stat"><small>演示高校队伍</small><b>12</b></div>'+
      '<div class="stat"><small>待处理转让</small><b>1</b></div></div>'+
      '<div class="demo-note-grid"><article><small>最近动态</small><b>高校队伍持续完善</b><p>展示报名进度、队伍数量与待处理事项。</p></article><article><small>权限提示</small><b>手机号默认隐藏</b><p>演示名单与导出样例均不包含手机号、密码或真实联系方式。</p></article></div>';
  } else if(demoView==="people"){
    const rows=DEMO_DATA.people.filter(item=>[item.name,item.highSchool,item.university,item.province].join(" ").toLowerCase().includes(query));
    content.innerHTML='<p class="muted">以下为虚构报名数据，共 '+rows.length+' 条匹配结果。</p><div class="table-wrap"><table class="admin-table"><thead><tr><th>姓名</th><th>高中学校</th><th>大学</th><th>年级</th><th>地区</th><th>资料同意</th><th>登记时间</th></tr></thead><tbody>'+
      (rows.map(item=>'<tr><td>'+safe(item.name)+'</td><td>'+safe(item.highSchool)+'</td><td>'+safe(item.university)+'</td><td>'+safe(item.grade)+'</td><td>'+safe(item.province)+'</td><td>'+(item.consent?"已同意":"未同意")+'</td><td>'+safe(item.created)+'</td></tr>').join("")||'<tr><td colspan="7">没有匹配的演示记录</td></tr>')+
      '</tbody></table></div>';
  } else if(demoView==="teams"){
    const rows=DEMO_DATA.teams.filter(item=>[item.university,item.leader,item.region].join(" ").toLowerCase().includes(query));
    content.innerHTML='<p class="muted">虚构高校分组示例。此页面不代表真实队伍。</p><div class="demo-team-grid">'+rows.map(item=>
      '<article><small>'+safe(item.region)+'</small><h4>'+safe(item.university)+'</h4><p>组长：'+safe(item.leader)+'</p><b>'+item.members+' <small>位成员</small></b><span>'+safe(item.status)+'</span></article>'
    ).join("")+'</div>';
  } else if(demoView==="transfers"){
    content.innerHTML='<p class="muted">演示组长转让状态流转；本页只展示样例，不会接受或拒绝任何真实转让。</p><div class="table-wrap"><table class="admin-table"><thead><tr><th>原组长</th><th>接任人</th><th>大学</th><th>状态</th><th>日期</th></tr></thead><tbody>'+
      DEMO_DATA.transfers.map(item=>'<tr><td>'+safe(item.from)+'</td><td>'+safe(item.to)+'</td><td>'+safe(item.university)+'</td><td><span class="demo-status '+safe(item.status)+'">'+demoStatus(item.status)+'</span></td><td>'+safe(item.date)+'</td></tr>').join("")+
      '</tbody></table></div>';
  } else {
    content.innerHTML='<p class="muted">虚构审计事件，展示操作者、操作类型与对象类别，不包含任何个人敏感信息。</p><div class="table-wrap"><table class="admin-table"><thead><tr><th>时间</th><th>操作者</th><th>操作</th><th>对象类别</th></tr></thead><tbody>'+
      DEMO_DATA.audit.map(item=>'<tr><td>'+safe(item.time)+'</td><td>'+safe(item.actor)+'</td><td>'+safe(item.action)+'</td><td>'+safe(item.target)+'</td></tr>').join("")+
      '</tbody></table></div>';
  }
  document.querySelectorAll("[data-demo-tab]").forEach(button=>{
    const active=button.dataset.demoTab===demoView;
    button.classList.toggle("active",active);
    button.setAttribute("aria-pressed",String(active));
  });
}
function openDemo(){
  $("demoPanel").hidden=false;
  renderDemo();
  $("demoPanel").scrollIntoView({behavior:"smooth",block:"start"});
}
function closeDemo(){$("demoPanel").hidden=true;}
$("adminSectionNav").addEventListener("click",event=>{
  const button=event.target.closest("[data-admin-nav]");
  if(!button||button.hidden)return;
  const shown=showAdminView(button.dataset.navTarget,{pushHistory:true});
  if(shown)$(button.dataset.navTarget).scrollIntoView({behavior:"smooth",block:"start"});
});
window.addEventListener("popstate",()=>{
  if(current&&$("dashboard")&&!$("dashboard").hidden)syncAdminNavigation();
});
$("openDemo").addEventListener("click",openDemo);
$("dashboardDemo").addEventListener("click",openDemo);
$("closeDemo").addEventListener("click",closeDemo);
$("demoTabs").addEventListener("click",event=>{
  const button=event.target.closest("[data-demo-tab]");
  if(!button)return;
  demoView=button.dataset.demoTab;
  renderDemo();
});
$("demoSearch").addEventListener("input",renderDemo);

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
      await Promise.all([loadPeople(),loadOverview()]);
    }catch(error){
      $("adminPanelStatus").textContent=errorMessage(error);
      deleteButton.disabled=false;
    }
    return;
  }
  const button=event.target.closest("[data-profile-toggle]");
  if(!button)return;
  const id=button.dataset.profileToggle;
  const row=Array.from($("peopleRows").querySelectorAll("[data-profile-detail-row]")).find(item=>item.dataset.profileDetailRow===id);
  if(!row)return;
  const expanded=row.hidden;
  row.hidden=!expanded;
  button.setAttribute("aria-expanded",String(expanded));
  button.textContent=expanded?"收起资料":"查看资料";
});
$("refreshAdminData").onclick=async()=>{
  const button=$("refreshAdminData");button.disabled=true;
  try{
    await Promise.all([loadOverview(),loadPeople()]);
    $("adminPanelStatus").textContent="名单和高校团队已刷新。";
  }catch(error){
    $("adminPanelStatus").textContent="刷新失败，请稍后重试。";
    console.error("Admin data refresh failed",error?.message||"unknown");
  }finally{button.disabled=false;}
};
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
$("export").onclick=()=>{
  readFilters();
  const query=params({format:"csv"});
  location.href=API+"/admin/people?"+query;
};
$("exportXlsx").onclick=()=>{
  readFilters();
  const query=params({format:"xlsx"});
  location.href=API+"/admin/people?"+query;
};
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
    await loadOverview();
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

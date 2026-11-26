const API="https://api.58er.eon21.space/api", $=id=>document.getElementById(id);
let current=null,page=1,pageSize=50,totalPages=1,filters={};

async function req(path,data){
  let response;
  try {
    response=await fetch(API+path,{
      method:data?"POST":"GET",
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
  admin_username_exists:"用户名已存在。",
  admin_password_too_weak:"管理员密码至少需要14位。"
};
function errorMessage(error){
  const message=ERROR_MESSAGES[error?.message]||"操作失败，请稍后重试。";
  return error?.status?message+"（HTTP "+error.status+"）":message;
}
function showError(id,error){
  const element=$(id);
  if(element) element.textContent=errorMessage(error);
}
function has(permission){return !!current?.permissions?.includes(permission);}
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
  $("adminRole").textContent="角色："+({owner:"所有者",admin:"管理员",viewer:"只读查看"}[current.role]||current.role);
  $("peoplePanel").hidden=!has("people:read");
  $("auditPanel").hidden=!has("audit:read");
  $("managePanel").hidden=!has("admins:manage");
  $("universityReviewPanel").hidden=!has("universities:review");

  // Authentication is complete at /admin/me. A later panel failure must not
  // send a valid administrator back to the login screen.
  const jobs=[
    ["overview",loadOverview,()=>setPanelFailure("summary","统计暂时无法加载。")],
    ["people",()=>has("people:read")?loadPeople():Promise.resolve(),()=>setPanelFailure("peopleMeta","名单加载失败，请检查 people:read 权限及接口响应。")],
    ["audit",()=>has("audit:read")?loadAudit():Promise.resolve(),()=>setPanelFailure("auditRows","审计记录加载失败，请稍后刷新。")],
    ["admins",()=>has("admins:manage")?loadAdmins():Promise.resolve(),()=>setPanelFailure("createAdminMsg","管理员账户列表加载失败。")],
    ["universityReviews",()=>has("universities:review")?loadUniversityReviews():Promise.resolve(),()=>setPanelFailure("universityReviewMsg","海外高校审核队列加载失败。")]
  ];
  const results=await Promise.allSettled(jobs.map(job=>job[1]()));
  results.forEach((result,index)=>{
    if(result.status==="rejected"){
      jobs[index][2]();
      const panelName={overview:"统计",people:"名单",audit:"审计",admins:"管理员列表",universityReviews:"海外高校审核"}[jobs[index][0]];
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
    '<div class="stat"><small>大学队伍</small><b>'+Number(data.teamCount||0)+'</b></div>';
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
async function loadPeople(){
  const data=await req("/admin/people?"+params());
  const pagination=data.pagination||{};
  totalPages=Math.max(1,pagination.totalPages||1);
  $("peopleMeta").textContent="共 "+(pagination.total||0)+" 条记录。手机号不会在管理员名单或 CSV 中展示。";
  $("peopleRows").innerHTML=(data.items||[]).map(item=>
    '<tr><td>'+safe(item.name)+'</td><td>'+safe(item.className)+'</td><td>'+safe(item.university)+'</td><td>'+safe(item.grade)+'</td><td>'+safe(item.province)+'</td><td>'+(item.consentGiven?"已同意":"未同意")+'</td><td>'+safe(item.createdAt)+'</td></tr>'
  ).join("")||'<tr><td colspan="7">没有符合条件的记录</td></tr>';
  $("pageLabel").textContent="第 "+(pagination.page||1)+" / "+totalPages+" 页";
  $("prevPage").disabled=page<=1;
  $("nextPage").disabled=page>=totalPages;
}
async function loadAudit(){
  const data=await req("/admin/audit?page=1&pageSize=50");
  $("auditRows").innerHTML=(data.items||[]).map(item=>
    '<tr><td>'+safe(item.createdAt)+'</td><td>'+safe(item.actorUsername||item.actorType)+'</td><td>'+safe(item.action)+'</td><td>'+safe(item.targetType)+' / '+safe(item.targetId)+'</td><td>'+safe(item.metadata)+'</td></tr>'
  ).join("")||'<tr><td colspan="5">暂无审计记录</td></tr>';
}
async function loadUniversityReviews(){
  const data=await req("/admin/universities/review/pending");
  const rows=data.items||[];
  $("universityReviewRows").innerHTML=rows.map(item=>
    '<article class="admin-review-card" data-review-card="'+safe(item.id)+'">'+
      '<div class="admin-review-summary"><div><b>'+safe(item.name||"未填写姓名")+'</b><small>'+safe(item.highSchool||"")+' · '+safe(item.className||"")+' · '+safe(item.grade||"")+'</small></div>'+
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
  $("adminAccounts").innerHTML=(data.items||[]).map(item=>
    '<div class="admin-account"><div><b>'+safe(item.username)+'</b><small>'+safe(item.role)+' · '+(item.active?"启用":"停用")+' · 最近登录：'+safe(item.lastLoginAt||"从未")+'</small></div><button class="ghost" data-admin-id="'+safe(item.id)+'" data-active="'+(!item.active)+'">'+(item.active?"停用":"重新启用")+'</button></div>'
  ).join("");
}

/* The built-in demo uses fictional in-memory records only. It never calls the API. */
const DEMO_DATA={
  people:[
    {name:"林知远",className:"高三(1)班",university:"山东大学",grade:"大一",province:"山东省",consent:true,created:"2026-11-18"},
    {name:"陈予安",className:"高三(3)班",university:"中国海洋大学",grade:"大一",province:"山东省",consent:true,created:"2026-11-19"},
    {name:"周星禾",className:"高三(6)班",university:"复旦大学",grade:"大一",province:"上海市",consent:true,created:"2026-11-20"},
    {name:"许闻溪",className:"高三(2)班",university:"香港大学",grade:"大一",province:"香港",consent:false,created:"2026-11-21"},
    {name:"沈嘉树",className:"高三(5)班",university:"University of Tokyo",grade:"大一",province:"日本",consent:true,created:"2026-11-22"}
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
    const rows=DEMO_DATA.people.filter(item=>[item.name,item.className,item.university,item.province].join(" ").toLowerCase().includes(query));
    content.innerHTML='<p class="muted">以下为虚构报名数据，共 '+rows.length+' 条匹配结果。</p><div class="table-wrap"><table class="admin-table"><thead><tr><th>姓名</th><th>高中班级</th><th>大学</th><th>年级</th><th>地区</th><th>资料同意</th><th>登记时间</th></tr></thead><tbody>'+
      (rows.map(item=>'<tr><td>'+safe(item.name)+'</td><td>'+safe(item.className)+'</td><td>'+safe(item.university)+'</td><td>'+safe(item.grade)+'</td><td>'+safe(item.province)+'</td><td>'+(item.consent?"已同意":"未同意")+'</td><td>'+safe(item.created)+'</td></tr>').join("")||'<tr><td colspan="7">没有匹配的演示记录</td></tr>')+
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
$("prevPage").onclick=()=>{
  if(page>1){page--;loadPeople().catch(error=>showError("peopleMeta",error));}
};
$("nextPage").onclick=()=>{
  if(page<totalPages){page++;loadPeople().catch(error=>showError("peopleMeta",error));}
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
    await req("/admin/admins",{username:$("newUsername").value.trim(),password:$("newPassword").value,role:$("newRole").value});
    $("newPassword").value="";
    $("createAdminMsg").textContent="管理员账号已创建。";
    await loadAdmins();
  } catch(error) { showError("createAdminMsg",error); }
};
$("adminAccounts").onclick=async event=>{
  const button=event.target.closest("[data-admin-id]");
  if(!button)return;
  try {
    await req("/admin/admins/"+button.dataset.adminId,{active:button.dataset.active==="true"});
    await loadAdmins();
  } catch(error) { showError("createAdminMsg",error); }
};
window.addEventListener("DOMContentLoaded",()=>enter());

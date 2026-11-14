const API="https://api.58er.eon21.space/api",SITEKEY="0x4AAAAAAF8tZfD0j4LHU8uN",$=id=>document.getElementById(id);let widgets={},tokens={},consumedTokens={},view="members",directory=null,categoryLocked=false;const phoneOK=p=>/^1[3-9]\d{9}$/.test(p);
async function call(path,data){const r=await fetch(API+path,{method:data?"POST":"GET",credentials:"include",headers:data?{"Content-Type":"application/json"}:{},body:data?JSON.stringify(data):undefined});let d={};try{d=await r.json()}catch{}if(!r.ok){const e=Error(d.error||"request_failed");e.details=d;e.status=r.status;throw e}return d}
function msg(id,s,bad=false){$(id).textContent=s;$(id).classList.toggle("bad",bad)}
function auth(v="login"){$("modal").classList.add("show");["login","register","reset","changePassword","deleteAccount"].forEach(x=>$(x+"Form").hidden=x!==v);$("authTabs").hidden=v==="reset"||v==="changePassword"||v==="deleteAccount";document.querySelectorAll("[data-auth]").forEach(b=>b.classList.toggle("active",b.dataset.auth===v));if(v==="register"||v==="reset"||v==="deleteAccount")captcha(v)}
function captcha(v){if(!window.turnstile||widgets[v]!==undefined)return;const target={register:"regCaptcha",reset:"resetCaptcha",deleteAccount:"deleteCaptcha"}[v];const action={register:"register",reset:"password_reset",deleteAccount:"account_delete"}[v];widgets[v]=turnstile.render("#"+target,{sitekey:SITEKEY,theme:"auto",action,callback:t=>{tokens[v]=t;consumedTokens[v]=false;},"expired-callback":()=>{tokens[v]="";consumedTokens[v]=false;},"error-callback":()=>{tokens[v]="";consumedTokens[v]=false;}})}function resetCaptcha(v){if(window.turnstile&&widgets[v]!==undefined)turnstile.reset(widgets[v]);tokens[v]="";consumedTokens[v]=false}
function errorText(e){if(e.message==="consent_required")return "请先阅读隐私说明并勾选同意";if(e.message==="current_password_invalid")return "当前密码不正确，请重新输入";if(e.message==="same_password")return "新密码不能与当前密码相同";if(e.message==="weak_password")return "密码长度需要为 10–128 位";if(e.message==="unauthorized")return "登录状态已失效，请重新登录";if(e.message==="university_metadata_conflict")return "这所高校的地区或办学层次与已有资料不一致，请核对学校名称和类别";if(e.message==="leader_transfer_required")return "你目前仍是有其他队员的队长，请先完成队长转让后再删除账号";if(e.message==="account_delete_confirm_required")return "请输入 DELETE 完成二次确认";if(e.message==="account_delete_conflict")return "账号状态刚刚发生变化，请重新登录后检查";if(e.message==="rate_limited"){const scope=e.details?.limitScope;if(scope==="phone_daily")return "本手机号今日短信额度已用完，请在倒计时结束后重试";if(scope==="ip_hourly")return "当前网络短信请求过于频繁，请稍后重试";if(scope==="cooldown")return "发送间隔不足，请稍后重试";return "操作过于频繁，请稍后再试"}return ({invalid_credentials:"手机号或密码错误",invalid_phone:"手机号格式不正确",invalid_code:"验证码错误或已过期",rate_limited:"操作过于频繁，请稍后再试",turnstile_failed:"人机验证未通过",phone_already_registered:"该手机号已注册，请直接登录",phone_not_registered:"该手机号尚未注册"})[e.message]||"暂时无法完成操作，请稍后重试"}
function formatWait(seconds){const n=Math.max(0,Math.ceil(Number(seconds)||0));if(n<60)return n+"秒后重试";if(n<3600)return Math.ceil(n/60)+"分钟后重试";const days=Math.floor(n/86400),hours=Math.floor((n%86400)/3600),minutes=Math.ceil((n%3600)/60);if(days)return days+"天"+(hours?hours+"小时":"")+"后重试";return hours+"小时"+(minutes?minutes+"分钟":"")+"后重试"}function cooldown(b,seconds=60){const end=Date.now()+Math.max(1,Number(seconds)||60)*1000;b.disabled=true;const tick=()=>{const n=Math.max(0,Math.ceil((end-Date.now())/1000));b.textContent=n?formatWait(n):"获取验证码";if(n)setTimeout(tick,n>=3600?60000:n>=60?1000:500);else b.disabled=false};tick()}
async function sendCode(v){
  const isDelete=v==="deleteAccount";
  const p=isDelete?"":$(v==="register"?"regPhone":"resetPhone").value.trim();
  const b=$(isDelete?"deleteSend":v==="register"?"regSend":"resetSend");
  const m=isDelete?"deleteMsg":v==="register"?"regMsg":"resetMsg";
  if(b.disabled)return;
  if(v==="register"&&!$("accountConsent").checked)return msg(m,"请先阅读隐私说明并勾选同意",true);
  if(!isDelete&&!phoneOK(p))return msg(m,"请输入正确的 11 位手机号",true);
  if(!tokens[v]){
    if(consumedTokens[v]){resetCaptcha(v);return msg(m,"上一次人机验证已使用，请重新完成验证。",true)}
    return msg(m,"请先完成 Cloudflare 人机验证",true);
  }
  b.disabled=true;b.textContent="正在发送…";let cooling=false;
  try{
    const path=isDelete?"/account/delete/request-code":v==="register"?"/auth/register/request-code":"/auth/password/request-code";
    const payload=isDelete?{turnstileToken:tokens[v]}:{phone:p,turnstileToken:tokens[v],accountConsent:v==="register"?$("accountConsent").checked:undefined};
    await call(path,payload);
    msg(m,isDelete?"验证码已发送至当前账号绑定手机号。":"验证码已发送，请注意查收。人机验证保持通过状态。");
    tokens[v]="";consumedTokens[v]=true;cooldown(b,60);cooling=true;
  }catch(e){
    msg(m,errorText(e),true);const details=e.details||{};
    if(details.refreshTurnstile===true||!details.error)resetCaptcha(v);
    if(e.message==="rate_limited"){cooldown(b,details.retryAfter||60);cooling=true}
  }finally{if(!cooling){b.disabled=false;b.textContent="获取验证码"}}
}
const universityCategories={mainland:"中国大陆高校",hmt:"港澳台高校",sino_foreign:"中外合作办学",overseas:"海外高校"};
function selectUniversityCategory(category){$("universityCategoryValue").value=category;document.querySelectorAll("[data-university-category]").forEach(b=>b.classList.toggle("selected",b.dataset.universityCategory===category));$("universityNext").disabled=!universityCategories[category];$("selectedUniversityType").textContent=universityCategories[category]||"尚未选择";}
function showUniversityCategoryStep(){$("universityTypeStep").hidden=false;$("universityDetailsStep").hidden=true;$("stepOneLabel").classList.add("current");$("stepTwoLabel").classList.remove("current");}
function openUniversityDetails(){const category=$("universityCategoryValue").value;if(!universityCategories[category])return msg("universityCategoryMsg","请先选择高校类别",true);$("universityTypeStep").hidden=true;$("universityDetailsStep").hidden=false;$("stepOneLabel").classList.remove("current");$("stepTwoLabel").classList.add("current");$("selectedUniversityType").textContent=universityCategories[category];$("universityBack").hidden=categoryLocked;$("universityBackBottom").hidden=categoryLocked;syncUniversityFields();}
function syncUniversityFields(profile={}){const category=$("universityCategoryValue").value;["mainlandFields","hmtFields","jointFields","overseasFields"].forEach(id=>$(id).hidden=true);$("mainlandFields").hidden=category!=="mainland";$("hmtFields").hidden=category!=="hmt";$("jointFields").hidden=category!=="sino_foreign";$("overseasFields").hidden=category!=="overseas";$("mainlandEducationLevel").required=category==="mainland";$("hmtRegion").required=category==="hmt";$("jointEducationLevel").required=category==="sino_foreign";$("jointPartnerName").required=category==="sino_foreign";$("overseasRegion").required=category==="overseas";if(profile.educationLevel){if(category==="mainland")$("mainlandEducationLevel").value=profile.educationLevel;if(category==="sino_foreign")$("jointEducationLevel").value=profile.educationLevel;}if(profile.regionName){if(category==="hmt")$("hmtRegion").value=profile.regionName;if(category==="overseas")$("overseasRegion").value=profile.regionName;}if(profile.partnerName)$("jointPartnerName").value=profile.partnerName;$("educationLevelValue").value=category==="mainland"?$("mainlandEducationLevel").value:category==="sino_foreign"?$("jointEducationLevel").value:"";$("regionNameValue").value=category==="hmt"?$("hmtRegion").value:category==="overseas"?$("overseasRegion").value.trim():"";$("partnerNameValue").value=category==="sino_foreign"?$("jointPartnerName").value.trim():"";}
function safe(s){return String(s||"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]))}
function showAuthStage(){
  document.body.classList.remove("session-checking");
  $("bootScreen").hidden=true;
  $("mainContent").hidden=false;
  $("authStage").hidden=false;
  $("appStage").hidden=true;
  $("mainNav").hidden=true;
  $("pageFooter").hidden=true;
  $("openAuth").hidden=false;
  $("changePassword").hidden=true;
  $("logout").hidden=true;
}
function setJourneyStep(step){
  document.querySelectorAll("[data-journey-step]").forEach(el=>el.classList.toggle("active",el.dataset.journeyStep===step));
}
function showProfileStage(){
  $("join").hidden=false;
  $("groups").hidden=true;
  setJourneyStep("profile");
  window.scrollTo({top:0,behavior:"smooth"});
}
function showDirectoryStage(){
  $("join").hidden=true;
  $("groups").hidden=false;
  setJourneyStep("directory");
  const p=$("profile");
  const school=p.elements.university.value.trim();
  $("directorySchoolTitle").textContent=school||"尚未填写高校";
  window.scrollTo({top:0,behavior:"smooth"});
  loadDirectory();
}
function showAppStage(profile={}){
  document.body.classList.remove("session-checking");
  $("bootScreen").hidden=true;
  $("mainContent").hidden=false;
  $("authStage").hidden=true;
  $("appStage").hidden=false;
  $("mainNav").hidden=false;
  $("pageFooter").hidden=false;
  $("openAuth").hidden=true;
  $("changePassword").hidden=false;
  $("logout").hidden=false;
  $("gate").hidden=true;
  $("profile").hidden=false;
  $("goDirectory").hidden=!(profile.university&&universityCategories[profile.universityCategory]);
  $("join").hidden=false;
  $("groups").hidden=true;
  setJourneyStep("profile");
}
async function load(){
  try{
    const d=await call("/profile");
    const p=d.profile||{};
    for(const k of ["name","className","highSchool","university","grade","province","city","bio"])$("profile").elements[k].value=p[k]||"";
    $("profile").elements.phoneVisible.checked=!!p.phoneVisible;$("consent").checked=!!p.consentGiven;
    categoryLocked=["mainland","hmt","sino_foreign","overseas"].includes(p.universityCategory);
    if(categoryLocked){
      selectUniversityCategory(p.universityCategory);
      openUniversityDetails();
      $("universityBack").hidden=true;
      $("universityBackBottom").hidden=true;
      syncUniversityFields(p);
    }else{
      showUniversityCategoryStep();
      $("universityBack").hidden=false;
      $("universityBackBottom").hidden=false;
    }
    showAppStage(p);
  }catch(e){
    if(e.message==="unauthorized"){
      showAuthStage();
    }else{
      console.warn(e);
      document.body.classList.remove("session-checking");
      $("bootMessage").textContent="暂时无法确认登录状态，请检查网络后重新尝试。";
      $("retrySession").hidden=false;
    }
  }
}
$("retrySession").onclick=()=>location.reload();
async function loadDirectory(){
  $("directoryMsg").textContent="";
  $("directoryCount").textContent="正在加载同学资料…";
  try{
    directory=await call("/directory");
    render();
  }catch(e){
    $("directoryCount").textContent="暂时无法加载";
    $("directoryMsg").textContent=e.message==="unauthorized"?"登录状态已失效，请重新登录。":"同学资料加载失败，请稍后重试。";
    if(e.message==="unauthorized")showAuthStage();
  }
}
function render(){
  if(!directory)return;
  const rows=directory.members||[];
  const q=$("search").value.trim().toLowerCase();
  const filtered=rows.filter(x=>[x.name,x.className,x.grade,x.province].join(" ").toLowerCase().includes(q));
  $("directoryCount").textContent="共找到 "+rows.length+" 位同校同学";
  $("results").innerHTML=filtered.map(x=>{
    const phone=x.phone?String(x.phone).replace(/[^0-9+]/g,""):"";
    const contact=phone
      ?'<a class="contact-link" href="tel:'+safe(phone)+'">☎ '+safe(phone)+'</a>'
      :'<span class="contact-private">手机号未授权公开</span>';
    return '<article class="classmate-card panel"><div class="classmate-top"><span class="classmate-avatar">'+safe((x.name||"同").slice(0,1))+'</span><div><strong>'+safe(x.name||"同学")+'</strong><small>'+safe(x.className||"班级未填写")+'</small></div></div><div class="classmate-meta"><span>'+safe(x.grade||"年级未填写")+'</span><span>'+safe(x.province||"地区未填写")+'</span></div><div class="classmate-contact">'+contact+'</div></article>';
  }).join("")||'<div class="directory-empty"><strong>暂时没有找到同学</strong><p>'+(q?"试试其他关键词，或清空搜索条件。":"同校同学登记后会显示在这里。")+'</p></div>';
}
document.querySelectorAll("[data-close]").forEach(x=>x.onclick=()=>$("modal").classList.remove("show"));document.querySelectorAll("[data-university-category]").forEach(b=>b.onclick=()=>{if(categoryLocked)return;selectUniversityCategory(b.dataset.universityCategory);msg("universityCategoryMsg","已选择："+universityCategories[b.dataset.universityCategory]);});$("universityNext").onclick=()=>openUniversityDetails();$("universityBack").onclick=showUniversityCategoryStep;$("universityBackBottom").onclick=showUniversityCategoryStep;["mainlandEducationLevel","jointEducationLevel","hmtRegion","overseasRegion","jointPartnerName"].forEach(id=>$(id).addEventListener("change",()=>syncUniversityFields()));["openAuth","authStageLogin","gateLogin"].forEach(x=>$(x).onclick=()=>auth("login"));$("authStageRegister").onclick=()=>auth("register");$("goDirectory").onclick=showDirectoryStage;$("backToProfile").onclick=showProfileStage;document.querySelectorAll('#mainNav a[href="#join"]').forEach(x=>x.onclick=e=>{e.preventDefault();showProfileStage()});document.querySelectorAll('#mainNav a[href="#groups"]').forEach(x=>x.onclick=e=>{e.preventDefault();if(!$("goDirectory").hidden)showDirectoryStage()});$("changePassword").onclick=()=>auth("changePassword");$("theme").onclick=()=>document.body.classList.toggle("dark");document.querySelectorAll("[data-auth]").forEach(x=>x.onclick=()=>auth(x.dataset.auth));$("forgot").onclick=()=>auth("reset");$("backLogin").onclick=()=>auth("login");$("cancelPasswordChange").onclick=()=>$("modal").classList.remove("show");$("deleteAccountOpen").onclick=()=>auth("deleteAccount");$("cancelDeleteAccount").onclick=()=>$("modal").classList.remove("show");$("deleteSend").onclick=()=>sendCode("deleteAccount");$("regSend").onclick=()=>sendCode("register");$("resetSend").onclick=()=>sendCode("reset");
$("loginForm").onsubmit=async e=>{e.preventDefault();try{await call("/auth/login",{phone:$("loginPhone").value.trim(),password:$("loginPassword").value});$("modal").classList.remove("show");await load()}catch(x){msg("loginMsg",errorText(x),true)}};
$("registerForm").onsubmit=async e=>{e.preventDefault();if($("regPass").value!==$("regPass2").value)return msg("regMsg","两次密码不一致",true);try{await call("/auth/register",{phone:$("regPhone").value.trim(),code:$("regCode").value.trim(),password:$("regPass").value,accountConsent:$("accountConsent").checked});$("modal").classList.remove("show");await load()}catch(x){msg("regMsg",errorText(x),true)}};
$("resetForm").onsubmit=async e=>{e.preventDefault();if($("resetPass").value!==$("resetPass2").value)return msg("resetMsg","两次密码不一致",true);try{await call("/auth/password/reset",{phone:$("resetPhone").value.trim(),code:$("resetCode").value.trim(),newPassword:$("resetPass").value});msg("resetMsg","密码已重置，请返回登录");setTimeout(()=>auth("login"),900)}catch(x){msg("resetMsg",errorText(x),true)}};
$("deleteAccountForm").onsubmit=async e=>{e.preventDefault();if($("deleteConfirm").value.trim()!=="DELETE")return msg("deleteMsg","请输入 DELETE 完成二次确认",true);try{await call("/account/delete",{password:$("deletePassword").value,code:$("deleteCode").value.trim(),confirmText:"DELETE"});msg("deleteMsg","账号资料已匿名化，正在退出…");$("deleteAccountForm").reset();location.replace("index.html")}catch(x){msg("deleteMsg",errorText(x),true);if(x.message==="unauthorized")setTimeout(()=>auth("login"),900)}};
$("changePasswordForm").onsubmit=async e=>{e.preventDefault();const currentPassword=$("currentPassword").value,newPassword=$("newPassword").value;if(newPassword!==$("confirmNewPassword").value)return msg("changePassMsg","两次新密码不一致",true);if(newPassword.length<10)return msg("changePassMsg","新密码至少需要 10 位",true);try{await call("/auth/password/change",{currentPassword,newPassword});msg("changePassMsg","密码修改成功，其他设备已退出登录");$("changePasswordForm").reset();document.querySelectorAll("#changePasswordForm .password-toggle").forEach(b=>{const input=$(b.dataset.togglePassword);input.type="password";b.textContent="显示"});setTimeout(()=>$("modal").classList.remove("show"),1200)}catch(x){msg("changePassMsg",errorText(x),true);if(x.message==="unauthorized")setTimeout(()=>auth("login"),900)}};
$("logout").onclick=async()=>{try{await fetch(API+"/auth/logout",{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:"{}"})}finally{location.reload()}};
$("profile").onsubmit=async e=>{e.preventDefault();syncUniversityFields();const f=new FormData(e.target),d=Object.fromEntries(f.entries());d.phoneVisible=f.has("phoneVisible");d.consent=$("consent").checked;if(!$("consent").checked)return msg("profileMsg","请先确认信息使用说明",true);try{const r=await fetch(API+"/profile",{method:"PUT",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify(d)});let result={};try{result=await r.json()}catch{}if(!r.ok)throw Error(result.error||"profile_save_failed");categoryLocked=true;$("universityBack").hidden=true;$("universityBackBottom").hidden=true;await load();msg("profileMsg","资料保存成功");$("goDirectory").hidden=false;showDirectoryStage()}catch(error){const errors={consent_required:"请先阅读隐私说明并勾选同意",profile_incomplete:"请完整填写必填资料",education_level_required:"请选择本科或专科办学层次",university_region_required:"请选择或填写高校所在地区",cooperation_details_required:"请选择办学层次并填写境外合作院校",university_change_requires_support:"已登记高校暂不能自行更换，请联系组织者",university_metadata_conflict:"这所高校的地区或办学层次与已有资料不一致，请核对学校名称和类别"};msg("profileMsg",errors[error.message]||"保存失败，请检查资料后重试",true)}};
document.querySelectorAll("[data-toggle-password]").forEach(b=>b.onclick=()=>{const input=$(b.dataset.togglePassword);const visible=input.type==="password";input.type=visible?"text":"password";b.textContent=visible?"隐藏":"显示"});document.querySelectorAll("[data-view]").forEach(x=>x.onclick=()=>{document.querySelectorAll("[data-view]").forEach(b=>b.classList.toggle("active",b===x));view=x.dataset.view;render()});$("search").oninput=render;window.addEventListener("DOMContentLoaded",load);
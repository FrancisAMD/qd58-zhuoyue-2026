const API="https://api.58er.eon21.space/api",SITEKEY="0x4AAAAAAF8tZfD0j4LHU8uN",$=id=>document.getElementById(id);let widgets={},tokens={},consumedTokens={},view="members",directory=null,categoryLocked=false;const phoneOK=p=>/^1[3-9]\d{9}$/.test(p);
async function call(path,data,options={}){
  const timeoutMs=Number(options.timeoutMs)||0;
  const controller=timeoutMs>0?new AbortController():null;
  const timer=controller?setTimeout(()=>controller.abort(),timeoutMs):null;
  try{
    const r=await fetch(API+path,{method:data?"POST":"GET",credentials:"include",headers:data?{"Content-Type":"application/json"}:{},body:data?JSON.stringify(data):undefined,signal:controller?controller.signal:undefined,cache:"no-store"});
    let d={};try{d=await r.json()}catch{}
    if(!r.ok){const e=Error(d.error||"request_failed");e.details=d;e.status=r.status;throw e}
    return d;
  }catch(error){
    if(controller&&controller.signal.aborted){const timeout=Error("request_timeout");timeout.status=408;throw timeout}
    throw error;
  }finally{
    if(timer!==null)clearTimeout(timer);
  }
}
function msg(id,s,bad=false){$(id).textContent=s;$(id).classList.toggle("bad",bad)}
function auth(v="login"){$("modal").classList.add("show");["login","register","reset","changePassword","deleteAccount"].forEach(x=>$(x+"Form").hidden=x!==v);$("authTabs").hidden=v==="reset"||v==="changePassword"||v==="deleteAccount";document.querySelectorAll("[data-auth]").forEach(b=>b.classList.toggle("active",b.dataset.auth===v));if(v==="register"||v==="reset"||v==="deleteAccount")captcha(v)}
function captcha(v){if(!window.turnstile||widgets[v]!==undefined)return;const target={register:"regCaptcha",reset:"resetCaptcha",deleteAccount:"deleteCaptcha"}[v];const action={register:"register",reset:"password_reset",deleteAccount:"account_delete"}[v];widgets[v]=turnstile.render("#"+target,{sitekey:SITEKEY,theme:"auto",action,callback:t=>{tokens[v]=t;consumedTokens[v]=false;},"expired-callback":()=>{tokens[v]="";consumedTokens[v]=false;},"error-callback":()=>{tokens[v]="";consumedTokens[v]=false;}})}function resetCaptcha(v){if(window.turnstile&&widgets[v]!==undefined)turnstile.reset(widgets[v]);tokens[v]="";consumedTokens[v]=false}
function errorText(e){if(e.message==="consent_required")return "请先阅读隐私说明并勾选同意";if(e.message==="current_password_invalid")return "当前密码不正确，请重新输入";if(e.message==="same_password")return "新密码不能与当前密码相同";if(e.message==="password_change_conflict"||e.message==="password_reset_conflict")return "密码状态刚刚发生变化，请重新验证后再试";if(e.message==="weak_password")return "密码长度需要为 10–128 位";if(e.message==="unauthorized")return "登录状态已失效，请重新登录";if(e.message==="university_metadata_conflict")return "这所高校的地区或办学层次与已有资料不一致，请联系组织者核对";if(e.message==="university_catalog_selection_required")return "请从高校目录中选择一所已核验高校";if(e.message==="university_not_selectable")return "所选高校尚未核验或已停用，请重新搜索选择";if(e.message==="leader_transfer_required")return "你目前仍是有其他队员的队长，请先完成队长转让后再删除账号";if(e.message==="account_delete_confirm_required")return "请输入 DELETE 完成二次确认";if(e.message==="account_delete_conflict")return "账号状态刚刚发生变化，请重新登录后检查";if(e.message==="rate_limited"){const scope=e.details?.limitScope;if(scope==="phone_daily")return "本手机号今日短信额度已用完，请在倒计时结束后重试";if(scope==="ip_hourly")return "当前网络短信请求过于频繁，请稍后重试";if(scope==="cooldown")return "发送间隔不足，请稍后重试";return "操作过于频繁，请稍后再试"}return ({invalid_credentials:"手机号或密码错误",invalid_phone:"手机号格式不正确",invalid_code:"验证码错误或已过期",rate_limited:"操作过于频繁，请稍后再试",turnstile_failed:"人机验证未通过",phone_already_registered:"该手机号已注册，请直接登录",phone_not_registered:"该手机号尚未注册"})[e.message]||"暂时无法完成操作，请稍后重试"}
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
    msg(m,isDelete?"验证码已发送至当前账号绑定手机号。":"请求已受理。若手机号符合当前操作条件，验证码会发送；如果未收到，请检查号码或稍后重试。");
    tokens[v]="";consumedTokens[v]=true;cooldown(b,60);cooling=true;
  }catch(e){
    msg(m,errorText(e),true);const details=e.details||{};
    if(details.refreshTurnstile===true||!details.error)resetCaptcha(v);
    if(e.message==="rate_limited"){cooldown(b,details.retryAfter||60);cooling=true}
  }finally{if(!cooling){b.disabled=false;b.textContent="获取验证码"}}
}
const universityCategories={mainland:"中国内地本科高校",hmt:"港澳台高校",overseas:"海外高校"};
let universitySearchTimer=null,universitySearchSequence=0,universityResults=[],selectedUniversity=null;
let profileReferenceData=null,profileReferencePromise=null;
async function loadProfileReferenceData(){
  if(profileReferenceData)return profileReferenceData;
  if(!profileReferencePromise)profileReferencePromise=Promise.all([
    "mainland-universities.json","hmt-universities.json","major-disciplines.json","admission-types.json"
  ].map(async name=>{
    const response=await fetch("data/profile-sources/"+name,{cache:"force-cache"});
    if(!response.ok)throw new Error("reference_data_load_failed");
    return response.json();
  })).then(([mainland,hmt,majors,admissions])=>{
    if(!Array.isArray(mainland.universities)||!Array.isArray(hmt.universities)||!Array.isArray(majors.categories)||!Array.isArray(admissions.categories))throw new Error("reference_data_invalid");
    profileReferenceData={mainland,hmt,majors,admissions};
    return profileReferenceData;
  });
  return profileReferencePromise;
}
function normalizeSearch(value){return String(value||"").normalize("NFKC").replace(/[\\s\\p{P}\\p{S}]+/gu,"").toLowerCase()}
function selectUniversityCategory(category){
  if(!universityCategories[category]||categoryLocked)return;
  universitySearchSequence++;clearTimeout(universitySearchTimer);
  selectedUniversity=null;universityResults=[];
  $("universityCategoryValue").value=category;
  $("universityCategoryField").value=category;
  $("profileUniversityId").value="";
  $("universityCatalogId").value="";
  $("universityName").value="";
  $("selectedUniversityName").textContent="尚未选择高校";
  $("universitySelectionMsg").textContent=category==="overseas"?"海外高校由你自行填写，提交后进入审核。":"请从项目内高校目录中选择。";
  $("universitySearch").value="";
  $("universitySearchResults").innerHTML="";
  $("campusSelectionWrap").hidden=true;
  $("campusSelect").required=false;
  $("campusSelect").innerHTML='<option value="">请先选择高校</option>';
  $("catalogSearchWrap").hidden=category==="overseas";
  $("overseasUniversityWrap").hidden=category!=="overseas";
  $("admissionFields").hidden=category!=="mainland";
  $("admissionCategoryId").required=category==="mainland";
  $("admissionTypeId").required=category==="mainland";
  $("overseasUniversityName").value="";
  $("profileProvince").value=category==="overseas"?"海外":"";
  $("profileCity").value="";
  document.querySelectorAll("[data-university-category]").forEach(button=>button.classList.toggle("selected",button.dataset.universityCategory===category));
  $("universityNext").disabled=false;
  $("selectedUniversityType").textContent=universityCategories[category];
}
function showUniversityCategoryStep(){
  if(categoryLocked)return;
  universitySearchSequence++;clearTimeout(universitySearchTimer);
  $("universityTypeStep").hidden=false;
  $("universityDetailsStep").hidden=true;
  $("stepOneLabel").classList.add("current");
  $("stepTwoLabel").classList.remove("current");
}
async function openUniversityDetails(){
  const category=$("universityCategoryValue").value;
  if(!universityCategories[category])return msg("universityCategoryMsg","请先选择高校类别",true);
  $("universityTypeStep").hidden=true;
  $("universityDetailsStep").hidden=false;
  $("stepOneLabel").classList.remove("current");
  $("stepTwoLabel").classList.add("current");
  $("selectedUniversityType").textContent=universityCategories[category];
  $("universityBack").hidden=categoryLocked;
  $("universityBackBottom").hidden=categoryLocked;
  $("universitySearch").disabled=categoryLocked;
  $("catalogSearchWrap").hidden=category==="overseas";
  $("overseasUniversityWrap").hidden=category!=="overseas";
  $("admissionFields").hidden=category!=="mainland";
  $("admissionCategoryId").required=category==="mainland";
  $("admissionTypeId").required=category==="mainland";
  try{
    const refs=await loadProfileReferenceData();
    populateMajorGroups(refs,selectedUniversity?.tags||[]);
    populateAdmissionCategories(refs);
    if(category!=="overseas"&&!categoryLocked)searchUniversities();
  }catch(error){
    $("universitySearchResults").innerHTML='<p class="university-search-empty">高校数据文件加载失败，请检查 Pages 中 data/profile-sources/ 目录。</p>';
    msg("profileMsg","登记数据暂时无法加载，请刷新页面后重试。",true);
  }
}
function renderUniversitySearchResults(rows){
  const container=$("universitySearchResults");
  if(!rows.length){
    container.innerHTML='<p class="university-search-empty">没有找到匹配高校，请检查名称或换一个关键词。</p>';
    return;
  }
  container.innerHTML=rows.map((item,index)=>{
    const location=item._category==="mainland"?[item.province_or_state,item.city].filter(Boolean).join(" · "):(item.region||"");
    const tags=(item.tags||[]).slice(0,3).join(" / ");
    const meta=[location,tags].filter(Boolean).join(" · ");
    return '<button type="button" class="university-result" data-university-index="'+index+'"><span><strong>'+safe(item.name)+'</strong><small>'+safe(meta)+'</small></span><span class="university-result-action">选择</span></button>';
  }).join("");
}
async function searchUniversities(){
  const category=$("universityCategoryValue").value;
  if(!["mainland","hmt"].includes(category))return;
  const query=$("universitySearch").value.trim();
  if(!query){
    $("universitySearchResults").innerHTML='<p class="university-search-empty">输入学校名称开始搜索。内地目录含在用异地校区和境外校区信息。</p>';
    universityResults=[];
    return;
  }
  const sequence=++universitySearchSequence;
  try{
    const refs=await loadProfileReferenceData();
    if(sequence!==universitySearchSequence)return;
    const source=category==="mainland"?refs.mainland.universities:refs.hmt.universities;
    const q=normalizeSearch(query);
    const rows=source.filter(item=>{
      const candidates=[item.name,item.id,item.province_or_state,item.city,item.region,...(item.aliases||[])];
      return candidates.some(value=>normalizeSearch(value).includes(q));
    }).map(item=>({...item,_category:category}));
    rows.sort((a,b)=>{
      const an=normalizeSearch(a.name),bn=normalizeSearch(b.name);
      return Number(!an.startsWith(q))-Number(!bn.startsWith(q))||a.name.localeCompare(b.name,"zh-CN");
    });
    universityResults=rows.slice(0,30);
    renderUniversitySearchResults(universityResults);
  }catch(error){
    if(sequence!==universitySearchSequence)return;
    $("universitySearchResults").innerHTML='<p class="university-search-empty">高校数据加载失败，请刷新页面后重试。</p>';
  }
}
function campusesFor(item){
  const campuses=[];
  for(const campus of item?.campuses||[]){
    campuses.push({id:campus.campus_id,name:"主校区",tag:campus.tag||"主校区",country:item.country||"中国",province:campus.province_or_state||item.province_or_state||"",city:campus.city||item.city||""});
    for(const branch of campus.branches||[])if((branch.status||"active")==="active")campuses.push({id:branch.campus_id,name:branch.name||"校区",tag:branch.tag||"异地校区",country:branch.country||"中国",province:branch.province_or_state||"",city:branch.city||""});
  }
  return campuses;
}
function updateCampusFromSelection(){
  if(!selectedUniversity)return;
  const campus=campusesFor(selectedUniversity).find(item=>item.id===$("campusSelect").value);
  if(!campus)return;
  $("campusName").value=campus.name;
  $("campusTag").value=campus.tag;
  const region=campus.country&&campus.country!=="中国"?[campus.country,campus.province].filter(Boolean).join(" · "):(campus.province||"");
  $("profileProvince").value=region;
  $("profileCity").value=campus.city||"";
  $("universitySelectionMsg").textContent="已选择 "+campus.name+" · "+[region,campus.city].filter(Boolean).join(" · ")+"。同一所大学所有校区属于同一团队。";
}
function populateCampusOptions(item,selectedId=""){
  const campuses=campusesFor(item);
  $("campusSelectionWrap").hidden=false;
  $("campusSelect").required=true;
  $("campusSelect").innerHTML='<option value="">请选择就读校区</option>'+campuses.map(c=>{
    const region=c.country&&c.country!=="中国"?[c.country,c.province].filter(Boolean).join(" · "):(c.province||"");
    const label=c.name+"（"+[c.tag,region,c.city].filter(Boolean).join(" · ")+"）";
    return '<option value="'+safe(c.id)+'">'+safe(label)+'</option>';
  }).join("");
  $("campusSelect").value=selectedId||campuses[0]?.id||"";
  updateCampusFromSelection();
}
function selectUniversity(item,selectedCampusId=""){
  if(!item||!item.id)return;
  universitySearchSequence++;clearTimeout(universitySearchTimer);
  selectedUniversity=item;
  const category=item._category||$("universityCategoryValue").value;
  $("profileUniversityId").value=item.id;
  $("universityCatalogId").value="";
  $("universityName").value=item.name;
  $("universityCategoryValue").value=category;
  $("universityCategoryField").value=category;
  $("selectedUniversityName").textContent=item.name;
  $("universitySearchResults").innerHTML="";
  if(category==="mainland"){
    $("campusHelp").textContent="主校区及异地校区均属于 "+item.name+" 的同一支团队，不会按校区拆分。";
    populateCampusOptions(item,selectedCampusId);
    populateMajorGroups(profileReferenceData,item.tags||[]);
    $("admissionFields").hidden=false;
    $("admissionCategoryId").required=true;
    $("admissionTypeId").required=true;
  }else{
    $("campusSelectionWrap").hidden=true;
    $("campusSelect").required=false;
    $("campusSelect").value="";
    $("campusName").value="";
    $("campusTag").value="";
    $("profileProvince").value=item.region||"";
    $("profileCity").value=item.city||"";
    $("universitySelectionMsg").textContent="已选择 "+item.name+" · "+[item.region,item.city].filter(Boolean).join(" · ");
    $("admissionFields").hidden=true;
    $("admissionCategoryId").required=false;
    $("admissionTypeId").required=false;
    populateMajorGroups(profileReferenceData,item.tags||[]);
  }
}
function populateMajorGroups(refs,tags=[]){
  if(!refs)return;
  const groups=[...new Set(refs.majors.categories.map(item=>item.legacyGroup).filter(Boolean))];
  if((tags||[]).includes("military_academy"))groups.push("军事学");
  const current=$("majorGroup").value;
  $("majorGroup").innerHTML='<option value="">请选择专业大类</option>'+groups.map(group=>'<option value="'+safe(group)+'">'+safe(group)+'</option>').join("");
  if(groups.includes(current))$("majorGroup").value=current;
}
function populateAdmissionCategories(refs){
  const select=$("admissionCategoryId");
  const current=select.value;
  select.innerHTML='<option value="">请选择招生大类</option>'+refs.admissions.categories.map(item=>'<option value="'+safe(item.id)+'">'+safe(item.name)+'</option>').join("");
  if(refs.admissions.categories.some(item=>item.id===current))select.value=current;
  populateAdmissionTypes(refs.admissions.categories,select.value,$("admissionTypeId").value);
}
function populateAdmissionTypes(categories,categoryId,selectedType=""){
  const category=categories.find(item=>item.id===categoryId);
  const select=$("admissionTypeId");
  select.innerHTML='<option value="">请选择具体招生途径</option>'+(category?.types||[]).filter(type=>(type.status||"active")==="active").map(type=>'<option value="'+safe(type.id)+'">'+safe(type.name)+'</option>').join("");
  if((category?.types||[]).some(type=>type.id===selectedType))select.value=selectedType;
}
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
  $("join").hidden=false;$("groups").hidden=true;$("reviewPending").hidden=true;
  setJourneyStep("profile");window.scrollTo({top:0,behavior:"smooth"});
}
function showDirectoryStage(){
  $("join").hidden=true;$("groups").hidden=false;$("reviewPending").hidden=true;
  setJourneyStep("directory");
  $("directorySchoolTitle").textContent=$("universityName").value.trim()||"尚未填写高校";
  window.scrollTo({top:0,behavior:"smooth"});loadDirectory();
}
function showAppStage(profile={}){
  document.body.classList.remove("session-checking");$("bootScreen").hidden=true;$("mainContent").hidden=false;
  $("authStage").hidden=true;$("appStage").hidden=false;$("mainNav").hidden=false;$("pageFooter").hidden=false;
  $("openAuth").hidden=true;$("changePassword").hidden=false;$("logout").hidden=false;$("gate").hidden=true;
  $("profile").hidden=false;
  const pending=profile.profileReviewStatus==="pending";
  $("reviewPending").hidden=!pending;$("join").hidden=pending;$("groups").hidden=true;
  if(pending){
    $("reviewUniversityName").textContent=profile.overseasUniversityName||profile.university||"海外高校";
    msg("reviewMsg","审核完成后，刷新本页即可进入同校团队。");
  }
  $("goDirectory").hidden=!(profile.university&&["mainland","hmt","overseas"].includes(profile.universityCategory)&&!pending&&profile.consentGiven===true);
  setJourneyStep("profile");
}
async function load(){
  try{
    const d=await call("/profile",undefined,{timeoutMs:12000}),p=d.profile||{};
    await loadProfileReferenceData();
    for(const key of ["name","className","highSchool","grade","province","city","bio","secondaryPhone","wechatId","gender","majorGroup"]) {
      const field=$("profile").elements[key];if(field)field.value=p[key]||"";
    }
    $("consent").checked=!!p.consentGiven;
    $("profilePhoneDisplay").value=p.phone||"";
    $("universityName").value=p.university||"";
    $("overseasUniversityName").value=p.overseasUniversityName||"";
    $("admissionCategoryId").value=p.admissionCategoryId||"";
    $("admissionTypeId").value=p.admissionTypeId||"";
    populateAdmissionCategories(profileReferenceData);
    categoryLocked=!!p.university||p.profileReviewStatus==="pending";
    if(p.profileReviewStatus==="pending"){
      $("universityCategoryValue").value="overseas";$("universityCategoryField").value="overseas";
      $("selectedUniversityName").textContent=p.overseasUniversityName||p.university||"审核中";
      $("universitySelectionMsg").textContent="资料已提交，等待组织者审核。";
      showAppStage(p);return;
    }
    if(p.profileUniversityId){
      categoryLocked=false;
      selectUniversityCategory(p.universityCategory);
      await openUniversityDetails();
      const rows=p.universityCategory==="mainland"?profileReferenceData.mainland.universities:profileReferenceData.hmt.universities;
      const source=rows.find(item=>item.id===p.profileUniversityId);
      if(source){
        selectUniversity({...source,_category:p.universityCategory},p.campusId||"");
        $("profileUniversityId").value=p.profileUniversityId;
        $("universityName").value=source.name;
        $("universityCategoryValue").value=p.universityCategory;
        $("universityCategoryField").value=p.universityCategory;
        $("campusSelect").disabled=false;
        if(p.campusId&&p.universityCategory==="mainland")$("campusSelect").value=p.campusId;
        if(p.universityCategory==="mainland")updateCampusFromSelection();
      }
      categoryLocked=true;
      $("universitySearch").disabled=true;$("universityBack").hidden=true;$("universityBackBottom").hidden=true;
    }else if(p.university){
      // Keep pre-catalog and legacy profiles readable without silently changing their school.
      categoryLocked=true;
      const category=universityCategories[p.universityCategory]?p.universityCategory:"mainland";
      $("universityCategoryValue").value=category;$("universityCategoryField").value=category;
      $("universityTypeStep").hidden=true;$("universityDetailsStep").hidden=false;
      $("catalogSearchWrap").hidden=true;$("overseasUniversityWrap").hidden=category!=="overseas";
      $("selectedUniversityType").textContent=universityCategories[category];
      $("selectedUniversityName").textContent=p.university;
      $("universityName").value=p.university;
      $("profileUniversityId").value="";
      $("universityCatalogId").value=p.universityCatalogId||"";
      $("universitySelectionMsg").textContent="这是历史登记的高校记录。如需更改学校，请联系组织者。";
      $("universityBack").hidden=true;$("universityBackBottom").hidden=true;
      $("admissionFields").hidden=category!=="mainland";
    }else{
      categoryLocked=false;
      showUniversityCategoryStep();
      $("universityBack").hidden=false;$("universityBackBottom").hidden=false;
      $("catalogSearchWrap").hidden=false;$("overseasUniversityWrap").hidden=true;
    }
    showAppStage(p);
  }catch(error){
    if(error.message==="unauthorized"){showAuthStage();return;}
    console.warn(error);document.body.classList.remove("session-checking");
    $("bootMessage").textContent=error.message==="request_timeout"?"服务器在 12 秒内没有响应，请检查 API 服务或网络后重试。":"暂时无法确认登录状态或加载高校数据，请检查网络后重试。";
    $("retrySession").hidden=false;
  }
}
async function loadDirectory(){
  $("directoryMsg").textContent="";
  $("directoryCount").textContent="正在加载同学资料…";
  try{
    const [data,transferData]=await Promise.all([
      call("/directory"),
      call("/teams/transfers").catch(error=>({transfers:[],transferError:error.message}))
    ]);
    directory={...data,transfers:transferData.transfers||[],transferError:transferData.transferError||""};
    render();
  }catch(error){
    $("directoryCount").textContent="暂时无法加载";
    $("directoryMsg").textContent=error.message==="unauthorized"?"登录状态已失效，请重新登录。":error.message==="consent_required"?"请先返回高校资料页，阅读并勾选新版隐私说明，然后保存资料，再查看同校通讯录。":"同学资料加载失败，请稍后重试。";
    if(error.message==="unauthorized")showAuthStage();
  }
}
function transferStatusLabel(status){
  return ({pending:"等待对方处理",accepted:"已完成转让",rejected:"对方已拒绝",expired:"已过期"})[status]||"状态未知";
}
function renderTransfers(){
  const team=directory?.team,items=directory?.transfers||[];
  $("teamSummary").hidden=!team;
  $("transferInbox").hidden=!items.length;
  if(team){
    $("teamLeaderName").textContent=team.leaderName||"暂未指定";
    $("teamLeaderGrade").textContent=team.leaderGrade||"";
    $("teamMemberCount").textContent=String(team.memberCount||0);
    $("teamMyRole").textContent=team.isLeader?"组长":"队员";
    $("leaderTransferPanel").hidden=!team.isLeader;
    const targets=directory.members||[];
    $("transferTarget").innerHTML='<option value="">请选择团队成员</option>'+targets.map(member=>'<option value="'+safe(member.id)+'">'+safe(member.name||"同学")+' · '+safe(member.grade||"年级未填写")+'</option>').join("");
    $("transferSubmit").disabled=!targets.length;
    if(team.isLeader&&!targets.length)msg("leaderTransferMsg","团队暂时没有其他成员，暂不可转让。");
    else if(team.isLeader)msg("leaderTransferMsg","你当前是该校团队组长。选择一位队员即可发起转让。");
    else msg("teamSummaryMsg","你是该校团队成员。组长转让完成后，系统会自动更新身份。");
  }
  if(items.length){
    $("transferItems").innerHTML=items.map(item=>{
      const incoming=item.status==="pending"&&item.to_user_id===directory.currentUserId;
      const direction=incoming?"收到转让邀请":item.from_user_id===directory.currentUserId?"你发起的转让":"团队转让记录";
      const participants=safe(item.fromName||"组长")+" → "+safe(item.toName||"队员");
      const actions=incoming
        ?'<div class="transfer-actions"><button type="button" class="btn" data-transfer-action="accept" data-transfer-id="'+safe(item.id)+'">接受</button><button type="button" class="ghost" data-transfer-action="reject" data-transfer-id="'+safe(item.id)+'">拒绝</button></div>'
        :"";
      return '<article class="transfer-record"><div><strong>'+participants+'</strong><small>'+safe(direction)+' · '+safe(transferStatusLabel(item.status))+'</small></div><time>'+safe(item.created_at||"")+'</time>'+actions+'</article>';
    }).join("");
  }
}
function render(){
  if(!directory)return;
  const rows=directory.members||[];
  const q=$("search").value.trim().toLowerCase();
  const filtered=rows.filter(item=>[
    item.name,item.className,item.grade,item.province,item.majorGroup,item.campusName,item.wechatId
  ].join(" ").toLowerCase().includes(q));
  $("directoryCount").textContent="共找到 "+rows.length+" 位同校同学";
  $("results").innerHTML=filtered.map(item=>{
    const phone=item.phone?String(item.phone).replace(/[^0-9+]/g,""):"";
    const second=item.secondaryPhone?String(item.secondaryPhone).replace(/[^0-9+]/g,""):"";
    const contacts=[];
    if(phone)contacts.push('<a class="contact-link" href="tel:'+safe(phone)+'">☎ '+safe(phone)+'</a>');
    if(second)contacts.push('<a class="contact-link" href="tel:'+safe(second)+'">备用电话：'+safe(second)+'</a>');
    if(item.wechatId)contacts.push('<span class="contact-link">微信：'+safe(item.wechatId)+'</span>');
    const contact=contacts.length?contacts.join(" · "):'<span class="contact-private">该同学尚未完成新版联系方式授权</span>';
    const campus=item.campusName?'<span>'+safe(item.campusName)+(item.campusTag?' · '+safe(item.campusTag):"")+'</span>':"";
    return '<article class="classmate-card panel"><div class="classmate-top"><span class="classmate-avatar">'+safe((item.name||"同").slice(0,1))+'</span><div><strong>'+safe(item.name||"同学")+'</strong><small>'+safe(item.className||"班级未填写")+'</small></div></div><div class="classmate-meta"><span>'+safe(item.grade||"年级未填写")+'</span><span>'+safe(item.province||"地区未填写")+'</span>'+campus+'<span>'+safe(item.majorGroup||"专业大类未填写")+'</span></div><div class="classmate-contact">'+contact+'</div></article>';
  }).join("")||'<div class="directory-empty"><strong>暂时没有找到同学</strong><p>'+(q?"试试其他关键词，或清空搜索条件。":"同校同学登记后会显示在这里。")+'</p></div>';
  renderTransfers();
}
$("leaderTransferForm").onsubmit=async event=>{
  event.preventDefault();
  const targetId=$("transferTarget").value;
  if(!targetId)return msg("leaderTransferMsg","请先选择一位团队成员。",true);
  $("transferSubmit").disabled=true;msg("leaderTransferMsg","正在提交转让邀请…");
  try{
    await call("/teams/transfer",{toUserId:targetId});
    msg("leaderTransferMsg","转让邀请已发出。对方接受前，你仍然是组长。");
    await loadDirectory();
  }catch(error){
    const labels={not_team_leader:"你当前不是团队组长。",transfer_target_not_in_team:"所选成员不属于当前团队。",transfer_conflict_or_pending_exists:"团队已有待处理的转让邀请，请先完成后再发起。"};
    msg("leaderTransferMsg",labels[error.message]||"转让申请失败，请稍后重试。",true);
  }finally{$("transferSubmit").disabled=false;}
};
$("transferItems").addEventListener("click",async event=>{
  const button=event.target.closest("[data-transfer-action]");
  if(!button)return;
  const action=button.dataset.transferAction,id=button.dataset.transferId;
  button.disabled=true;
  try{
    await call("/teams/transfer/"+encodeURIComponent(id)+"/"+action,{});
    await loadDirectory();
    msg("teamSummaryMsg",action==="accept"?"你已接受组长转让，团队组长身份已更新。":"你已拒绝组长转让。");
  }catch(error){
    const labels={transfer_expired:"该邀请已过期。",transfer_state_conflict:"该邀请状态已变化，请刷新列表。",transfer_forbidden:"你无权处理这条邀请。"};
    msg("teamSummaryMsg",labels[error.message]||"处理转让邀请失败，请刷新后重试。",true);
  }finally{button.disabled=false;}
});
document.querySelectorAll("[data-close]").forEach(x=>x.onclick=()=>$("modal").classList.remove("show"));
document.querySelectorAll("[data-university-category]").forEach(b=>b.onclick=()=>{
  if(categoryLocked)return;
  selectUniversityCategory(b.dataset.universityCategory);
  msg("universityCategoryMsg","已选择："+universityCategories[b.dataset.universityCategory]);
});
$("universityNext").onclick=()=>openUniversityDetails();
$("universityBack").onclick=showUniversityCategoryStep;
$("universityBackBottom").onclick=showUniversityCategoryStep;
$("campusSelect").onchange=updateCampusFromSelection;
$("admissionCategoryId").onchange=()=>{if(profileReferenceData)populateAdmissionTypes(profileReferenceData.admissions.categories,$("admissionCategoryId").value,"");};
$("overseasUniversityName").oninput=()=>{$("universityName").value=$("overseasUniversityName").value.trim();$("selectedUniversityName").textContent=$("overseasUniversityName").value.trim()||"尚未填写海外高校";};
$("reviewRefresh").onclick=async()=>{$("reviewRefresh").disabled=true;msg("reviewMsg","正在查询审核状态…");await load();$("reviewRefresh").disabled=false;};

$("universitySearch").addEventListener("input",()=>{
  clearTimeout(universitySearchTimer);
  universitySearchTimer=setTimeout(searchUniversities,250);
});
$("universitySearchResults").addEventListener("click",event=>{
  const button=event.target.closest("[data-university-index]");
  if(!button)return;
  const item=universityResults[Number(button.dataset.universityIndex)];
  if(item)selectUniversity(item);
});
["openAuth","authStageLogin","gateLogin"].forEach(x=>$(x).onclick=()=>auth("login"));$("authStageRegister").onclick=()=>auth("register");$("goDirectory").onclick=showDirectoryStage;$("backToProfile").onclick=showProfileStage;document.querySelectorAll('#mainNav a[href="#join"]').forEach(x=>x.onclick=e=>{e.preventDefault();showProfileStage()});document.querySelectorAll('#mainNav a[href="#groups"]').forEach(x=>x.onclick=e=>{e.preventDefault();if(!$("goDirectory").hidden)showDirectoryStage()});$("changePassword").onclick=()=>auth("changePassword");$("theme").onclick=()=>document.body.classList.toggle("dark");document.querySelectorAll("[data-auth]").forEach(x=>x.onclick=()=>auth(x.dataset.auth));$("forgot").onclick=()=>auth("reset");$("backLogin").onclick=()=>auth("login");$("cancelPasswordChange").onclick=()=>$("modal").classList.remove("show");$("deleteAccountOpen").onclick=()=>auth("deleteAccount");$("cancelDeleteAccount").onclick=()=>$("modal").classList.remove("show");$("deleteSend").onclick=()=>sendCode("deleteAccount");$("regSend").onclick=()=>sendCode("register");$("resetSend").onclick=()=>sendCode("reset");
$("loginForm").onsubmit=async e=>{e.preventDefault();try{await call("/auth/login",{phone:$("loginPhone").value.trim(),password:$("loginPassword").value});$("modal").classList.remove("show");await load()}catch(x){msg("loginMsg",errorText(x),true)}};
$("registerForm").onsubmit=async e=>{e.preventDefault();if($("regPass").value!==$("regPass2").value)return msg("regMsg","两次密码不一致",true);try{await call("/auth/register",{phone:$("regPhone").value.trim(),code:$("regCode").value.trim(),password:$("regPass").value,accountConsent:$("accountConsent").checked});$("modal").classList.remove("show");await load()}catch(x){msg("regMsg",errorText(x),true)}};
$("resetForm").onsubmit=async e=>{e.preventDefault();if($("resetPass").value!==$("resetPass2").value)return msg("resetMsg","两次密码不一致",true);try{await call("/auth/password/reset",{phone:$("resetPhone").value.trim(),code:$("resetCode").value.trim(),newPassword:$("resetPass").value});msg("resetMsg","密码已重置，请返回登录");setTimeout(()=>auth("login"),900)}catch(x){msg("resetMsg",errorText(x),true)}};
$("deleteAccountForm").onsubmit=async e=>{e.preventDefault();if($("deleteConfirm").value.trim()!=="DELETE")return msg("deleteMsg","请输入 DELETE 完成二次确认",true);try{await call("/account/delete",{password:$("deletePassword").value,code:$("deleteCode").value.trim(),confirmText:"DELETE"});msg("deleteMsg","账号资料已匿名化，正在退出…");$("deleteAccountForm").reset();location.replace("index.html")}catch(x){msg("deleteMsg",errorText(x),true);if(x.message==="unauthorized")setTimeout(()=>auth("login"),900)}};
$("changePasswordForm").onsubmit=async e=>{e.preventDefault();const currentPassword=$("currentPassword").value,newPassword=$("newPassword").value;if(newPassword!==$("confirmNewPassword").value)return msg("changePassMsg","两次新密码不一致",true);if(newPassword.length<10)return msg("changePassMsg","新密码至少需要 10 位",true);try{await call("/auth/password/change",{currentPassword,newPassword});msg("changePassMsg","密码修改成功，其他设备已退出登录");$("changePasswordForm").reset();document.querySelectorAll("#changePasswordForm .password-toggle").forEach(b=>{const input=$(b.dataset.togglePassword);input.type="password";b.textContent="显示"});setTimeout(()=>$("modal").classList.remove("show"),1200)}catch(x){msg("changePassMsg",errorText(x),true);if(x.message==="unauthorized")setTimeout(()=>auth("login"),900)}};
$("logout").onclick=async()=>{try{await fetch(API+"/auth/logout",{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:"{}"})}finally{location.reload()}};
$("profile").onsubmit=async event=>{
  event.preventDefault();
  const form=new FormData(event.target),data=Object.fromEntries(form.entries());
  const category=$("universityCategoryValue").value;
  data.universityCategory=category;
  data.profileUniversityId=$("profileUniversityId").value;
  data.university=category==="overseas"?$("overseasUniversityName").value.trim():$("universityName").value.trim();
  data.campusId=category==="mainland"?$("campusSelect").value:"";
  data.campusName=category==="mainland"?$("campusName").value:"";
  data.campusTag=category==="mainland"?$("campusTag").value:"";
  data.admissionCategoryId=category==="mainland"?$("admissionCategoryId").value:"";
  data.admissionTypeId=category==="mainland"?$("admissionTypeId").value:"";
  data.secondaryPhone=$("secondaryPhone").value.trim();
  data.wechatId=$("wechatId").value.trim();
  data.consent=$("consent").checked;
  if(!data.consent)return msg("profileMsg","请先阅读并同意新版个人信息保护说明",true);
  if(!["mainland","hmt","overseas"].includes(category))return msg("profileMsg","请选择高校类别",true);
  if(category==="overseas"&&!data.university)return msg("profileMsg","请填写海外高校名称",true);
  if(category!=="overseas"&&!data.profileUniversityId)return msg("profileMsg","请先从项目高校目录中选择学校",true);
  if(category==="mainland"&&!data.campusId)return msg("profileMsg","请选择实际就读校区",true);
  if(category==="mainland"&&(!data.admissionCategoryId||!data.admissionTypeId))return msg("profileMsg","请选择本科招生大类和具体招生途径",true);
  if(!data.majorGroup)return msg("profileMsg","请选择专业大类",true);
  if(data.secondaryPhone&&!phoneOK(data.secondaryPhone))return msg("profileMsg","第二手机号格式不正确",true);
  if(!data.name||!data.className||!data.grade||!data.gender)return msg("profileMsg","请完整填写姓名、性别、高中班级和当前年级",true);
  try{
    const response=await fetch(API+"/profile",{method:"PUT",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
    let result={};try{result=await response.json()}catch{}
    if(!response.ok)throw Error(result.error||"profile_save_failed");
    await load();
    if(result.reviewStatus==="pending")return;
    msg("profileMsg","资料保存成功");
    if(!$("goDirectory").hidden)showDirectoryStage();
  }catch(error){
    const errors={
      consent_required:"请先阅读并同意新版个人信息保护说明",
      profile_incomplete:"请完整填写必填资料",
      profile_reference_invalid:"学校、校区或表单选项不在当前数据目录中，请重新选择",
      university_catalog_selection_required:"请先从高校目录中选择学校",
      university_not_selectable:"所选学校当前不可用，请重新选择",
      campus_selection_required:"请选择实际就读校区",
      admission_route_required:"内地高校学生必须填写招生途径",
      major_group_required:"请选择专业大类",
      gender_required:"请选择性别",
      invalid_secondary_phone:"第二手机号格式不正确",
      overseas_university_required:"请填写海外高校名称",
      university_change_requires_support:"已登记高校暂不能自行更换，请联系组织者",
      leader_transfer_required:"当前仍是团队组长，请先完成组长转让"
    };
    msg("profileMsg",errors[error.message]||"保存失败，请检查资料后重试",true);
  }
};
document.querySelectorAll("[data-toggle-password]").forEach(b=>b.onclick=()=>{const input=$(b.dataset.togglePassword);const visible=input.type==="password";input.type=visible?"text":"password";b.textContent=visible?"隐藏":"显示"});document.querySelectorAll("[data-view]").forEach(x=>x.onclick=()=>{document.querySelectorAll("[data-view]").forEach(b=>b.classList.toggle("active",b===x));view=x.dataset.view;render()});$("search").oninput=render;if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",load,{once:true});else load();
const API="https://api.58er.eon21.space/api",SITEKEY="0x4AAAAAAF8tZfD0j4LHU8uN",$=id=>document.getElementById(id);let widgets={},tokens={},consumedTokens={},view="members",directory=null,categoryLocked=false;
const INITIAL_BOOT_MINIMUM_MS=5000;
let initialBootPending=true,initialBootAssetsReady=false,initialBootStarting=false;
let bootWelcomeDelay=Promise.resolve(),bootMinimumDelay=Promise.resolve();
function beginInitialBootPresentation(){
  $("bootScreen").hidden=false;
  $("bootLogo").hidden=false;
  $("bootMessage").hidden=false;
  $("bootWelcome").hidden=true;
  $("bootError").hidden=true;
  $("retrySession").hidden=true;
  bootWelcomeDelay=new Promise(resolve=>setTimeout(()=>{
    $("bootMessage").hidden=true;
    $("bootWelcome").hidden=false;
    resolve();
  },1400));
  bootMinimumDelay=new Promise(resolve=>setTimeout(resolve,INITIAL_BOOT_MINIMUM_MS));
}
async function preloadImageSource(source){
  if(!source)throw Error("image_source_missing");
  const image=new Image();
  image.decoding="async";
  const loaded=new Promise((resolve,reject)=>{
    image.addEventListener("load",resolve,{once:true});
    image.addEventListener("error",()=>reject(Error("image_load_failed")),{once:true});
  });
  image.src=source;
  if(image.complete){
    if(!image.naturalWidth)throw Error("image_load_failed");
  }else{
    await loaded;
  }
  if(typeof image.decode==="function")await image.decode();
  if(!image.naturalWidth)throw Error("image_decode_failed");
}
async function waitForLogoElement(image){
  if(!image.complete){
    await new Promise((resolve,reject)=>{
      image.addEventListener("load",resolve,{once:true});
      image.addEventListener("error",()=>reject(Error("logo_element_load_failed")),{once:true});
    });
  }
  if(!image.naturalWidth)throw Error("logo_element_load_failed");
  if(typeof image.decode==="function")await image.decode();
}
async function preloadBootLogo(image){
  const active=image.dataset.activeThemeSrc||image.currentSrc||image.src;
  const fallback=image.dataset.fallbackSrc||image.dataset.lightSrc;
  let target=active;
  try{
    await preloadImageSource(active);
  }catch(error){
    if(!fallback||fallback===active)throw error;
    await preloadImageSource(fallback);
    target=fallback;
  }
  const normalizedTarget=new URL(target,document.baseURI).href;
  if(image.src!==normalizedTarget)image.src=target;
  image.dataset.activeThemeSrc=target;
  await waitForLogoElement(image);
}
async function preloadInitialBootAssets(){
  if(document.readyState!=="complete"){
    await new Promise(resolve=>document.addEventListener("DOMContentLoaded",resolve,{once:true}));
  }
  if(!document.fonts||typeof document.fonts.load!=="function")throw Error("font_loading_unavailable");
  const [titleFaces,bodyFaces]=await Promise.all([
    document.fonts.load('400 28px "LXGW WenKai Lite"',"欢迎回到青岛五十八中"),
    document.fonts.load('400 15px "Source Han Sans CN"',"正在确认登录状态…")
  ]);
  await document.fonts.ready;
  if(!titleFaces.some(face=>face.status==="loaded")||!bodyFaces.some(face=>face.status==="loaded")){
    throw Error("local_font_load_failed");
  }
  const logos=[$("bootLogo"),document.querySelector(".art-logo")].filter(Boolean);
  await Promise.all(logos.map(preloadBootLogo));
}
async function startInitialSessionRestore(){
  if(initialBootAssetsReady||initialBootStarting)return;
  initialBootStarting=true;
  $("bootScreen").hidden=true;
  try{
    await preloadInitialBootAssets();
    initialBootAssetsReady=true;
  }catch(error){
    console.warn("Initial page assets failed to load",error?.message||"unknown");
    $("bootLogo").hidden=true;
    $("bootMessage").hidden=true;
    $("bootWelcome").hidden=true;
    $("bootError").textContent="页面字体或校徽暂时无法加载，请检查网络后重试。";
    $("bootError").hidden=false;
    $("retrySession").hidden=false;
    $("bootScreen").hidden=false;
    initialBootStarting=false;
    return;
  }
  initialBootStarting=false;
  beginInitialBootPresentation();
  load({initial:true}).catch(error=>console.warn("Initial session restore failed",error?.message||"unknown"));
}
async function animateBootIntoLanding(action){
  const bootLogo=$("bootLogo");
  const bootWelcome=$("bootWelcome");
  const targetLogo=document.querySelector(".art-logo");
  const heroCopy=document.querySelector(".hero-copy");
  const reducedMotion=window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  if(reducedMotion||!bootLogo||!targetLogo||typeof bootLogo.animate!=="function"){
    action();
    return;
  }

  const start=bootLogo.getBoundingClientRect();
  if(!start.width||!start.height){
    action();
    return;
  }

  const flight=bootLogo.cloneNode(false);
  flight.removeAttribute("id");
  flight.className="boot-logo boot-logo-flight";
  Object.assign(flight.style,{
    position:"fixed",
    top:start.top+"px",
    left:start.left+"px",
    width:start.width+"px",
    height:start.height+"px",
    margin:"0",
    zIndex:"1001",
    pointerEvents:"none",
    transformOrigin:"top left",
    animation:"none"
  });
  document.body.appendChild(flight);

  if(bootWelcome&&typeof bootWelcome.animate==="function"){
    const welcomeFade=bootWelcome.animate(
      [{opacity:1,transform:"translateY(0)"},{opacity:0,transform:"translateY(-8px)"}],
      {duration:380,easing:"cubic-bezier(.4,0,.2,1)",fill:"forwards"}
    );
    try{await welcomeFade.finished}catch{}
  }

  targetLogo.style.opacity="0";
  action();
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));

  const target=targetLogo.getBoundingClientRect();
  if(!target.width||!target.height){
    flight.remove();
    targetLogo.style.opacity="";
    return;
  }

  const dx=target.left-start.left;
  const dy=target.top-start.top;
  const scale=target.width/start.width;
  const flightAnimation=flight.animate(
    [
      {transform:"translate3d(0,0,0) scale(1)"},
      {transform:`translate3d(${dx}px,${dy}px,0) scale(${scale})`}
    ],
    {duration:1120,easing:"cubic-bezier(.2,.78,.22,1)",fill:"forwards"}
  );
  const logoReveal=targetLogo.animate(
    [{opacity:0},{opacity:1}],
    {duration:300,delay:850,easing:"ease-out",fill:"forwards"}
  );
  const copyReveal=heroCopy?.animate(
    [
      {opacity:0,transform:"translateY(16px)"},
      {opacity:1,transform:"translateY(0)"}
    ],
    {duration:760,delay:260,easing:"cubic-bezier(.2,.75,.25,1)",fill:"both"}
  );

  try{
    await Promise.all([
      flightAnimation.finished,
      logoReveal.finished,
      ...(copyReveal?[copyReveal.finished]:[])
    ]);
  }catch{}
  flight.remove();
  logoReveal.cancel();
  targetLogo.style.opacity="";
  if(copyReveal)copyReveal.cancel();
}

async function finishInitialBoot(action){
  if(initialBootPending){
    await bootWelcomeDelay;
    await bootMinimumDelay;
    initialBootPending=false;
    if(action===showAuthStage){
      await animateBootIntoLanding(action);
      return;
    }
  }
  action();
}
function initFaqScrollReveal(){
  if(initFaqScrollReveal.done)return;
  initFaqScrollReveal.done=true;
  const heading=document.querySelector(".home-faq-heading");
  const cards=[...document.querySelectorAll(".home-faq-card")];
  const targets=[...(heading?[heading]:[]),...cards];
  if(!targets.length)return;

  const reduce=window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  if(reduce||typeof IntersectionObserver!=="function"){
    targets.forEach(target=>target.classList.add("is-revealed"));
    return;
  }

  targets.forEach(target=>target.classList.add("reveal-pending"));
  const observer=new IntersectionObserver(entries=>{
    entries.forEach(entry=>{
      if(!entry.isIntersecting)return;
      entry.target.classList.remove("reveal-pending");
      entry.target.classList.add("is-revealed");
      observer.unobserve(entry.target);
    });
    if(!observer.takeRecords().length&&targets.every(target=>target.classList.contains("is-revealed"))){
      observer.disconnect();
    }
  },{threshold:.12,rootMargin:"0px 0px -5% 0px"});
  targets.forEach(target=>observer.observe(target));
}
const phoneOK=p=>/^1[3-9]\d{9}$/.test(p);
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
let modalScrollY=0;
function openAuthModal(){
  const modal=$("modal");
  if(modal.classList.contains("show"))return;
  modalScrollY=window.scrollY||window.pageYOffset||0;
  document.documentElement.classList.add("modal-scroll-locked");
  document.body.style.setProperty("--modal-scroll-y",`-${modalScrollY}px`);
  document.body.classList.add("modal-scroll-locked");
  modal.classList.add("show");
  modal.setAttribute("aria-hidden","false");
}
function closeAuthModal(){
  const modal=$("modal");
  if(!modal.classList.contains("show"))return;
  modal.classList.remove("show");
  modal.setAttribute("aria-hidden","true");
  document.body.classList.remove("modal-scroll-locked");
  document.documentElement.classList.remove("modal-scroll-locked");
  document.body.style.removeProperty("--modal-scroll-y");
  window.scrollTo(0,modalScrollY);
}
function auth(v="login"){openAuthModal();["login","register","reset","changePassword","deleteAccount"].forEach(x=>$(x+"Form").hidden=x!==v);$("authTabs").hidden=v==="reset"||v==="changePassword"||v==="deleteAccount";document.querySelectorAll("[data-auth]").forEach(b=>b.classList.toggle("active",b.dataset.auth===v));if(v==="register"||v==="reset"||v==="deleteAccount")captcha(v)}
function captcha(v){if(!window.turnstile||widgets[v]!==undefined)return;const target={register:"regCaptcha",reset:"resetCaptcha",deleteAccount:"deleteCaptcha"}[v];const action={register:"register",reset:"password_reset",deleteAccount:"account_delete"}[v];widgets[v]=turnstile.render("#"+target,{sitekey:SITEKEY,theme:"auto",action,callback:t=>{tokens[v]=t;consumedTokens[v]=false;},"expired-callback":()=>{tokens[v]="";consumedTokens[v]=false;},"error-callback":()=>{tokens[v]="";consumedTokens[v]=false;}})}function resetCaptcha(v){if(window.turnstile&&widgets[v]!==undefined)turnstile.reset(widgets[v]);tokens[v]="";consumedTokens[v]=false}
function errorText(e){if(e.message==="consent_required")return "请先阅读隐私说明并勾选同意";if(e.message==="sms_not_configured")return "短信服务未配置完整：请检查 Worker 的 ALIBABA_ACCESS_KEY_ID、ALIBABA_ACCESS_KEY_SECRET、ALIBABA_SIGN_NAME 和 ALIBABA_TEMPLATE_CODE。";if(e.message==="rate_limit_secret_not_configured")return "短信安全限流配置缺失：Worker 需要 RATE_LIMIT_HMAC_SECRET（至少 32 位）。";if(e.message==="turnstile_failed")return "Cloudflare 验证未能被后端确认：请刷新页面重新验证；若持续出现，请检查 Worker 的 TURNSTILE_SECRET_KEY 是否对应当前站点。";if(e.message==="current_password_invalid")return "当前密码不正确，请重新输入";if(e.message==="same_password")return "新密码不能与当前密码相同";if(e.message==="password_change_conflict"||e.message==="password_reset_conflict")return "密码状态刚刚发生变化，请重新验证后再试";if(e.message==="weak_password")return "密码长度需要为 10–128 位";if(e.message==="unauthorized")return "登录状态已失效，请重新登录";if(e.message==="university_metadata_conflict")return "这所高校的地区或办学层次与已有资料不一致，请联系组织者核对";if(e.message==="university_catalog_selection_required")return "请从高校目录中选择一所已核验高校";if(e.message==="university_not_selectable")return "所选高校尚未核验或已停用，请重新搜索选择";if(e.message==="leader_transfer_required")return "你目前仍是有其他队员的队长，请先完成队长转让后再删除账号";if(e.message==="account_delete_confirm_required")return "请输入 DELETE 完成二次确认";if(e.message==="account_delete_conflict")return "账号状态刚刚发生变化，请重新登录后检查";if(e.message==="rate_limited"){const scope=e.details?.limitScope;if(scope==="phone_daily")return "本手机号今日短信额度已用完，请在倒计时结束后重试";if(scope==="ip_hourly")return "当前网络短信请求过于频繁，请稍后重试";if(scope==="cooldown")return "发送间隔不足，请稍后重试";return "操作过于频繁，请稍后再试"}return ({invalid_credentials:"手机号或密码错误",invalid_phone:"手机号格式不正确",invalid_code:"验证码错误或已过期",rate_limited:"操作过于频繁，请稍后再试",turnstile_failed:"人机验证未通过",phone_already_registered:"该手机号已有账号，请直接登录；如忘记密码，请使用“忘记密码”"})[e.message]||"暂时无法完成操作，请稍后重试"}
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
  $("clearSelectedUniversity").hidden=true;$("continueToDetails").hidden=true;
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
  syncProfileStageActions();
}
async function openUniversityDetails(){
  const category=$("universityCategoryValue").value;
  if(!universityCategories[category])return msg("universityCategoryMsg","请先选择高校类别",true);
  $("universityTypeStep").hidden=true;
  $("universityDetailsStep").hidden=false;
  syncProfileStageActions();
  $("selectedUniversityType").textContent=universityCategories[category];
  $("universityBack").hidden=categoryLocked;
  $("universitySearch").disabled=categoryLocked;
  $("catalogSearchWrap").hidden=category==="overseas";
  $("overseasUniversityWrap").hidden=category!=="overseas";
  $("admissionFields").hidden=category!=="mainland";
  $("admissionCategoryId").required=category==="mainland";
  try{
    const refs=await loadProfileReferenceData();
    populateMajorDisciplines(refs,selectedUniversity?.tags||[]);
    populateAdmissionCategories(refs);
    if(category!=="overseas"&&!categoryLocked)searchUniversities();
  }catch(error){
    $("universitySearchResults").innerHTML='<p class="university-search-empty">高校数据文件加载失败，请检查 Pages 中 data/profile-sources/ 目录。</p>';
    msg("profileMsg","登记数据暂时无法加载，请刷新页面后重试。",true);
  }
}
const UNIVERSITY_LEVEL_TAG_LABELS=Object.freeze({
  project_985:"985工程",
  project_211:"211工程",
  double_first_class:"双一流"
});
function universityLevelTags(item){
  return [...new Set((Array.isArray(item?.tags)?item.tags:[]).map(tag=>UNIVERSITY_LEVEL_TAG_LABELS[tag]).filter(Boolean))];
}
function renderUniversitySearchResults(rows){
  const container=$("universitySearchResults");
  if(!rows.length){
    container.innerHTML='<p class="university-search-empty">没有找到匹配高校，请检查名称或换一个关键词。</p>';
    return;
  }
  container.innerHTML=rows.map((item,index)=>{
    const location=item._category==="mainland"?[item.province_or_state,item.city].filter(Boolean).join(" · "):(item.region||"");
    const tags=universityLevelTags(item);
    const tagMarkup=tags.length?'<span class="university-result-tags" aria-label="高校层次">'+tags.map(tag=>'<span class="university-tag-chip">'+safe(tag)+'</span>').join("")+'</span>':"";
    const locationMarkup=location?'<small>'+safe(location)+'</small>':"";
    return '<button type="button" class="university-result" data-university-index="'+index+'"><span><strong>'+safe(item.name)+'</strong>'+locationMarkup+tagMarkup+'</span><span class="university-result-action">选择</span></button>';
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
  $("clearSelectedUniversity").hidden=false;$("continueToDetails").hidden=false;
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
    populateMajorDisciplines(profileReferenceData,item.tags||[]);
    $("admissionFields").hidden=false;
    $("admissionCategoryId").required=true;
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
    populateMajorDisciplines(profileReferenceData,item.tags||[]);
  }
}
async function clearSelectedUniversity(){
  if(!confirm("移除当前高校会立即清空这位同学的个人登记资料（姓名、性别、年级、专业、联系方式、寄语和隐私同意），但保留账号、登录密码及历史组长转让记录。是否继续？"))return;
  const button=$("clearSelectedUniversity");
  button.disabled=true;
  try{
    await call("/profile/reset",{});
    categoryLocked=false;selectedUniversity=null;universityResults=[];universitySearchSequence++;clearTimeout(universitySearchTimer);
    $("profileUniversityId").value="";$("universityCatalogId").value="";$("universityName").value="";
    $("universityCategoryValue").value="";$("universityCategoryField").value="";
    $("selectedUniversityName").textContent="尚未选择高校";
    $("universitySelectionMsg").textContent="请重新选择高校类别和学校。";
    $("universitySearch").value="";$("universitySearch").disabled=false;
    $("universitySearchResults").innerHTML="";
    $("overseasUniversityName").value="";$("profileProvince").value="";$("profileCity").value="";
    $("campusSelectionWrap").hidden=true;$("campusSelect").required=false;$("campusSelect").value="";
    $("campusName").value="";$("campusTag").value="";
    $("admissionFields").hidden=true;$("admissionCategoryId").required=false;$("admissionCategoryId").value="";
    for(const id of ["name","highSchool","grade","gender","majorDisciplineCode","secondaryPhone","wechatId"]){
      const field=$("profile").elements[id];if(field)field.value="";
    }
    $("profile").elements.greeting.value="";
    $("profile").elements.highSchool.value="青岛五十八中";
    $("profile").elements.grade.value="大一";
    $("consent").checked=false;
    $("goDirectory").hidden=true;
    $("clearSelectedUniversity").hidden=true;$("continueToDetails").hidden=true;
    $("universityBack").hidden=false;
    document.querySelectorAll("[data-university-category]").forEach(item=>item.classList.remove("selected"));
    showUniversityCategoryStep();
    showRegistrationStep("university");
    msg("universityCategoryMsg","已清空原高校和个人登记资料。账号及历史组长转让记录已保留，请重新填写。");
  }catch(error){
    const message={
      team_leader_transfer_required:"你仍是原大学团队的组长，而且团队还有其他成员。请先完成组长转让，再移除高校。",
      leader_transfer_pending:"原团队仍有待处理的组长转让，请先处理该申请后再移除高校。",
      profile_reset_conflict:"资料状态刚刚发生变化，请刷新页面后重试。"
    };
    msg("universitySelectionMsg",message[error.message]||"移除失败，原资料没有清空。请稍后重试。",true);
  }finally{
    button.disabled=false;
  }
}
function populateMajorDisciplines(refs,tags=[]){
  if(!refs)return;
  const categories=refs.majors.categories.filter(item=>item.enabled!==false&&
    (item.code!=="11"||(tags||[]).includes("military_academy")));
  const current=$("majorDisciplineCode").value;
  $("majorDisciplineCode").innerHTML='<option value="">请选择专业大类</option>'+categories.map(item=>
    '<option value="'+safe(item.code)+'">'+safe(item.name)+'</option>'
  ).join("");
  if(categories.some(item=>item.code===current))$("majorDisciplineCode").value=current;
}
function populateAdmissionCategories(refs){
  const select=$("admissionCategoryId");
  const current=select.value;
  select.innerHTML='<option value="">请选择招生大类</option>'+refs.admissions.categories.map(item=>
    '<option value="'+safe(item.id)+'">'+safe(item.name)+'</option>'
  ).join("");
  if(refs.admissions.categories.some(item=>item.id===current))select.value=current;
}
function safe(s){return String(s||"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]))}
function showAuthStage(){
  document.body.classList.remove("session-checking");
  $("bootScreen").hidden=true;
  $("mainContent").hidden=false;
  $("authStage").hidden=false;
  $("appStage").hidden=true;
  $("pageFooter").hidden=true;
  $("changePassword").hidden=true;
  $("logout").hidden=true;
  initFaqScrollReveal();
}
function setJourneyStep(step){
  document.querySelectorAll("[data-journey-step]").forEach(button=>{
    const active=button.dataset.journeyStep===step;
    button.classList.toggle("active",active);
    if(active)button.setAttribute("aria-current","step");
    else button.removeAttribute("aria-current");
  });
}
function syncProfileStageActions(){
  const universityVisible=!$("registrationUniversityPanel").hidden;
  const profileVisible=!$("registrationDetailsPanel").hidden;
  $("universityTypeActions").hidden=!(universityVisible&&!$("universityTypeStep").hidden);
  $("universityDetailsActions").hidden=!(universityVisible&&!$("universityDetailsStep").hidden);
  $("profileStageActions").hidden=!profileVisible;
}
function hasUniversitySelection(){
  const category=$("universityCategoryValue").value;
  return !!$("profileUniversityId").value || (category==="overseas"&&!!$("overseasUniversityName").value.trim()) ||
    (!!$("universityName").value.trim()&&!!$("universityCategoryField").value);
}
function showRegistrationStep(step){
  if(step==="directory")return showDirectoryStage();
  if(step==="profile"&&!hasUniversitySelection()){
    msg("universityCategoryMsg","请先选择高校和校区，再填写个人资料。",true);
    step="university";
  }
  $("join").hidden=false;$("groups").hidden=true;$("reviewPending").hidden=true;
  $("registrationUniversityPanel").hidden=step!=="university";
  $("registrationDetailsPanel").hidden=step!=="profile";
  syncProfileStageActions();
  setJourneyStep(step);
  window.scrollTo({top:0,behavior:"smooth"});
}
function showUniversityStage(){showRegistrationStep("university");}
function showProfileStage(){showRegistrationStep("profile");}
function showDirectoryStage(){
  if($("goDirectory").hidden){
    msg("profileMsg","请先完成资料并保存，再进入同校同学页面。",true);
    showRegistrationStep(hasUniversitySelection()?"profile":"university");
    return;
  }
  $("join").hidden=true;$("groups").hidden=false;$("reviewPending").hidden=true;
  $("registrationUniversityPanel").hidden=true;
  $("registrationDetailsPanel").hidden=true;
  syncProfileStageActions();
  setJourneyStep("directory");
  $("directorySchoolTitle").textContent=$("universityName").value.trim()||$("selectedUniversityName").textContent||"尚未填写高校";
  window.scrollTo({top:0,behavior:"smooth"});loadDirectory();
}
function showAppStage(profile={}){
  document.body.classList.remove("session-checking");$("bootScreen").hidden=true;$("mainContent").hidden=false;
  $("authStage").hidden=true;$("appStage").hidden=false;
  $("siteFooterTitle").textContent=document.title;
  $("pageFooter").hidden=false;
  $("changePassword").hidden=false;$("logout").hidden=false;$("accountBottom").hidden=false;$("gate").hidden=true;
  $("profile").hidden=false;
  const pending=profile.profileReviewStatus==="pending";
  $("reviewPending").hidden=!pending;
  $("journeySteps").hidden=pending;
  $("goDirectory").hidden=!(profile.university&&["mainland","hmt","sino_foreign","overseas"].includes(profile.universityCategory)&&!pending&&profile.consentGiven===true);
  if(pending){
    $("join").hidden=true;$("groups").hidden=true;
    $("reviewUniversityName").textContent=profile.overseasUniversityName||profile.university||"海外高校";
    msg("reviewMsg","审核完成后，刷新本页即可进入同校团队。");
    return;
  }
  if(profile.university&&profile.consentGiven===true&&!$("goDirectory").hidden){
    showDirectoryStage();
  }else if(profile.university){
    showRegistrationStep("profile");
  }else{
    showRegistrationStep("university");
  }
}
async function load({initial=false}={}){
  try{
    const d=await call("/profile",undefined,{timeoutMs:12000}),p=d.profile||{};
    await loadProfileReferenceData();
    for(const key of ["name","highSchool","grade","province","city","greeting","secondaryPhone","wechatId","gender","majorDisciplineCode"]) {
      const field=$("profile").elements[key];if(field)field.value=p[key]||(key==="highSchool"?"青岛五十八中":key==="grade"?"大一":"");
    }
    $("consent").checked=!!p.consentGiven;
    $("profilePhoneDisplay").value=p.phone||"";
    $("universityName").value=p.university||"";
    $("overseasUniversityName").value=p.overseasUniversityName||"";
    $("admissionCategoryId").value=p.admissionCategoryId||"";
    populateAdmissionCategories(profileReferenceData);
    $("admissionCategoryId").value=p.admissionCategoryId||"";
    categoryLocked=!!p.university||p.profileReviewStatus==="pending";
    if(p.profileReviewStatus==="pending"){
      $("universityCategoryValue").value="overseas";$("universityCategoryField").value="overseas";
      $("selectedUniversityName").textContent=p.overseasUniversityName||p.university||"审核中";
      $("universitySelectionMsg").textContent="资料已提交，等待组织者审核。";
      if(initial)await finishInitialBoot(()=>showAppStage(p));
      else showAppStage(p);
      return;
    }
    if(p.profileUniversityId){
      categoryLocked=false;
      selectUniversityCategory(p.universityCategory);
      await openUniversityDetails();
      const rows=p.universityCategory==="mainland"?profileReferenceData.mainland.universities:profileReferenceData.hmt.universities;
      const source=rows.find(item=>item.id===p.profileUniversityId);
      if(source){
        selectUniversity({...source,_category:p.universityCategory},p.campusId||"");
        $("majorDisciplineCode").value=p.majorDisciplineCode||"";
        $("profileUniversityId").value=p.profileUniversityId;
        $("universityName").value=source.name;
        $("universityCategoryValue").value=p.universityCategory;
        $("universityCategoryField").value=p.universityCategory;
        $("campusSelect").disabled=false;
        if(p.campusId&&p.universityCategory==="mainland")$("campusSelect").value=p.campusId;
        if(p.universityCategory==="mainland")updateCampusFromSelection();
      }
      categoryLocked=true;
      $("universitySearch").disabled=true;$("universityBack").hidden=true;
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
      $("universitySelectionMsg").textContent="这是已登记的高校。如需更改，请先移除所选高校再重新选择。";
      $("universityBack").hidden=true;$("clearSelectedUniversity").hidden=false;$("continueToDetails").hidden=false;
      $("admissionFields").hidden=category!=="mainland";
      let legacyTags=[];try{legacyTags=JSON.parse(p.projectTags||"[]");if(!Array.isArray(legacyTags))legacyTags=[];}catch{}
      populateMajorDisciplines(profileReferenceData,legacyTags);
      $("majorDisciplineCode").value=p.majorDisciplineCode||"";
    }else{
      categoryLocked=false;
      showUniversityCategoryStep();
      $("universityBack").hidden=false;
      $("catalogSearchWrap").hidden=false;$("overseasUniversityWrap").hidden=true;
    }
    if(initial)await finishInitialBoot(()=>showAppStage(p));
    else showAppStage(p);
  }catch(error){
    if(error.message==="unauthorized"){
      if(initial)await finishInitialBoot(showAuthStage);
      else showAuthStage();
      return;
    }
    console.warn(error);
    const showError=()=>{
      document.body.classList.remove("session-checking");
      $("bootError").textContent=error.message==="request_timeout"
        ?"服务器在 12 秒内没有响应，请检查 API 服务或网络后重试。"
        :"暂时无法确认登录状态或加载高校数据，请检查网络后重试。";
      $("bootError").hidden=false;
      $("retrySession").hidden=false;
    };
    if(initial)await finishInitialBoot(showError);
    else showError();
  }
}
function renderDonationList(items){
  const container=$("donationListRows");
  const summary=$("donationListSummary");
  if(!container||!summary)return;
  const rows=Array.isArray(items)?items:[];
  summary.textContent=rows.length+" 位支持者";
  if(!rows.length){
    container.innerHTML='<p class="donation-list-empty">赞助名单正在整理中。感谢每一位愿意支持本项目的校友。</p>';
    return;
  }
  container.innerHTML=rows.map((item,index)=>{
    const cents=Number(item.amountCents)||0;
    const amount=(cents/100).toLocaleString("zh-CN",{minimumFractionDigits:2,maximumFractionDigits:2});
    return '<article class="donation-list-row"><span class="donation-list-rank">'+String(index+1).padStart(2,"0")+'</span><strong>'+safe(item.nickname||"匿名校友")+'</strong><span class="donation-list-amount">¥ '+amount+'</span></article>';
  }).join("");
}
async function loadDirectory(){
  $("directoryMsg").textContent="";
  $("directoryCount").textContent="正在加载同学资料…";
  try{
    const [data,transferData,groupChatData,donationData]=await Promise.all([
      call("/directory"),
      call("/teams/transfers").catch(error=>({transfers:[],transferError:error.message})),
      call("/group-chat/status").catch(error=>({error:error.message})),
      call("/donations").catch(error=>({items:[]}))
    ]);
    directory={...data,transfers:transferData.transfers||[],transferError:transferData.transferError||"",groupChat:groupChatData};
    renderDonationList(donationData.items||[]);
    render();
    await renderGroupChat();
  }catch(error){
    $("directoryCount").textContent="暂时无法加载";
    $("directoryMsg").textContent=error.message==="unauthorized"?"登录状态已失效，请重新登录。":error.message==="consent_required"?"请先返回高校资料页，阅读并勾选新版隐私说明，然后保存资料，再查看同校通讯录。":"同学资料加载失败，请稍后重试。";
    if(error.message==="unauthorized")showAuthStage();
  }
}
let groupChatObjectUrl="";
async function renderGroupChat(){
  const panel=$("groupChatPanel"),state=directory?.groupChat||{};
  panel.hidden=false;
  $("groupChatQrImage").hidden=true;
  $("groupChatQrPlaceholder").hidden=false;
  $("confirmGroupChat").hidden=true;
  if(state.error){
    $("groupChatRegionTitle").textContent="省份群聊";
    $("groupChatStatusBadge").textContent="暂不可用";
    $("groupChatStatusText").textContent=state.error==="group_chat_university_required"?"请先完成高校登记后查看对应群聊。":"群聊信息暂时无法加载，请稍后刷新页面。";
    return;
  }
  $("groupChatRegionTitle").textContent=(state.regionLabel||"所在地区")+"群聊";
  $("groupChatRuleNote").textContent=state.mappingRule||"内地按高校校本部所在省份分组，不按本人就读的异地校区分组。港澳台统一使用港澳台群，海外统一使用海外群。";
  if(!state.configured){
    $("groupChatStatusBadge").textContent="二维码待上传";
    $("groupChatStatusText").textContent="管理员尚未上传"+(state.regionLabel||"该地区")+"的群聊二维码。";
    return;
  }
  $("groupChatQrPlaceholder").textContent="正在加载群聊二维码…";
  try{
    const response=await fetch(API+"/group-chat/qr-image",{credentials:"include",cache:"no-store"});
    if(!response.ok)throw new Error("group_qr_image_unavailable");
    const blob=await response.blob();
    if(groupChatObjectUrl)URL.revokeObjectURL(groupChatObjectUrl);
    groupChatObjectUrl=URL.createObjectURL(blob);
    $("groupChatQrImage").src=groupChatObjectUrl;
    $("groupChatQrImage").alt=state.regionLabel+"群聊二维码";
    $("groupChatQrImage").hidden=false;
    $("groupChatQrPlaceholder").hidden=true;
    if(state.confirmed){
      $("groupChatStatusBadge").textContent="已确认加入";
      $("groupChatStatusText").textContent="你已于 "+state.confirmedAt+" 确认加入该地区群聊。";
    }else{
      $("groupChatStatusBadge").textContent=state.needsReconfirm?"需要重新确认":"待确认";
      $("groupChatStatusText").textContent=state.needsReconfirm?"管理员更新了群聊二维码，请核对并重新加入后确认。":"请使用微信扫描上方二维码加入群聊，完成后点击下方按钮。";
      $("confirmGroupChat").hidden=false;
      $("confirmGroupChat").disabled=false;
      $("confirmGroupChat").textContent="确认已加入群聊";
    }
  }catch(error){
    $("groupChatQrPlaceholder").hidden=false;
    $("groupChatQrPlaceholder").textContent="二维码加载失败，请刷新页面重试。";
    $("groupChatStatusText").textContent="无法读取群聊二维码。";
  }
}
$("confirmGroupChat").onclick=async()=>{
  const button=$("confirmGroupChat");
  button.disabled=true;
  button.textContent="正在保存确认状态…";
  try{
    await call("/group-chat/confirm",{});
    directory.groupChat=await call("/group-chat/status");
    await renderGroupChat();
  }catch(error){
    button.disabled=false;
    button.textContent="确认已加入群聊";
    $("groupChatStatusText").textContent=error.message==="group_qr_not_configured"?"管理员尚未上传该地区二维码。":"确认状态保存失败，请稍后重试。";
  }
};
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
      const currentTeam=item.isCurrentTeam===true||Number(item.isCurrentTeam)===1;
      const canRespond=incoming&&currentTeam;
      const direction=incoming?"收到转让邀请":item.from_user_id===directory.currentUserId?"你发起的转让":"团队转让记录";
      const participants=safe(item.fromName||"原组长")+" → "+safe(item.toName||"原队员");
      const school=safe(item.university||"未知高校");
      const association=currentTeam?"当前团队":"历史团队";
      const stale=incoming&&!currentTeam&&item.status==="pending"?" · 已离开该校，不能再响应":"";
      const actions=canRespond
        ?'<div class="transfer-actions"><button type="button" class="btn" data-transfer-action="accept" data-transfer-id="'+safe(item.id)+'">接受</button><button type="button" class="ghost" data-transfer-action="reject" data-transfer-id="'+safe(item.id)+'">拒绝</button></div>'
        :"";
      return '<article class="transfer-record"><div><strong>'+participants+'</strong><small><b class="transfer-school">'+school+'</b> · '+association+' · '+safe(direction)+' · '+safe(transferStatusLabel(item.status))+stale+'</small></div><time>'+safe(item.created_at||"")+'</time>'+actions+'</article>';
    }).join("");
  }
}
function render(){
  if(!directory)return;
  const rows=directory.members||[];
  const q=$("search").value.trim().toLowerCase();
  const filtered=rows.filter(item=>[
    item.name,item.highSchool,item.grade,item.province,item.majorDisciplineCode,item.campusName,item.wechatId
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
    const majorName=profileReferenceData?.majors.categories.find(category=>category.code===item.majorDisciplineCode)?.name||"专业大类未填写";
    return '<article class="classmate-card panel"><div class="classmate-top"><span class="classmate-avatar">'+safe((item.name||"同").slice(0,1))+'</span><div><strong>'+safe(item.name||"同学")+'</strong><small>'+safe(item.highSchool||"青岛五十八中")+'</small></div></div><div class="classmate-meta"><span>'+safe(item.grade||"年级未填写")+'</span><span>'+safe(item.province||"地区未填写")+'</span>'+campus+'<span>'+safe(majorName)+'</span></div><div class="classmate-contact">'+contact+'</div></article>';
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
    const labels={transfer_expired:"该邀请已过期。",transfer_state_conflict:"该邀请状态已变化，请刷新列表。",transfer_forbidden:"你无权处理这条邀请。",transfer_school_mismatch:"这条转让记录属于以前的高校，不能在当前高校处理。"};
    msg("teamSummaryMsg",labels[error.message]||"处理转让邀请失败，请刷新后重试。",true);
  }finally{button.disabled=false;}
});
document.querySelectorAll("[data-close]").forEach(x=>x.onclick=()=>closeAuthModal());
document.querySelectorAll("[data-university-category]").forEach(b=>b.onclick=()=>{
  if(categoryLocked)return;
  selectUniversityCategory(b.dataset.universityCategory);
  msg("universityCategoryMsg","已选择："+universityCategories[b.dataset.universityCategory]);
});
$("universityNext").onclick=()=>openUniversityDetails();
$("universityBack").onclick=showUniversityCategoryStep;

$("campusSelect").onchange=updateCampusFromSelection;
$("admissionCategoryId").onchange=()=>{};
$("overseasUniversityName").oninput=()=>{
  const value=$("overseasUniversityName").value.trim();
  $("universityName").value=value;
  $("selectedUniversityName").textContent=value||"尚未填写海外高校";
  $("universitySelectionMsg").textContent=value?"已填写海外高校名称，提交后进入审核。":"请填写目前就读的海外大学名称。";
  $("clearSelectedUniversity").hidden=!value;
  $("continueToDetails").hidden=!value;
};
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
$("regPhone").addEventListener("input",()=>{$("regExistingAccount").hidden=true});
$("regGoLogin").onclick=()=>{$("loginPhone").value=$("regPhone").value.trim();auth("login")};
["authStageLogin","gateLogin"].forEach(x=>$(x).onclick=()=>auth("login"));$("authStageRegister").onclick=()=>auth("register");
$("goDirectory").onclick=showDirectoryStage;$("backToProfile").onclick=showProfileStage;
document.querySelectorAll("[data-journey-step]").forEach(button=>button.onclick=()=>{
  const step=button.dataset.journeyStep;
  if(step==="directory")showDirectoryStage();else showRegistrationStep(step);
});
$("continueToDetails").onclick=()=>showRegistrationStep("profile");
$("backToUniversityStep").onclick=showRegistrationStep.bind(null,"university");
$("clearSelectedUniversity").onclick=clearSelectedUniversity;$("changePassword").onclick=()=>auth("changePassword");document.querySelectorAll("[data-auth]").forEach(x=>x.onclick=()=>auth(x.dataset.auth));$("forgot").onclick=()=>auth("reset");$("backLogin").onclick=()=>auth("login");$("cancelPasswordChange").onclick=()=>closeAuthModal();$("deleteAccountOpen").onclick=()=>auth("deleteAccount");$("cancelDeleteAccount").onclick=()=>closeAuthModal();$("deleteSend").onclick=()=>sendCode("deleteAccount");$("regSend").onclick=()=>sendCode("register");$("resetSend").onclick=()=>sendCode("reset");
$("loginForm").onsubmit=async e=>{e.preventDefault();try{await call("/auth/login",{phone:$("loginPhone").value.trim(),password:$("loginPassword").value});closeAuthModal();await load()}catch(x){msg("loginMsg",errorText(x),true)}};
$("registerForm").onsubmit=async e=>{e.preventDefault();const phone=$("regPhone").value.trim();if($("regPass").value!==$("regPass2").value)return msg("regMsg","两次密码不一致",true);$("regExistingAccount").hidden=true;try{await call("/auth/register",{phone,code:$("regCode").value.trim(),password:$("regPass").value,accountConsent:$("accountConsent").checked});closeAuthModal();await load()}catch(x){if(x.message==="phone_already_registered")$("regExistingAccount").hidden=false;msg("regMsg",errorText(x),true)}};
$("resetForm").onsubmit=async e=>{e.preventDefault();if($("resetPass").value!==$("resetPass2").value)return msg("resetMsg","两次密码不一致",true);try{await call("/auth/password/reset",{phone:$("resetPhone").value.trim(),code:$("resetCode").value.trim(),newPassword:$("resetPass").value});msg("resetMsg","密码已重置，请返回登录");setTimeout(()=>auth("login"),900)}catch(x){msg("resetMsg",errorText(x),true)}};
$("deleteAccountForm").onsubmit=async e=>{e.preventDefault();if($("deleteConfirm").value.trim()!=="DELETE")return msg("deleteMsg","请输入 DELETE 完成二次确认",true);try{await call("/account/delete",{password:$("deletePassword").value,code:$("deleteCode").value.trim(),confirmText:"DELETE"});msg("deleteMsg","账号资料已匿名化，正在退出…");$("deleteAccountForm").reset();location.replace("index.html")}catch(x){msg("deleteMsg",errorText(x),true);if(x.message==="unauthorized")setTimeout(()=>auth("login"),900)}};
$("changePasswordForm").onsubmit=async e=>{e.preventDefault();const currentPassword=$("currentPassword").value,newPassword=$("newPassword").value;if(newPassword!==$("confirmNewPassword").value)return msg("changePassMsg","两次新密码不一致",true);if(newPassword.length<10)return msg("changePassMsg","新密码至少需要 10 位",true);try{await call("/auth/password/change",{currentPassword,newPassword});msg("changePassMsg","密码修改成功，其他设备已退出登录");$("changePasswordForm").reset();document.querySelectorAll("#changePasswordForm .password-toggle").forEach(b=>{const input=$(b.dataset.togglePassword);input.type="password";b.textContent="显示"});setTimeout(()=>closeAuthModal(),1200)}catch(x){msg("changePassMsg",errorText(x),true);if(x.message==="unauthorized")setTimeout(()=>auth("login"),900)}};
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
  data.secondaryPhone=$("secondaryPhone").value.trim();
  data.wechatId=$("wechatId").value.trim();
  data.consent=$("consent").checked;
  if(!data.consent)return msg("profileMsg","请先阅读并同意新版个人信息保护说明",true);
  if(!["mainland","hmt","overseas"].includes(category))return msg("profileMsg","请选择高校类别",true);
  if(category==="overseas"&&!data.university)return msg("profileMsg","请填写海外高校名称",true);
  if(category!=="overseas"&&!data.profileUniversityId)return msg("profileMsg","请先从项目高校目录中选择学校",true);
  if(category==="mainland"&&!data.campusId)return msg("profileMsg","请选择实际就读校区",true);
  if(category==="mainland"&&!data.admissionCategoryId)return msg("profileMsg","请选择本科招生大类",true);
  if(!data.majorDisciplineCode)return msg("profileMsg","请选择专业大类",true);
  if(data.secondaryPhone&&!phoneOK(data.secondaryPhone))return msg("profileMsg","第二手机号格式不正确",true);
  if(!data.name||!data.grade||!data.gender)return msg("profileMsg","请完整填写姓名、性别和当前年级",true);
  try{
    const response=await fetch(API+"/profile",{method:"PUT",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
    let result={};try{result=await response.json()}catch{}
    if(!response.ok)throw Error(result.error||"profile_save_failed");
    await load();
    if(result.reviewStatus==="pending")return;
    msg("profileMsg","资料保存成功");
  }catch(error){
    const errors={
      consent_required:"请先阅读并同意新版个人信息保护说明",
      profile_incomplete:"请完整填写必填资料",
      profile_reference_invalid:"学校、校区或表单选项不在当前数据目录中，请重新选择",
      university_catalog_selection_required:"请先从高校目录中选择学校",
      university_not_selectable:"所选学校当前不可用，请重新选择",
      campus_selection_required:"请选择实际就读校区",
      admission_category_required:"请选择招生大类",
      major_discipline_required:"请选择 13 个学科门类中的专业大类",
      gender_required:"请选择性别",
      invalid_secondary_phone:"第二手机号格式不正确",
      overseas_university_required:"请填写海外高校名称",
      university_change_requires_support:"已登记高校暂不能自行更换，请联系组织者",
      leader_transfer_required:"当前仍是团队组长，请先完成组长转让",
      team_leader_transfer_required:"你目前仍是原大学团队组长，请先将组长身份转让给队员，再更换高校。",
      leader_transfer_pending:"当前有尚未处理的组长转让申请，请先处理后再更换高校。"
    };
    msg("profileMsg",errors[error.message]||"保存失败，请检查资料后重试",true);
  }
};
document.querySelectorAll("[data-toggle-password]").forEach(b=>b.onclick=()=>{const input=$(b.dataset.togglePassword);const visible=input.type==="password";input.type=visible?"text":"password";b.textContent=visible?"隐藏":"显示"});document.querySelectorAll("[data-view]").forEach(x=>x.onclick=()=>{document.querySelectorAll("[data-view]").forEach(b=>b.classList.toggle("active",b===x));view=x.dataset.view;render()});$("search").oninput=render;const DONATION_AMOUNTS=[5,10,15];
function selectDonationAmount(amount){
  if(!DONATION_AMOUNTS.includes(amount))return;
  document.querySelectorAll("[data-donation-amount]").forEach(button=>{
    const selected=Number(button.dataset.donationAmount)===amount;
    button.classList.toggle("active",selected);
    button.setAttribute("aria-pressed",String(selected));
  });
  const image=$("donationQrImage"),pending=$("donationQrPending");
  if(!image)return;
  image.dataset.selectedAmount=String(amount);
  image.alt="￥"+amount+" 捐赠收款二维码";
  image.hidden=true;
  if(pending){
    pending.hidden=false;
    $("donationQrPendingTitle").textContent="￥"+amount+" 二维码";
    $("donationQrPendingText").textContent="正在加载对应金额的收款二维码…";
  }
  const light=image.getAttribute("data-amount-"+amount+"-light-src");
  const dark=image.getAttribute("data-amount-"+amount+"-dark-src");
  image.dataset.lightSrc=light||"";
  image.dataset.darkSrc=dark||"";
  image.dataset.fallbackSrc="";
  image.dataset.activeThemeSrc="";
  if(!light||!dark){
    if(pending)$("donationQrPendingText").textContent="该金额的二维码资源尚未配置，补充图片后即可显示。";
    return;
  }
  const theme=document.documentElement.dataset.theme==="dark"?"dark":"light";
  const target=theme==="dark"?dark:light;
  image.dataset.activeThemeSrc=target;
  image.onload=()=>{
    if(image.dataset.activeThemeSrc!==target)return;
    image.hidden=false;
    if(pending)pending.hidden=true;
  };
  image.onerror=()=>{
    if(image.dataset.activeThemeSrc!==target)return;
    image.hidden=true;
    if(pending){
      pending.hidden=false;
      $("donationQrPendingTitle").textContent="￥"+amount+" 二维码尚未就绪";
      $("donationQrPendingText").textContent=amount===10
        ?"10 元二维码图片尚未上传；上传后点击 ￥10 即可显示。"
        :"二维码图片暂时无法加载，请检查资源路径后重试。";
    }
  };
  image.src=target;
  if(image.complete&&image.naturalWidth>0){
    image.hidden=false;
    if(pending)pending.hidden=true;
  }
}
document.querySelectorAll("[data-donation-amount]").forEach(button=>{
  button.addEventListener("click",()=>selectDonationAmount(Number(button.dataset.donationAmount)));
});
$("retrySession").onclick=()=>{
  $("bootError").hidden=true;
  $("retrySession").hidden=true;
  if(!initialBootAssetsReady){
    startInitialSessionRestore();
    return;
  }
  $("bootWelcome").hidden=true;
  $("bootMessage").hidden=false;
  $("bootMessage").textContent="正在重新确认登录状态…";
  load().catch(error=>console.warn("Session retry failed",error?.message||"unknown"));
};
startInitialSessionRestore();
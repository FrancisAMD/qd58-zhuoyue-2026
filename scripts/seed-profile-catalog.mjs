import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseSeedArgs } from "./profile-catalog-seed-args.js";
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const DB_NAME="qd58-zhuoyue-db";
let config;
try { config=parseSeedArgs(process.argv.slice(2)); }
catch(error) { console.error(error.message); process.exit(2); }
const readJson=relative=>JSON.parse(fs.readFileSync(path.join(ROOT,relative),"utf8"));
const esc=value=>"'"+String(value??"").replace(/'/g,"''")+"'";
const json=value=>esc(JSON.stringify(value));
const statements=[];
const main=readJson("data/profile-sources/mainland-universities.json");
const hmt=readJson("data/profile-sources/hmt-universities.json");
const majors=readJson("data/profile-sources/major-disciplines.json");
const admissions=readJson("data/profile-sources/admission-types.json");
function addUniversity(u,category){
  const universityId="profile-"+u.id;
  const region=category==="mainland"?(u.province_or_state||""):(u.region||"");
  const province=category==="mainland"?(u.province_or_state||""):"";
  const campuses=category==="mainland"?(u.campuses||[]).map(c=>({
    id:c.campus_id,name:"主校区",tag:c.tag||"主校区",country:u.country||"中国",
    province:c.province_or_state||u.province_or_state||"",city:c.city||u.city||"",status:"active",
    branches:(c.branches||[]).filter(b=>(b.status||"active")==="active").map(b=>({
      id:b.campus_id,name:b.name||"",tag:b.tag||"异地校区",country:b.country||"中国",
      province:b.province_or_state||"",city:b.city||"",status:b.status||"active"
    }))
  })):[];
  statements.push("INSERT OR IGNORE INTO universities(id,canonical_name,normalized_name,category,region_name,education_level,project_tags_json,partner_name) VALUES("+
    [esc(universityId),esc(u.name),esc("profile:"+u.id.toLowerCase()),esc(category),esc(region),esc(category==="mainland"?"undergraduate":""),json(u.tags||[]),esc("")].join(",")+");");
  statements.push("INSERT INTO profile_university_catalog(source_id,university_id,category,canonical_name,region_name,province_name,city_name,tags_json,campuses_json,source_name,verified_at,dataset_version) VALUES("+
    [esc(u.id),esc(universityId),esc(category),esc(u.name),esc(region),esc(province),esc(u.city||""),json(u.tags||[]),json(campuses),esc(u.source?.name||""),esc(u.source?.verified_at||""),esc("2026-11-26")].join(",")+
    ") ON CONFLICT(source_id) DO UPDATE SET university_id=excluded.university_id,category=excluded.category,canonical_name=excluded.canonical_name,region_name=excluded.region_name,province_name=excluded.province_name,city_name=excluded.city_name,tags_json=excluded.tags_json,campuses_json=excluded.campuses_json,source_name=excluded.source_name,verified_at=excluded.verified_at,dataset_version=excluded.dataset_version;");
}
for(const u of main.universities||[])if(u.status==="active")addUniversity(u,"mainland");
for(const u of hmt.universities||[])if(u.status==="active")addUniversity(u,"hmt");
for(const item of majors.categories||[]){
  const group=item.code==="11"?"军事学":(item.legacyGroup||"");
  statements.push("INSERT INTO profile_option_codes(option_type,code,parent_code,label,is_active) VALUES('major_discipline',"+[esc(item.code),esc(group),esc(item.name),item.enabled===false?"0":"1"].join(",")+") ON CONFLICT(option_type,code) DO UPDATE SET parent_code=excluded.parent_code,label=excluded.label,is_active=excluded.is_active;");
}
for(const cat of admissions.categories||[]){
  statements.push("INSERT INTO profile_option_codes(option_type,code,parent_code,label,is_active) VALUES('admission_category',"+[esc(cat.id),esc(""),esc(cat.name),"1"].join(",")+") ON CONFLICT(option_type,code) DO UPDATE SET label=excluded.label,is_active=1;");
}
// Clean obsolete/invalid profile values without deleting any user account or team.
// Detailed admission type IDs are mapped to their parent category when possible.
// Legacy broad major groups cannot identify one of the 13 exact disciplines, so they are cleared.
statements.push(`UPDATE users SET
  class_name='',
  bio=NULL,
  major_group='',
  major_discipline_code=CASE
    WHEN EXISTS(SELECT 1 FROM profile_option_codes o WHERE o.option_type='major_discipline' AND o.code=users.major_discipline_code AND o.is_active=1)
      AND (users.major_discipline_code<>'11'
        OR EXISTS(SELECT 1 FROM profile_university_catalog p WHERE p.university_id=users.university_id AND instr(p.tags_json,'"military_academy"')>0)
        OR EXISTS(SELECT 1 FROM universities u WHERE u.id=users.university_id AND instr(u.project_tags_json,'"military_academy"')>0))
    THEN users.major_discipline_code ELSE '' END,
  admission_category_id=CASE
    WHEN EXISTS(SELECT 1 FROM universities u WHERE u.id=users.university_id AND u.category='mainland') THEN
      CASE
        WHEN EXISTS(SELECT 1 FROM profile_option_codes o WHERE o.option_type='admission_category' AND o.code=users.admission_category_id AND o.is_active=1)
        THEN users.admission_category_id
        ELSE COALESCE((SELECT o.parent_code FROM profile_option_codes o WHERE o.option_type='admission_type' AND o.code=users.admission_type_id AND o.is_active=1 LIMIT 1),'')
      END
    ELSE '' END,
  admission_type_id='',
  secondary_phone=CASE
    WHEN length(trim(COALESCE(secondary_phone,'')))=11
      AND trim(secondary_phone) NOT GLOB '*[^0-9]*'
      AND substr(trim(secondary_phone),1,2) GLOB '1[3-9]'
    THEN trim(secondary_phone) ELSE '' END,
  wechat_id=CASE WHEN length(trim(COALESCE(wechat_id,'')))<=80 THEN trim(COALESCE(wechat_id,'')) ELSE '' END,
  greeting=substr(trim(COALESCE(greeting,'')),1,500)
WHERE 1=1;`);
statements.push("DELETE FROM profile_option_codes WHERE option_type IN ('major_group','admission_type');");
const chunkSize=80,chunks=[];
for(let i=0;i<statements.length;i+=chunkSize)chunks.push(statements.slice(i,i+chunkSize).join("\n"));
console.log("数据源检查通过：内地 "+main.universities.length+" 所、港澳台 "+hmt.universities.length+" 所、专业门类 "+majors.categories.length+" 项、招生大类 "+admissions.categories.length+" 类。");
console.log("共 "+statements.length+" 条幂等 SQL，分 "+chunks.length+" 批；将维护 universities、profile_university_catalog、profile_option_codes，并包含现有用户资料规范化 UPDATE 和废弃选项清理。");
if(!config.apply){
  console.log("安全预览（默认 dry-run）：未调用 Wrangler，未连接或写入 D1。");
  if(config.targetMode==="--remote")console.log("目标预览：远程 D1 "+DB_NAME+"（仅预览）。");
  else if(config.targetMode==="--local")console.log("目标预览：本地 D1（仅预览）。");
  else console.log("未指定 D1 目标；本次仅生成内存中的预览摘要。");
  console.log("如需本地执行：npm run seed:profile-catalog -- --local --apply");
  console.log("如需远程执行：npm run seed:profile-catalog -- --remote --apply --confirm-remote "+DB_NAME);
  console.log("警告：apply 会批量写入目录/选项，并规范化现有用户资料字段；先备份 D1、核对远程迁移和预览摘要，再显式确认。");
  process.exit(0);
}
const tempDir=fs.mkdtempSync(path.join(os.tmpdir(),"qd58-profile-seed-"));
try{
  for(let i=0;i<chunks.length;i++){
    const file=path.join(tempDir,"batch-"+String(i+1).padStart(3,"0")+".sql");
    fs.writeFileSync(file,chunks[i]+"\n","utf8");
    const command=process.platform==="win32"?"npx.cmd":"npx";
    const result=spawnSync(command,["wrangler","d1","execute",DB_NAME,config.targetMode,"--file",file],{cwd:ROOT,stdio:"inherit",shell:process.platform==="win32"});
    if(result.error)throw result.error;
    if(result.status!==0)throw new Error("第 "+(i+1)+" 批导入失败，脚本已停止；可安全重新运行。");
    console.log("完成 "+(i+1)+"/"+chunks.length);
  }
}finally{fs.rmSync(tempDir,{recursive:true,force:true});}
console.log("高校目录和表单选项导入完成。");

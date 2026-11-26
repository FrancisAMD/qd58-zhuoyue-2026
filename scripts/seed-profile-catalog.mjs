import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const DB_NAME="qd58-zhuoyue-db";
const args=new Set(process.argv.slice(2));
const mode=args.has("--remote")?"--remote":args.has("--local")?"--local":"";
if(!mode){console.error("请明确指定 --remote 或 --local。");process.exit(2);}
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
const majorGroups=new Set();
for(const item of majors.categories||[]){const group=item.code==="11"?"军事学":item.legacyGroup;if(group)majorGroups.add(group);}
for(const group of majorGroups)statements.push("INSERT INTO profile_option_codes(option_type,code,parent_code,label,is_active) VALUES('major_group',"+[esc(group),esc(""),esc(group),"1"].join(",")+") ON CONFLICT(option_type,code) DO UPDATE SET label=excluded.label,is_active=1;");
for(const item of majors.categories||[]){
  const group=item.code==="11"?"军事学":(item.legacyGroup||"");
  statements.push("INSERT INTO profile_option_codes(option_type,code,parent_code,label,is_active) VALUES('major_discipline',"+[esc(item.code),esc(group),esc(item.name),item.enabled===false?"0":"1"].join(",")+") ON CONFLICT(option_type,code) DO UPDATE SET parent_code=excluded.parent_code,label=excluded.label,is_active=excluded.is_active;");
}
for(const cat of admissions.categories||[]){
  statements.push("INSERT INTO profile_option_codes(option_type,code,parent_code,label,is_active) VALUES('admission_category',"+[esc(cat.id),esc(""),esc(cat.name),"1"].join(",")+") ON CONFLICT(option_type,code) DO UPDATE SET label=excluded.label,is_active=1;");
  for(const item of cat.types||[])if((item.status||"active")==="active")statements.push("INSERT INTO profile_option_codes(option_type,code,parent_code,label,is_active) VALUES('admission_type',"+[esc(item.id),esc(cat.id),esc(item.name),"1"].join(",")+") ON CONFLICT(option_type,code) DO UPDATE SET parent_code=excluded.parent_code,label=excluded.label,is_active=1;");
}
const chunkSize=80,chunks=[];
for(let i=0;i<statements.length;i+=chunkSize)chunks.push(statements.slice(i,i+chunkSize).join("\n"));
console.log("数据源检查通过：内地 "+main.universities.length+" 所、港澳台 "+hmt.universities.length+" 所、专业门类 "+majors.categories.length+" 项、招生大类 "+admissions.categories.length+" 类。");
console.log("共 "+statements.length+" 条幂等 SQL，分 "+chunks.length+" 批写入 "+mode+" D1。");
const tempDir=fs.mkdtempSync(path.join(os.tmpdir(),"qd58-profile-seed-"));
try{
  for(let i=0;i<chunks.length;i++){
    const file=path.join(tempDir,"batch-"+String(i+1).padStart(3,"0")+".sql");
    fs.writeFileSync(file,chunks[i]+"\n","utf8");
    const command=process.platform==="win32"?"npx.cmd":"npx";
    const result=spawnSync(command,["wrangler","d1","execute",DB_NAME,mode,"--file",file],{cwd:ROOT,stdio:"inherit",shell:process.platform==="win32"});
    if(result.error)throw result.error;
    if(result.status!==0)throw new Error("第 "+(i+1)+" 批导入失败，脚本已停止；可安全重新运行。");
    console.log("完成 "+(i+1)+"/"+chunks.length);
  }
}finally{fs.rmSync(tempDir,{recursive:true,force:true});}
console.log("高校目录和表单选项导入完成。");

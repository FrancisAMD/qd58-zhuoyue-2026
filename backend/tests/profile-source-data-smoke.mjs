import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const source=relative=>JSON.parse(fs.readFileSync(path.join(ROOT,"data/profile-sources",relative),"utf8"));
const mainland=source("mainland-universities.json");
const hmt=source("hmt-universities.json");
const majors=source("major-disciplines.json");
const admissions=source("admission-types.json");
assert.equal(mainland.schema_version,"1.2.0");
assert.equal(mainland.universities.length,1455);
assert.equal(hmt.schema_version,"1.1.0");
assert.equal(hmt.universities.length,54);
assert.equal(majors.categories.length,13);
assert.equal(admissions.categories.length,11);
const ids=new Set();
let branchCount=0;
for(const university of mainland.universities){
  assert.equal(university.status,"active");
  assert.ok(university.id&&university.name);
  assert.ok(!ids.has(university.id),"duplicate mainland school ID "+university.id);
  ids.add(university.id);
  assert.equal(university.campuses.length,1,"mainland school has exactly one main-campus container");
  const mainCampus=university.campuses[0];
  assert.equal(mainCampus.campus_type,"main");
  for(const branch of mainCampus.branches||[]){
    if((branch.status||"active")!=="active")continue;
    branchCount++;
    assert.ok(branch.campus_id&&branch.name&&branch.tag);
  }
}
assert.equal(branchCount,216,"expected active branch-campus record count");
const hmtIds=new Set();
for(const university of hmt.universities){
  assert.equal(university.status,"active");
  assert.ok(university.region&&university.name);
  assert.ok(!hmtIds.has(university.id),"duplicate HMT school ID "+university.id);
  hmtIds.add(university.id);
  assert.equal(university.campuses.length,1);
  assert.equal((university.campuses[0].branches||[]).length,0,"HMT entries use school-name-only selection");
}
const broadGroups=new Set(majors.categories.map(item=>item.legacyGroup).filter(Boolean));
assert.deepEqual([...broadGroups].sort(),["农科","医学","工科","文科","理科"].sort());
const military=majors.categories.find(item=>item.code==="11");
assert.ok(military&&military.name==="军事学"&&military.legacyGroup===null);
const totalTypes=admissions.categories.reduce((total,category)=>total+(category.types||[]).length,0);
assert.equal(totalTypes,34);
for(const category of admissions.categories)for(const type of category.types||[])assert.equal(type.status,"active");
assert.ok(admissions.categories.some(category=>category.name==="强基计划"),"Strong Foundation Program must be an explicit admission category");
assert.ok(admissions.categories.some(category=>category.name.includes("普通高考统一招生")),"ordinary Gaokao batch route must be included");
console.log("profile-source-data-smoke: passed (1455 mainland, 54 HMT, 216 branches, 13 disciplines, 11 admission categories / 34 types)");

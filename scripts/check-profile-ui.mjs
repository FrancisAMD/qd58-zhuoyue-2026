import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root=new URL("../",import.meta.url);
const html=readFileSync(new URL("index.html",root),"utf8");
const js=readFileSync(new URL("app.js",root),"utf8");
const css=readFileSync(new URL("style.css",root),"utf8");

assert.match(html,/name="highSchool" value="青岛五十八中"/,"high-school field must default to Qingdao No. 58 High School");
assert.match(html,/<option selected>大一<\/option>/,"grade selector must default to freshman year");
assert.match(html,/name="greeting" rows="5"/,"greeting textarea must have an explicit compact row count");
assert.match(js,/key==="highSchool"\?"青岛五十八中":key==="grade"\?"大一"/,"empty legacy profiles should receive the default high-school and grade values");
assert.match(js,/elements\.highSchool\.value="青岛五十八中"/,"clearing a school should restore the high-school default");
assert.match(js,/elements\.grade\.value="大一"/,"clearing a school should restore the freshman default");
assert.match(css,/resize:none!important/,"greeting textarea must not be manually resizable");
assert.match(css,/#profile textarea\[name="greeting"\][\s\S]*?max-height:132px/,"greeting textarea must have a fixed height");
assert.match(css,/padding:0!important/,"step number badges must not inherit the legacy pill padding");
assert.match(css,/\.profile-stage-panel[\s\S]*?margin-top:18px/,"profile stage cards must have visual separation");
assert.match(css,/@media\(min-width:761px\)[\s\S]*?#join>#profile\s*\{[^}]*width:100%[^}]*max-width:none/,"desktop registration form must fill the section width and align with the journey and account bars");
console.log("Profile UI smoke tests: defaults, fixed textarea, centered badges and stage spacing passed.");

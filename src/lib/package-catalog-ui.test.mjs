// Render real catalog client with offline React/fetch adapters. No browser/network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
const read = path => readFileSync(new URL(path,import.meta.url),'utf8');
const compile = source => ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
function mount({postStatuses=[200],items=[{id:11,version:3,name:'Existing',label:'17 days',description:'Synthetic',price:123.45,durationDays:17,timeSlot:'12:34-18:56',friendCoupons:2,bonusDays:3,isActive:true}]}={}) {
 const hooks=[],effects=[],requests=[]; let cursor=0,postIndex=0;
 const jsx=(type,props)=>({type,props});
 const helper={}; vm.runInNewContext(compile(read('./package-catalog.ts')),{exports:helper});
 const exports={};
 vm.runInNewContext(compile(read('../app/admin/packages/PackageCatalogClient.tsx')),{
  exports,AbortSignal,crypto:{randomUUID},
  window:{setTimeout:fn=>{effects.push(fn);return 1;},clearTimeout(){}},
  fetch:async(url,options={})=>{
   assert.equal(url,'/api/admin/packages'); requests.push(options);
   if(options.method==='POST') {const status=postStatuses[Math.min(postIndex++,postStatuses.length-1)];return {status,ok:status===200,json:async()=>({data:{package:{id:12}}})};}
   return {ok:true,json:async()=>({data:{packages:items}})};
  },
  require:name=>{
   if(name==='react/jsx-runtime')return {jsx,jsxs:jsx};
   if(name==='@/lib/package-catalog')return helper;
   if(name==='react')return {
    useState:initial=>{const i=cursor++;if(!(i in hooks))hooks[i]=initial;return [hooks[i],v=>{hooks[i]=typeof v==='function'?v(hooks[i]):v;}];},
    useRef:initial=>{const i=cursor++;if(!(i in hooks))hooks[i]={current:initial};return hooks[i];},
    useEffect:fn=>effects.push(fn),
   };
   throw Error(`Unexpected dependency ${name}`);
  },
 });
 const render=()=>{cursor=0;effects.length=0;return exports.default();};
 render(); for(const fn of [...effects])fn(); for(const fn of effects.slice(1))fn();
 return {render,requests};
}
const settle=async()=>{await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));};
function nodes(tree){if(!tree||typeof tree!=='object')return [];if(Array.isArray(tree))return tree.flatMap(nodes);return [tree,...nodes(tree.props?.children)];}
const text=tree=>JSON.stringify(tree);
const button=(tree,label)=>nodes(tree).find(n=>n.type==='button'&&text(n.props.children).includes(label));
function input(tree,label){const node=nodes(tree).find(n=>n.type==='label'&&Array.isArray(n.props.children)&&n.props.children[0].trim()===label);assert.ok(node,`label ${label}`);return nodes(node).find(n=>n.type==='input');}
function change(app,label,value){input(app.render(),label).props.onChange({target:{value}});}
function fillNew(app){change(app,'ชื่อ','New custom');change(app,'ป้ายชื่อ','17 days');change(app,'ราคา (บาท)','123.45');change(app,'ช่วงเวลา','23:59-24:00');}
function submit(app){nodes(app.render()).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});}
test('create when all catalog entries active, dynamic slots, server allocated identity, reload after success',async()=>{
 const app=mount();await settle();let tree=app.render();
 const filter=nodes(tree).find(n=>n.type==='select');
 assert.ok(nodes(filter).some(n=>n.props?.value==='12:34-18:56'));
 button(tree,'เพิ่มแพ็กเกจใหม่').props.onClick();fillNew(app);submit(app);await settle();
 const posts=app.requests.filter(r=>r.method==='POST');assert.equal(posts.length,1);
 const body=JSON.parse(posts[0].body);assert.equal(body.action,'create');assert.equal(body.timeSlot,'23:59-24:00');assert.equal(body.price,123.45);
 assert.equal('id' in body,false);assert.equal('expectedVersion' in body,false);
 assert.match(body.requestKey,/^[a-f0-9-]{36}$/);
 assert.match(text(app.render()),/บันทึกสำเร็จ/);assert.equal(app.requests.filter(r=>!r.method).length,2);
});
test('unknown create result locks new submissions; retry reuses exact UUID and body',async()=>{
 const app=mount({postStatuses:[503,200]});await settle();button(app.render(),'เพิ่มแพ็กเกจใหม่').props.onClick();fillNew(app);
 submit(app);await settle();submit(app);await settle();
 assert.equal(app.requests.filter(r=>r.method==='POST').length,1);
 button(app.render(),'ลองคำขอเดิมซ้ำ').props.onClick();await settle();
 const posts=app.requests.filter(r=>r.method==='POST');assert.equal(posts.length,2);assert.equal(posts[0].body,posts[1].body);
});
test('edit/inactivate keeps ID and expectedVersion; stale response requires explicit reload',async()=>{
 const app=mount({postStatuses:[409]});await settle();
 const card=nodes(app.render()).find(n=>n.type==='div'&&n.props.onClick&&text(n).includes('12:34-18:56'));
 assert.ok(card);card.props.onClick();
 nodes(app.render()).find(n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:false}});
 submit(app);await settle();
 const body=JSON.parse(app.requests.find(r=>r.method==='POST').body);
 assert.equal(body.action,'update');assert.equal(body.id,11);assert.equal(body.expectedVersion,3);assert.equal(body.isActive,false);
 assert.match(text(app.render()),/เวอร์ชันขัดแย้ง/);submit(app);await settle();assert.equal(app.requests.filter(r=>r.method==='POST').length,1);
});
test('invalid overnight/empty interval and overprecise price never submit',async()=>{
 const app=mount();await settle();button(app.render(),'เพิ่มแพ็กเกจใหม่').props.onClick();fillNew(app);
 for(const slot of ['23:00-01:00','07:00-07:00','24:00-24:00']){change(app,'ช่วงเวลา',slot);submit(app);await settle();}
 change(app,'ช่วงเวลา','00:00-24:00');change(app,'ราคา (บาท)','1.001');submit(app);await settle();
 assert.equal(app.requests.filter(r=>r.method==='POST').length,0);
});

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { client, protect, local, save, stamp, safeFailure } from './db-safety.mjs';
import { backup } from './db-backup.mjs';
import { verify } from './db-verify-backup.mjs';
const base='http://localhost:3000';
const routes=['/admin/checkin','/admin/rewards','/admin/promo-codes','/admin/coupons'];
const canon=v=>JSON.stringify(v&&typeof v==='object'?Array.isArray(v)?v.map(x=>JSON.parse(canon(x))):Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(canon(v[k]))])):v);
async function cleanup(file){
  const r=JSON.parse(fs.readFileSync(file,'utf8'));const sql=client(),a=r.account;
  await sql`UPDATE auth_sessions SET revoked_at=clock_timestamp() WHERE member_id=${a.id} AND id>${r.maxSessionId} AND revoked_at IS NULL AND EXISTS(SELECT 1 FROM members WHERE id=${a.id} AND member_code=${a.memberCode} AND phone=${a.phone} AND password_hash=${a.hash} AND full_name=${r.marker+'_ADMIN'} AND role='ADMIN')`;
}
async function watchdog(){const f=path.resolve(process.argv[3]||'');if(!f.startsWith(local+path.sep)||path.basename(f)!=='session-cleanup.json')throw Error('Invalid recovery path');await new Promise(r=>setTimeout(r,180000));await cleanup(f);}
async function geometry(page){return page.evaluate(()=>{
  const width=innerWidth;
  function node(el){const r=el.getBoundingClientRect(),s=getComputedStyle(el);return{tag:el.tagName,classes:el.getAttribute('class'),x:r.x,right:r.right,width:r.width,client:el.clientWidth,scroll:el.scrollWidth,minWidth:s.minWidth,display:s.display,gridColumns:s.gridTemplateColumns,overflowX:s.overflowX};}
  function clipped(el){for(let p=el.parentElement;p&&p!==document.body;p=p.parentElement){const s=getComputedStyle(p),r=p.getBoundingClientRect();if(['auto','scroll','hidden','clip'].includes(s.overflowX)&&r.right<=width+1&&r.x>=-1)return true;}return false;}
  const exposed=[...document.querySelectorAll('main *')].filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&(r.right>width+1||r.x< -1)&&!clipped(el);});
  const headings=[...document.querySelectorAll('h1,h2,h3')].map(x=>({text:x.textContent,...node(x)}));
  const containers=[...document.querySelectorAll('main div.grid,main section')].filter(el=>el.querySelector('svg[aria-label="จำนวนการเข้าใช้บริการตามชั่วโมง (24 ชั่วโมง)"]')||el.textContent.includes('กราฟวงกลม')).slice(-8).map(node);
  return{width,documentWidth:document.documentElement.scrollWidth,bodyOverflow:getComputedStyle(document.body).overflowX,htmlOverflow:getComputedStyle(document.documentElement).overflowX,exposed:exposed.slice(0,35).map(node),headings,containers};
});}
async function main(){
  protect();const sql=client(),fixtures=JSON.parse(fs.readFileSync(path.join(local,'role-uat-fixtures.json'),'utf8'));const a=fixtures.accounts.find(x=>x.memberCode==='BLU-4'&&x.role==='ADMIN');if(!a)throw Error('Staff fixture missing');
  const rows=await sql`SELECT id FROM members WHERE id=${a.id} AND member_code=${a.memberCode} AND phone=${a.phone} AND password_hash=${a.hash} AND full_name=${fixtures.marker+'_ADMIN'} AND role='ADMIN'`;if(rows.length!==1)throw Error('Exact fixture guard failed');
  const limits=await sql`SELECT attempts,greatest(0,ceil(extract(epoch FROM window_start+interval '15 minutes'-now())))::int AS wait_seconds FROM auth_login_limits WHERE phone=${a.phone}`;
  const delay=limits[0]?.attempts>=5?limits[0].wait_seconds+2:0;if(delay>905)throw Error('Unexpected login delay');if(delay>0){console.log(JSON.stringify({waitingForNormalLoginWindowSeconds:delay}));await new Promise(r=>setTimeout(r,delay*1000));}
  const tables=(await sql.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(r=>r.tablename);const backupDir=await backup(sql,tables);await verify(backupDir,sql);const baseline=JSON.parse(fs.readFileSync(path.join(backupDir,'snapshot.json'),'utf8'));
  const output=path.join(local,'checkin-layout-'+stamp());fs.mkdirSync(output,{mode:0o700});const results=[],blocked=[],errors=[];let browser,page,context;
  const [{id:maxSessionId}]=await sql`SELECT coalesce(max(id),0)::int AS id FROM auth_sessions`;
  const recovery=path.join(output,'session-cleanup.json');const{password,...identity}=a;void password;save(recovery,JSON.stringify({account:identity,marker:fixtures.marker,maxSessionId},null,2));
  const watcher=spawn(process.execPath,[import.meta.filename,'--watchdog',recovery],{detached:true,stdio:'ignore',windowsHide:true});watcher.unref();
  const probe=process.argv.includes('--probe');
  const record=(name,pass,evidence)=>{results.push({name,pass,evidence});console.log(JSON.stringify({name,pass,evidence}));};
  try{
    const require=createRequire(path.join(local,'role-browser/package.json'));const{chromium}=require('playwright');const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p=>fs.existsSync(p));if(!executablePath)throw Error('Chrome unavailable');
    browser=await chromium.launch({headless:true,executablePath,timeout:20000});context=await browser.newContext({viewport:{width:390,height:844}});
    await context.route('**/api/**',route=>{const u=new URL(route.request().url());if(u.pathname==='/api/auth/me'&&route.request().method()==='GET')return route.continue();blocked.push({path:u.pathname,method:route.request().method()});return route.abort('blockedbyclient');});
    const response=await context.request.post(base+'/api/auth/login',{data:{phone:a.phone,password:a.password},headers:{Origin:base},timeout:15000});assert.equal(response.status(),200,'password login');
    const me=await(await context.request.get(base+'/api/auth/me',{timeout:15000})).json();assert.equal(me.member?.memberCode,a.memberCode);assert.equal(me.member?.role,'ADMIN');
    page=await context.newPage();page.setDefaultTimeout(8000);page.on('pageerror',()=>errors.push('uncaught-pageerror'));
    const go=async route=>{const r=await page.goto(base+route,{waitUntil:'networkidle',timeout:25000});assert.equal(r.status(),200);assert.equal(new URL(page.url()).pathname,route);};
    if(probe){
      await go('/admin/checkin');const before=await geometry(page);save(path.join(output,'before-dom.json'),JSON.stringify(before,null,2));await page.screenshot({path:path.join(output,'before-390.png')});
      // Isolate the chart grid's automatic min-content track before changing application code.
      const candidates=await page.evaluate(()=>{
        const section=[...document.querySelectorAll('main section')].find(s=>s.querySelector(':scope > h2')?.textContent.includes('กราฟสรุป'));
        const grid=section.querySelector(':scope > div.grid');const measures=[];const measure=label=>measures.push({label,documentWidth:document.documentElement.scrollWidth,gridWidth:grid.getBoundingClientRect().width,gridColumns:getComputedStyle(grid).gridTemplateColumns,childWidths:[...grid.children].map(e=>e.getBoundingClientRect().width)});
        measure('original');grid.style.gridTemplateColumns='minmax(0,1fr)';measure('chart grid minmax(0,1fr)');
        const donut=grid.children[0].querySelector('.flex');donut.style.flexWrap='wrap';donut.style.gap='24px';measure('plus donut flex-wrap');return measures;
      });
      save(path.join(output,'candidate-dom.json'),JSON.stringify(candidates,null,2));record('DOM isolation before source edits',true,{before:before.documentWidth,candidates});
      await page.getByRole('button',{name:'เปิด Auto Scan',exact:true}).click();const scanner=await geometry(page);save(path.join(output,'scanner-candidate-dom.json'),JSON.stringify(scanner,null,2));record('scanner candidate geometry',true,{width:scanner.width,documentWidth:scanner.documentWidth,exposed:scanner.exposed.slice(0,8)});
    }else{
      for(const width of [390,360,1440]){
        await page.setViewportSize({width,height:width===1440?1000:844});
        for(const route of routes){
          try{
            await go(route);const g=await geometry(page);save(path.join(output,`${width}-${route.split('/').pop()}-dom.json`),JSON.stringify(g,null,2));
            const primary=page.getByRole('button',{name:route==='/admin/checkin'?'เปิด Auto Scan':route==='/admin/rewards'?'เพิ่มรางวัล':route==='/admin/promo-codes'?'สร้างแคมเปญ':'สร้างคูปอง',exact:true});await primary.scrollIntoViewIfNeeded();const box=await primary.boundingBox();
            record(`${width} ${route} document and primary control`,g.documentWidth===width&&box&&box.x>=0&&box.x+box.width<=width,{viewport:width,documentWidth:g.documentWidth,primaryBox:box,bodyOverflow:g.bodyOverflow,htmlOverflow:g.htmlOverflow});
            await page.screenshot({path:path.join(output,`${width}-${route.split('/').pop()}.png`)});
            if(route==='/admin/checkin'){
              const graph=page.getByRole('img',{name:'จำนวนการเข้าใช้บริการตามชั่วโมง (24 ชั่วโมง)',exact:true});
              const scrolls=await page.evaluate(()=>[...document.querySelectorAll('main *')].filter(el=>getComputedStyle(el).overflowX==='auto'&&el.scrollWidth>el.clientWidth).map(el=>{el.scrollLeft=el.scrollWidth;return{tag:el.tagName,client:el.clientWidth,scroll:el.scrollWidth,scrollLeft:el.scrollLeft};}));
              record(`${width} checkin chart/legend/export preserved`,await graph.count()===1&&await page.getByText('07:00–14:00',{exact:true}).count()>0&&await page.getByText('14:00–22:00',{exact:true}).count()>0&&await page.getByRole('button',{name:'Export CSV',exact:true}).isEnabled()&&(width===1440||scrolls.length>=2),{internalScrollContainers:scrolls,exportAvailable:true});
              await page.getByRole('button',{name:'เปิด Auto Scan',exact:true}).click();const input=page.getByRole('textbox',{name:'ช่องรับรหัสเครื่องสแกนสมาชิก',exact:true});await input.waitFor();await input.scrollIntoViewIfNeeded();await input.focus();const focused=await input.evaluate(el=>document.activeElement===el);const scannerG=await geometry(page);const inputBox=await input.boundingBox();
              const usb=page.getByRole('button',{name:'USB / พิมพ์',exact:true}),camera=page.getByRole('button',{name:'กล้อง',exact:true}),stop=page.getByRole('button',{name:'หยุด',exact:true});const controls=[];for(const control of [usb,camera,stop]){await control.scrollIntoViewIfNeeded();const r=await control.boundingBox();controls.push({x:r?.x,width:r?.width,withinViewport:Boolean(r&&r.x>=0&&r.x+r.width<=width)});}
              record(`${width} empty Auto Scan focus/layout`,scannerG.documentWidth===width&&focused&&inputBox&&inputBox.width>=40&&inputBox.x>=0&&inputBox.x+inputBox.width<=width&&controls.every(x=>x.withinViewport),{documentWidth:scannerG.documentWidth,focused,inputBox,controls,noCodeSubmitted:true});
              save(path.join(output,`${width}-scanner-dom.json`),JSON.stringify(scannerG,null,2));await page.screenshot({path:path.join(output,`${width}-scanner.png`)});await stop.click();
            }
          }catch{record(`${width} ${route} completed`,false,{error:'Assertion/navigation failure; sensitive details suppressed'});}
        }
      }
    }
    record('no unsafe API or uncaught browser errors',blocked.length===0&&errors.length===0,{blocked,uncaught:errors.length});
  }catch{record('browser run completed',false,{error:'Details suppressed; inspect protected report/DOM artifacts'});}
  finally{
    let cleanupOK=false;try{await cleanup(recovery);cleanupOK=true;watcher.kill();}catch{record('session cleanup',false,{watchdog:'armed for independent retry'});}
    if(browser)await browser.close().catch(()=>{});
    const safety=[];for(const[table,data]of Object.entries(baseline.tables)){
      if(!/^[a-z_]+$/.test(table))throw Error('Invalid table');const previous=JSON.parse(data.rows),current=(await sql.query(`SELECT to_jsonb(t) AS row FROM public."${table}" t`)).map(r=>r.row),set=new Set(current.map(canon)),old=new Set(previous.map(canon));const limit=r=>table==='auth_login_limits'&&r.phone===a.phone;
      const preserved=previous.filter(r=>!limit(r)).every(r=>set.has(canon(r)));const onlyOwnAuth=current.filter(r=>!old.has(canon(r))).every(r=>limit(r)||table==='auth_sessions'&&r.member_id===a.id&&r.id>maxSessionId&&r.revoked_at!==null);safety.push({table,preserved,onlyOwnAuth,before:previous.length,after:current.length});
    }
    record('baseline preserved / only new Staff auth session revoked',cleanupOK&&safety.every(r=>r.preserved&&r.onlyOwnAuth),{cleanupOK,tables:safety});
    const report={at:new Date().toISOString(),probe,results,passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,backup:path.relative(process.cwd(),backupDir),limitations:['Scanner opened with empty input only; no hardware/camera permission or scan submitted','No export download exercised; button remains accessible/enabled','No body overflow masking permitted; tables and graph retain internal horizontal scrolling']};
    save(path.join(output,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,failed:report.failed,probe,artifacts:path.relative(process.cwd(),output)}));if(report.failed)process.exitCode=1;
  }
}
if(process.argv[2]==='--watchdog')watchdog().catch(safeFailure);else main().catch(safeFailure);

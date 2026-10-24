import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID, randomInt, createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { client, protect, local, save, stamp, quote, safeFailure } from './db-safety.mjs';
import { backup } from './db-backup.mjs';
import { verify } from './db-verify-backup.mjs';
const base=process.env.KIOSK_UAT_BASE || 'http://localhost:3000';
const canonical=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
const persist=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2),{mode:0o600});
async function cleanup(file){
 const l=JSON.parse(fs.readFileSync(file,'utf8'));if(l.cleaned)return;
 const sql=client();const q=[sql.query("SET LOCAL lock_timeout='4s'"),sql.query("SET LOCAL statement_timeout='8s'")];
 for(const a of l.members){
  q.push(sql.query('DELETE FROM kiosk_requests WHERE member_code=$1 AND member_code IN (SELECT member_code FROM members WHERE id=$2 AND full_name=$3)',[a.member_code,a.id,l.marker]));
  q.push(sql.query('DELETE FROM kiosk_member_bounce WHERE member_id=$1 AND member_id IN (SELECT id FROM members WHERE full_name=$2)',[a.id,l.marker]));
  q.push(sql.query("DELETE FROM checkins WHERE member_id=$1 AND notes LIKE 'KIOSK ENTRY_ONLY %' AND member_id IN (SELECT id FROM members WHERE full_name=$2)",[a.id,l.marker]));
  q.push(sql.query('DELETE FROM coupons WHERE member_id=$1 AND title=$2',[a.id,l.marker]));
  q.push(sql.query('DELETE FROM members WHERE id=$1 AND member_code=$2 AND full_name=$3',[a.id,a.member_code,l.marker]));
 }
 q.push(sql.query('UPDATE auth_sessions SET revoked_at=coalesce(revoked_at,clock_timestamp()) WHERE member_id=$1 AND id>$2',[l.staffId,l.maxSessionId]));
 // Restore only this dedicated operator's throttle row, never a real account's row.
 q.push(sql.query('DELETE FROM auth_login_limits WHERE phone=$1',[l.phone]));
 if(l.limit)q.push(sql.query('INSERT INTO auth_login_limits(phone,attempts,window_start) VALUES($1,$2,$3)',[l.phone,l.limit.attempts,l.limit.window_start]));
 await sql.transaction(q,{isolationLevel:'Serializable'});l.cleaned=true;persist(file,l);
}
async function main(){
 protect();
 if(process.argv[2]==='--watchdog'){
  const f=path.resolve(process.argv[3]||'');if(!f.startsWith(local+path.sep)||path.basename(f)!=='lease.json')throw Error('Invalid lease');
  await new Promise(r=>setTimeout(r,135000));await cleanup(f);return;
 }
 const {chromium}=createRequire(path.join(local,'role-browser/package.json'))('playwright');
 const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>fs.existsSync(p));
 if(!executablePath)throw Error('System browser unavailable');
 const fixtures=JSON.parse(fs.readFileSync(path.join(local,'role-uat-fixtures.json'),'utf8'));
 const staff=fixtures.accounts.find(a=>a.memberCode==='BLU-4'&&a.role==='ADMIN');if(fixtures.state!=='created'||!staff)throw Error('Dedicated staff unavailable');
 const sql=client();
 const identity=await sql`SELECT * FROM members WHERE id=${staff.id} AND member_code='BLU-4' AND phone=${staff.phone} AND password_hash=${staff.hash} AND role='ADMIN' AND full_name=${fixtures.marker+'_ADMIN'}`;
 if(identity.length!==1)throw Error('Staff identity mismatch');
 const limits=await sql`SELECT * FROM auth_login_limits WHERE phone=${staff.phone}`;
 if(limits[0]&&limits[0].attempts>1&&Date.parse(limits[0].window_start)+900000>Date.now())throw Error('Insufficient normal login attempts; do not reset throttle');
 const probe=await fetch(base+'/api/auth/me',{signal:AbortSignal.timeout(10000)});
 if(probe.status!==200||!(probe.headers.get('content-type')||'').includes('application/json')||(await probe.json()).member!==null)throw Error('Target must expose guest auth JSON before fixture writes');
 const tables=(await sql.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(r=>r.tablename);
 if(tables.length!==20)throw Error('Expected exactly twenty tables');
 const directory=await backup(sql,tables);await verify(directory,sql);
 const baseline=JSON.parse(fs.readFileSync(path.join(directory,'snapshot.json'),'utf8'));
 const output=path.join(local,'kiosk-browser-'+stamp());fs.mkdirSync(output,{mode:0o700});
 const leaseFile=path.join(output,'lease.json');const maxSessionId=(await sql`SELECT coalesce(max(id),0)::int AS id FROM auth_sessions`)[0].id;
 const lease={marker:'TEMP_KIOSK_'+randomUUID(),staffId:staff.id,phone:staff.phone,maxSessionId,limit:JSON.parse(baseline.tables.auth_login_limits.rows).find(r=>r.phone===staff.phone)||null,members:[],cleaned:false};save(leaseFile,JSON.stringify(lease));
 const watcher=spawn(process.execPath,[import.meta.filename,'--watchdog',leaseFile],{detached:true,stdio:'ignore',windowsHide:true});watcher.unref();
 const results=[],errors=[],blocked=[];let browser;let stopped=false;const started=Date.now();
 const add=(name,pass,evidence={})=>{results.push({name,pass,evidence});console.log(JSON.stringify({name,pass,evidence}));};
 const budget=()=>{if(stopped||Date.now()-started>110000)throw Error('UAT bounded deadline');};
 const deadline=setTimeout(()=>{stopped=true;void browser?.close();},115000);
 try{
  for(let i=0;i<4;i++){
   budget();
   // Preallocate/lease exact IDs before any fixture insert, so watchdog can recover an interrupted write.
   const id=(await sql`SELECT nextval(pg_get_serial_sequence('members','id'))::int AS id`)[0].id;
   const member={id,member_code:'BLU-'+id};lease.members.push(member);persist(leaseFile,lease);
   await sql.transaction([
    sql`INSERT INTO members(id,member_code,phone,full_name,status,role) VALUES(${id},${member.member_code},${'098'+String(randomInt(1000000,10000000))},${lease.marker},'PENDING','MEMBER')`,
    sql`INSERT INTO coupons(member_id,type,source,title,total_quota,used_count,expire_date,status) VALUES(${id},'FREE_ENTRY','WELCOME_REGISTRATION',${lease.marker},1,0,now()+interval '1 day','AVAILABLE')`
   ]);
  }
  browser=await chromium.launch({headless:true,executablePath});
  async function context(){const c=await browser.newContext({viewport:{width:1280,height:900}});c.setDefaultTimeout(8000);
   await c.route('**/*',async route=>{const u=new URL(route.request().url());if(u.origin!==base||/\/api\/(test-services|.*provider-diagnostics|auth\/(request|verify|register|password))/.test(u.pathname)){blocked.push({path:u.pathname,external:u.origin!==base,dangerous:/\/api\/(test-services|.*provider-diagnostics|auth\/(request|verify|register|password))/.test(u.pathname)});await route.abort();return;}await route.continue();});return c;}
  async function api(c,url,data={},method='POST'){budget();const r=await c.request.fetch(base+url,{method,headers:{Origin:base},...(method==='GET'?{}:{data}),timeout:10000});let body;try{body=await r.json();}catch{body={};}return {status:r.status(),body};}
  const guest=await context();add('guest enter 403',(await api(guest,'/api/kiosk/enter')).status===403);add('guest scan 401',(await api(guest,'/api/kiosk/scan',{code:lease.members[0].member_code,requestKey:randomUUID()})).status===401);
  async function login(){const c=await context();const r=await api(c,'/api/auth/login',{phone:staff.phone,password:staff.password});if(r.status!==200)throw Error('Dedicated password login failed: '+r.status);return c;}
  const a=await login(),other=await login();const copied=await context();await copied.addCookies(await a.cookies());
  add('normal staff scan 401',(await api(a,'/api/kiosk/scan',{code:lease.members[0].member_code,requestKey:randomUUID()})).status===401);
  const token=()=>a.cookies().then(c=>c.find(x=>x.name==='blu_session')?.value);const oldToken=await token();const oldHash=createHash('sha256').update(oldToken).digest('hex');
  add('staff enters kiosk',(await api(a,'/api/kiosk/enter')).status===200);
  const session=(await sql`SELECT mode,device_id,revoked_at FROM auth_sessions WHERE token_hash=${oldHash}`)[0];add('DB KIOSK station bound',session?.mode==='KIOSK'&&!!session.device_id);
  add('other normal session unaffected',(await api(other,'/api/auth/me',{},'GET')).body.member?.memberCode==='BLU-4');
  add('copied pre-enter cookie no normal identity',(await api(copied,'/api/auth/me',{},'GET')).body.member===null);
  const coupon=(await sql`SELECT id FROM coupons WHERE member_id=${lease.members[0].id}`)[0].id;
  for(const [url,data,status,method] of [
   ['/api/admin/roles',{phone:staff.phone,role:'MEMBER'},403],['/api/upload',{},403],['/api/member/coupons/redeem',{couponId:coupon},401],
   ['/api/payments/orders',{},401],['/api/admin/payments/unresolved',{},403,'GET'],['/api/member/payment-account',{},401,'GET']
  ]){const r=await api(copied,url,data,method);add('copied-cookie guard '+url,r.status===status,{status:r.status,expected:status});}
  const page=await a.newPage();await page.goto(base+'/kiosk',{waitUntil:'domcontentloaded',timeout:15000});await page.locator('#scanner').waitFor();await page.waitForTimeout(1500);
  add('scanner autofocus',await page.locator('#scanner').evaluate(e=>document.activeElement===e));
  const response=page.waitForResponse(r=>r.url()===base+'/api/kiosk/scan',{timeout:10000});await page.keyboard.type(lease.members[0].member_code,{delay:35});await page.keyboard.press('Enter');const ui=await(await response).json();add('keyboard code+Enter FREE_ENTRY',ui.reason==='FREE_ENTRY',{reason:ui.reason});
  const uiRequest=(await sql`SELECT request_key FROM kiosk_requests WHERE member_code=${lease.members[0].member_code}`)[0];
  async function scan(c,m,key=randomUUID(),extra={}){return api(c,'/api/kiosk/scan',{code:m.member_code,requestKey:key,...extra});}
  add('same member new key within 3s BOUNCE',(await scan(a,lease.members[0])).body.reason==='BOUNCE');
  add('replay same UI key original result',(await scan(a,lease.members[0],uiRequest.request_key)).body.checkinId===ui.checkinId);
  add('different member immediately FREE_ENTRY',(await scan(a,lease.members[1])).body.reason==='FREE_ENTRY');
  const key=randomUUID();const same=await Promise.all([scan(a,lease.members[2],key),scan(copied,lease.members[2],key)]);
  add('actual HTTP concurrent same key one visit response',same.every(r=>r.body.reason==='FREE_ENTRY')&&same[0].body.checkinId===same[1].body.checkinId);
  const different=await Promise.all([scan(a,lease.members[3],randomUUID(),{station:'CLIENT_OVERRIDE'}),scan(copied,lease.members[3],randomUUID(),{station:'CLIENT_OVERRIDE'})]);
  add('actual HTTP concurrent different keys FREE_ENTRY+BOUNCE',canonical(different.map(r=>r.body.reason).sort())===canonical(['BOUNCE','FREE_ENTRY']),{reasons:different.map(r=>r.body.reason)});
  const rows=await sql`SELECT member_id,count(*)::int AS n,sum(points_awarded)::int AS points,bool_and(scanner_device_id=${session.device_id}) AS station FROM checkins WHERE member_id=ANY(${lease.members.map(m=>m.id)}::int[]) GROUP BY member_id`;
  add('exactly four visits points zero server station',rows.length===4&&rows.every(r=>r.n===1&&r.points===0&&r.station),{visits:rows.reduce((n,r)=>n+r.n,0),points:rows.reduce((n,r)=>n+r.points,0)});
  const used=await sql`SELECT count(*)::int AS n FROM coupons WHERE member_id=ANY(${lease.members.map(m=>m.id)}::int[]) AND status='USED' AND used_count=1`;
  add('exactly four one-time coupon consumptions',used[0].n===4,{consumed:used[0].n});
  await new Promise(r=>setTimeout(r,3100));add('used coupon after 3s denied',(await scan(a,lease.members[0])).body.reason==='NO_ENTITLEMENT');
  await page.screenshot({path:path.join(output,'kiosk.png'),fullPage:true});
  await page.getByRole('button',{name:'พนักงาน: ออกจาก kiosk',exact:true}).click();await page.getByRole('button',{name:'ยกเลิก',exact:true}).click();
  await page.waitForTimeout(150);add('scanner focus restored after cancel',await page.locator('#scanner').evaluate(e=>document.activeElement===e));
  for(const url of ['/admin/checkin','/admin/members','/member','/test']){budget();await page.goto(base+url,{waitUntil:'domcontentloaded',timeout:12000});add('protected kiosk navigation '+url,new URL(page.url()).pathname==='/member/login',{pathname:new URL(page.url()).pathname});if(url==='/test')await page.screenshot({path:path.join(output,'test-access.png'),fullPage:true});}
  add('wrong exit password 401',(await api(a,'/api/kiosk/exit',{password:'intentionally-wrong-UAT'})).status===401);
  add('wrong password stays KIOSK',(await api(a,'/api/kiosk/status')).status===200);
  add('correct exit succeeds',(await api(a,'/api/kiosk/exit',{password:staff.password})).status===200);
  add('exit fresh token NORMAL',(await token())!==oldToken&&(await api(a,'/api/auth/me',{},'GET')).body.member?.memberCode==='BLU-4');
  add('previous kiosk token revoked',(await sql`SELECT revoked_at FROM auth_sessions WHERE token_hash=${oldHash}`)[0]?.revoked_at!==null&&(await api(copied,'/api/kiosk/status')).status===401);
  add('other session still unaffected after exit',(await api(other,'/api/auth/me',{},'GET')).body.member?.memberCode==='BLU-4');
  add('no automatic diagnostic/provider browser requests',!blocked.some(r=>r.dangerous),{blocked});
 }catch(e){let detail=String(e.stack||e);for(const secret of [staff.phone,staff.password,staff.hash])if(secret)detail=detail.replaceAll(secret,'[REDACTED]');save(path.join(output,'failure.txt'),detail);errors.push({message:/^[\w /:+.()-]{1,180}$/.test(e.message)?e.message:'Browser/API failure; inspect protected artifacts'});add('run completed without exception',false,{error:errors.at(-1).message});}
 finally{
  clearTimeout(deadline);stopped=true;await browser?.close().catch(()=>{});
  try{await cleanup(leaseFile);add('bounded own-fixture cleanup',true);}catch{add('bounded own-fixture cleanup',false);errors.push({message:'Cleanup failed; protected lease requires recovery'});}
  for(const table of tables){
   const before=JSON.parse(baseline.tables[table].rows);const current=JSON.parse((await sql.query("SELECT coalesce(json_agg(t),'[]'::json)::text AS rows FROM public."+quote(table)+' t'))[0].rows);
   let after=current;
   if(table==='auth_sessions')after=current.filter(r=>r.id<=maxSessionId);
   add('baseline preserved '+table,canonical(before.slice().sort((a,b)=>canonical(a).localeCompare(canonical(b))))===canonical(after.slice().sort((a,b)=>canonical(a).localeCompare(canonical(b)))),{before:before.length,after:after.length});
  }
  const hardware=await sql`SELECT m.member_code,m.status AS member_status,c.status,c.used_count,c.total_quota FROM members m JOIN coupons c ON c.member_id=m.id WHERE m.member_code IN ('BLU-5','BLU-6') ORDER BY m.member_code,c.id`;
  const staffAfter=await sql`SELECT * FROM members WHERE id=${staff.id}`;add('BLU4 entire member row unchanged',canonical(identity)===canonical(staffAfter));
  const sessions=await sql`SELECT count(*)::int AS total,count(*) FILTER(WHERE revoked_at IS NULL)::int AS active FROM auth_sessions WHERE member_id=${staff.id} AND id>${maxSessionId}`;add('all new operator sessions revoked',sessions[0].active===0,sessions[0]);
  const hardwareBefore=JSON.parse(baseline.tables.members.rows).filter(m=>['BLU-5','BLU-6'].includes(m.member_code)).flatMap(m=>JSON.parse(baseline.tables.coupons.rows).filter(c=>c.member_id===m.id).map(c=>({member_code:m.member_code,member_status:m.status,status:c.status,used_count:c.used_count,total_quota:c.total_quota}))).sort((a,b)=>a.member_code.localeCompare(b.member_code));
    add('hardware fixtures exact before-after preserved',canonical(hardwareBefore)===canonical(hardware),{before:hardwareBefore,after:hardware});
    const report={passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,results,errors,hardwareBefore,hardwareAfter:hardware,backup:path.relative(process.cwd(),directory),marker:lease.marker,temporaryIds:lease.members,limits:['No physical USB or customer-device testing','Fullscreen is not OS lock','No PAID orders, SMS, provider diagnostics or fake logins','No role/status mutation; isolated SQL coverage not rerun here','Concurrent HTTP pairs are not load stress','Sequences advance; new operator sessions remain revoked']};
  save(path.join(output,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,failed:report.failed,errors,hardwareAfter:hardware,artifacts:path.relative(process.cwd(),output)}));if(report.failed)process.exitCode=1;
 }
}
async function bounded(){
 if(!process.argv.includes('--serve'))return main();
 protect();
 // This is our own bounded server, never an existing user's server or browser.
 process.env.KIOSK_UAT_BASE='http://localhost:3001';
 const log=fs.openSync(path.join(local,'kiosk-uat-server-'+stamp()+'.log'),'wx',0o600);
 const server=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--port','3001'],{cwd:path.resolve(import.meta.dirname,'..'),stdio:['ignore',log,log],windowsHide:true});
 const kill=()=>{if(server.exitCode===null){if(process.platform==='win32')execFileSync('taskkill',['/PID',String(server.pid),'/T','/F'],{stdio:'ignore'});else server.kill('SIGTERM');}};
 const timer=setTimeout(kill,165000);
 try{
  let ready=false;for(let i=0;i<25;i++){if(server.exitCode!==null)throw Error('Own bounded server failed to start');try{const r=await fetch('http://localhost:3001/api/auth/me',{signal:AbortSignal.timeout(2500)});if(r.status===200){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}
  if(!ready)throw Error('Own bounded server readiness deadline');
  const child=spawn(process.execPath,[import.meta.filename],{stdio:'inherit',env:{...process.env,KIOSK_UAT_BASE:'http://localhost:3001'},windowsHide:true});
  await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>{process.exitCode=code||0;resolve();});});
 }finally{clearTimeout(timer);kill();fs.closeSync(log);}
}
bounded().catch(safeFailure);

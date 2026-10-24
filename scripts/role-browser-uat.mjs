import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { client, protect, local, save, stamp, safeFailure } from './db-safety.mjs';
import { backup } from './db-backup.mjs';
import { verify } from './db-verify-backup.mjs';

const caseMap = {
  ROLE01: 'Guest identity and protected-page redirects',
  ROLE02: 'Password login and session identity match dedicated DB fixture',
  ROLE03: 'Member pages including real-identity read-only reward catalog',
  ROLE04: 'Member denied all admin modules and owner-only APIs',
  ROLE05: 'Staff four modules allowed, Overview/Members/Finance/test denied',
  ROLE06: 'Owner fixture positive pages; /test automatic diagnostics aborted, not mocked',
  ROLE07: 'Owner unresolved GET and invalid-body APIs; no provider or paid calls',
  ROLE08: 'Owner role API promotes/demotes Member fixture; same session observes roles/guards',
  ROLE09: 'Temporary OWNER fixture protected against self-downgrade',
  ROLE10: 'Cross-origin valid-body actions rejected without mutations',
  ROLE11: 'Existing other-user order and usable other-fixture coupon IDOR',
  ROLE12: 'Logout, bounded cleanup, session revocation and baseline data preservation',
};
const canonical = value => JSON.stringify(sort(value));
function sort(value) {
  if (Array.isArray(value)) return value.map(sort);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k=>[k,sort(value[k])]));
  return value;
}
function leaseWrite(file, value) { fs.writeFileSync(file, JSON.stringify(value,null,2), {mode:0o600}); }
async function cleanup(file, reason) {
  const lease = JSON.parse(fs.readFileSync(file,'utf8'));
  if (lease.state === 'cleaned') return;
  const sql = client();
  const statements = [sql.query("SET LOCAL lock_timeout='5s'"),sql.query("SET LOCAL statement_timeout='15s'")];
  for (const a of lease.accounts) {
    statements.push(sql.query("WITH target AS (SELECT id FROM members WHERE id=$1 AND member_code=$2 AND phone=$3 AND password_hash=$4 AND full_name=$5 AND role IN ('MEMBER','ADMIN','OWNER') FOR UPDATE) SELECT 1 / CASE WHEN count(*)=1 THEN 1 ELSE 0 END AS guard FROM target", [a.id,a.memberCode,a.phone,a.hash,lease.marker+'_'+a.role]));
    statements.push(sql.query('UPDATE members SET role=$1,updated_at=$2::timestamptz WHERE id=$3 AND member_code=$4 AND phone=$5 AND password_hash=$6 AND full_name=$7', [a.role,a.updatedAt,a.id,a.memberCode,a.phone,a.hash,lease.marker+'_'+a.role]));
    statements.push(sql.query('UPDATE auth_sessions SET revoked_at=clock_timestamp() WHERE member_id=$1 AND id>$2 AND revoked_at IS NULL', [a.id,lease.maxSessionId]));
  }
  await sql.transaction(statements,{isolationLevel:'Serializable'});
  lease.state='cleaned'; lease.cleanedAt=new Date().toISOString(); lease.cleanupReason=reason;
  leaseWrite(file,lease);
}
async function watchdog() {
  const file = path.resolve(process.argv[3] || '');
  if (!file.startsWith(local+path.sep) || path.basename(file)!=='lease.json') throw Error('Invalid recovery path');
  await new Promise(resolve=>setTimeout(resolve,150000));
  await cleanup(file,'watchdog deadline');
}
async function main() {
  protect();
  const require = createRequire(path.join(local,'role-browser/package.json'));
  const { chromium } = require('playwright');
  const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>fs.existsSync(p));
  if (!executablePath) throw Error('No verified system Chrome/Edge');
  const fixtures=JSON.parse(fs.readFileSync(path.join(local,'role-uat-fixtures.json'),'utf8'));
  if (fixtures.state!=='created') throw Error('Fixtures not ready');
  const sql=client();
  const member=fixtures.accounts.find(a=>a.memberCode==='BLU-3' && a.role==='MEMBER');
  const staff=fixtures.accounts.find(a=>a.memberCode==='BLU-4' && a.role==='ADMIN');
  if (!member || !staff || fixtures.accounts.length!==2) throw Error('Exact two dedicated fixtures required');
  const guarded=[];
  for (const a of [member,staff]) {
    const found=await sql`SELECT updated_at::text AS updated_at FROM members WHERE id=${a.id} AND member_code=${a.memberCode} AND role=${a.role} AND phone=${a.phone} AND password_hash=${a.hash} AND full_name=${fixtures.marker+'_'+a.role}`;
    if(found.length!==1) throw Error('Fixture identity mismatch; inspect protected lease if interrupted');
    guarded.push({...a,updatedAt:found[0].updated_at});
  }
  const realOrders=await sql`SELECT id FROM package_payment_orders WHERE member_id NOT IN (${member.id},${staff.id}) AND id::text LIKE 'fa7%' ORDER BY id`;
  if(realOrders.length!==1) throw Error('Expected existing fa7 order not uniquely identified');
  const realOrder=realOrders[0].id;
  const tableNames=(await sql.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(x=>x.tablename);
  const baselineDir=await backup(sql,tableNames); await verify(baselineDir,sql);
  const baseline=JSON.parse(fs.readFileSync(path.join(baselineDir,'snapshot.json'),'utf8'));
  const output=path.join(local,'role-uat-'+stamp()); fs.mkdirSync(output,{mode:0o700});
  const results=[],audit=[];
  const add=(caseId,role,name,pass,evidence={})=>{const item={caseId,role,name,pass,evidence};results.push(item);console.log(JSON.stringify(item));};
  const auditFile=path.join(output,'operator-audit.json'); save(auditFile,'[]');
  const event=(operation,extra={})=>{audit.push({at:new Date().toISOString(),operation,...extra});leaseWrite(auditFile,audit);};
  const [{id:maxSessionId}]=await sql`SELECT coalesce(max(id),0)::int AS id FROM auth_sessions`;
  const leaseFile=path.join(output,'lease.json');
  save(leaseFile,JSON.stringify({state:'active',marker:fixtures.marker,accounts:guarded.map(({password,...a})=>{void password;return a;}),maxSessionId,baseline:baselineDir},null,2));
  // Independent cleanup survives the parent being terminated by the terminal timeout.
  const watcher=spawn(process.execPath,[import.meta.filename,'--watchdog',leaseFile],{detached:true,stdio:'ignore',windowsHide:true}); watcher.unref();
  let browser;
  let couponFixtures=[];
  let cleanupOK=false;
  const base='http://localhost:3000';
  const staffPaths=['/admin/checkin','/admin/rewards','/admin/promo-codes','/admin/coupons'];
  const ownerPaths=['/admin','/admin/members','/admin/finance','/admin/members/'+member.memberCode];
  const memberPaths=['/member','/member/benefits','/member/rewards'];
  const absentOrder='00000000-0000-4000-8000-000000000000';
  async function api(context,caseId,role,url,method,expected,data,origin=base) {
    const response=await context.request.fetch(base+url,{method,headers:{Origin:origin},...(data===undefined?{}:{data}),timeout:15000});
    add(caseId,role,method+' '+url+(origin!==base?' cross-origin':''),response.status()===expected,{status:response.status(),expected});
    return response;
  }
  async function identity(context,role,expected,caseId='ROLE02') {
    const res=await context.request.get(base+'/api/auth/me',{timeout:15000});const body=await res.json();
    add(caseId,role,'session role '+expected,(expected===null?body.member===null:body.member?.role===expected),{status:res.status(),actualRole:body.member?.role??null,memberCode:body.member?.memberCode});
    return body.member;
  }
  async function login(account,role) {
    const context=await browser.newContext({viewport:{width:1280,height:900}});context.setDefaultTimeout(10000);
    const res=await api(context,'ROLE02',role,'/api/auth/login','POST',200,{phone:account.phone,password:account.password});
    if(res.status()!==200) throw Error('Fixture password login failed');
    const me=await identity(context,role,role);
    add('ROLE02',role,'DB memberCode matches session',me?.memberCode===account.memberCode,{memberCode:me?.memberCode});
    return context;
  }
  async function pageCheck(page,caseId,role,url,target,banner=false) {
    const errors=[];
    const onError=()=>errors.push('uncaught-page-error');page.on('pageerror',onError);
    try {
      const res=await page.goto(base+url,{waitUntil:'networkidle',timeout:25000});
      const text=await page.locator('body').innerText();const actual=new URL(page.url()).pathname;
      const headings=(await page.locator('h1,h2').allTextContents()).map(x=>x.trim()).filter(Boolean);
      const alerts=(await page.locator('[role="alert"]').allTextContents()).map(x=>x.trim()).filter(Boolean);
      const errorAlerts=alerts.filter(x=>!/ข้อมูลจำลอง|mock|ทดลอง/i.test(x) || /รองรับเฉพาะ|ผิดพลาด|ไม่สำเร็จ|ไม่ได้|error/i.test(x));
      const healthy=Boolean(res && res.status()<400) && !/Application error|Internal Server Error|This page could not be found/.test(text) && errors.length===0 && errorAlerts.length===0;
      const pass=healthy && actual===target && (banner?text.includes('หน้านี้สำหรับ OWNER เท่านั้น'):headings.length>0 && text.trim().length>40 && !text.includes('หน้านี้สำหรับ OWNER เท่านั้น'));
      const recognizedErrors=['ไม่พบสมาชิกตามรหัสที่ระบุ','ร้าน mock รองรับเฉพาะสมาชิกตัวอย่างในรายชื่อ Admin เท่านั้น'].filter(x=>text.includes(x));
            add(caseId,role,'PAGE '+url,pass && recognizedErrors.length===0,{status:res?.status(),actual,expected:target,headings:headings.slice(0,4),alerts,errorCount:errors.length,recognizedErrors});
      if(url==='/member/rewards' && target===url){
        const redeem=page.locator('article button');
        const buttons=await redeem.count();let enabled=0;for(let i=0;i<buttons;i++) if(await redeem.nth(i).isEnabled()) enabled++;
        add('ROLE03',role,'real identity catalog read-only',buttons>0 && enabled===0,{redemptionButtons:buttons,enabled});
      }
      await page.screenshot({path:path.join(output,role+'-'+url.replaceAll('/','_')+'-'+results.length+'.png'),fullPage:true,timeout:10000});
    } catch {add(caseId,role,'PAGE '+url,false,{error:'Navigation/assertion/screenshot failed; details suppressed'});}
    finally {page.off('pageerror',onError);}
  }
  async function roleIs(a,expected,label) {
    const rows=await sql`SELECT role FROM members WHERE id=${a.id} AND member_code=${a.memberCode} AND phone=${a.phone} AND password_hash=${a.hash} AND full_name=${fixtures.marker+'_'+a.role}`;
    add(label==='FINAL'?'ROLE12':label==='OWNER' && a.id===staff.id?'ROLE09':'ROLE08',label,'DB fixture role '+expected,rows.length===1 && rows[0].role===expected,{memberCode:a.memberCode,actualRole:rows[0]?.role});
  }
  try {
    const existingCoupons=await sql`SELECT id FROM coupons WHERE member_id IN (${member.id},${staff.id}) AND source='WELCOME_REGISTRATION'`;
    if(existingCoupons.length) throw Error('Existing fixture welcome coupons require operator review; do not overwrite');
    const nonce=randomBytes(6).toString('hex');
    couponFixtures=(await sql.transaction([member,staff].map(a=>sql.query("INSERT INTO coupons (member_id,type,source,title,total_quota,used_count,status,expire_date) VALUES ($1,'FREE_ENTRY','WELCOME_REGISTRATION',$2,1,0,'AVAILABLE',now()+interval '1 day') RETURNING id,member_id,title",[a.id,fixtures.marker+'_IDOR_'+nonce+'_'+a.memberCode])),{isolationLevel:'Serializable'})).flat();
    event('create dedicated usable coupon fixtures',{coupons:couponFixtures});
    browser=await chromium.launch({headless:true,executablePath,timeout:20000});
    for(const role of ['GUEST','MEMBER','ADMIN']) {
      const context=role==='GUEST'?await browser.newContext({viewport:{width:1280,height:900}}):await login(role==='MEMBER'?member:staff,role);
      const page=await context.newPage();
      if(role==='GUEST') await identity(context,role,null,'ROLE01');
      for(const url of memberPaths) await pageCheck(page,role==='GUEST'?'ROLE01':'ROLE03',role,url,role==='GUEST'?'/member/login':url);
      for(const url of [...staffPaths,...ownerPaths]) await pageCheck(page,role==='GUEST'?'ROLE01':role==='MEMBER'?'ROLE04':'ROLE05',role,url,role==='GUEST'?'/member/login':role==='MEMBER'?'/member':staffPaths.includes(url)?url:'/admin/checkin');
      await pageCheck(page,role==='GUEST'?'ROLE01':role==='MEMBER'?'ROLE04':'ROLE05',role,'/test','/test',true);
      for(const [url,method] of [['/api/admin/roles','POST'],['/api/admin/payments/unresolved','GET'],['/api/admin/payments/provider-diagnostics','POST'],[`/api/admin/payments/${absentOrder}/reject`,'POST'],[`/api/admin/payments/${absentOrder}/recheck`,'POST'],['/api/test-services','POST'],['/api/test-services','GET']]) await api(context,role==='ADMIN'?'ROLE05':'ROLE04',role,url,method,403,method==='POST'?{}:undefined);
      await api(context,'ROLE11',role,`/api/payments/orders/${realOrder}`,'GET',role==='GUEST'?401:404);
      if(role!=='GUEST') {
        const other=couponFixtures.find(c=>c.member_id===(role==='MEMBER'?staff.id:member.id));
        await api(context,'ROLE11',role,'/api/member/coupons/redeem','POST',409,{couponId:other.id});
      }
      await api(context,'ROLE03',role,'/api/member/payment-account','GET',role==='GUEST'?401:200);
      if(role!=='GUEST') {
        await api(context,'ROLE12',role,'/api/auth/logout','POST',200,{});await identity(context,role,null,'ROLE12');
        await pageCheck(page,'ROLE12',role,'/member','/member/login');await pageCheck(page,'ROLE12',role,'/admin/checkin','/member/login');
      }
      await context.close();
    }
    const elevated=await sql`UPDATE members SET role='OWNER' WHERE id=${staff.id} AND member_code=${staff.memberCode} AND phone=${staff.phone} AND password_hash=${staff.hash} AND full_name=${fixtures.marker+'_ADMIN'} AND role='ADMIN' RETURNING id`;
    if(elevated.length!==1) throw Error('Guarded elevation failed');event('temporary ADMIN -> OWNER',{memberCode:staff.memberCode});
    const ownerContext=await login(staff,'OWNER');const ownerPage=await ownerContext.newPage();
    // /test auto-calls external service diagnostics on mount: abort rather than fabricate API success.
    let diagnosticsAborted=0;
    await ownerContext.route('**/api/test-services',route=>{diagnosticsAborted++;return route.abort('blockedbyclient');});
    for(const url of [...staffPaths,...ownerPaths,'/test']) await pageCheck(ownerPage,'ROLE06','OWNER',url,url);
    add('ROLE06','OWNER','automatic /test service diagnostics prevented',diagnosticsAborted>0,{abortedRequests:diagnosticsAborted});
    await api(ownerContext,'ROLE07','OWNER','/api/admin/payments/unresolved','GET',200);
    for(const url of ['/api/admin/roles','/api/admin/payments/provider-diagnostics',`/api/admin/payments/${absentOrder}/reject`,`/api/admin/payments/${absentOrder}/recheck`]) await api(ownerContext,'ROLE07','OWNER',url,'POST',400,{});
    await api(ownerContext,'ROLE11','OWNER',`/api/payments/orders/${realOrder}`,'GET',404);
    // All valid cross-origin requests target only fixtures or absent IDs and must stop before actions.
    for(const [url,data] of [
      ['/api/admin/roles',{phone:member.phone,role:'ADMIN'}],
      ['/api/admin/payments/provider-diagnostics',{confirmedReadOnly:true}],
      [`/api/admin/payments/${absentOrder}/recheck`,{confirmed:true,reason:'PROMPTPAY_REGISTRATION_FIX'}],
      [`/api/admin/payments/${absentOrder}/reject`,{reason:'UAT fixture safety rejection',evidence:{source:'BANK',outcome:'NO_TRANSFER_CONFIRMED',caseReference:'UAT-ONLY',summary:'Synthetic absent order; never reconcile real data',approved:true}}],
      ['/api/auth/logout',{}],
    ]) await api(ownerContext,'ROLE10','OWNER',url,'POST',403,data,'https://uat.invalid');
    await identity(ownerContext,'OWNER','OWNER','ROLE10');await roleIs(member,'MEMBER','OWNER');
    const liveMember=await login(member,'MEMBER');const livePage=await liveMember.newPage();
    await api(ownerContext,'ROLE08','OWNER','/api/admin/roles','POST',200,{phone:member.phone,role:'ADMIN'});event('Owner API MEMBER -> ADMIN',{memberCode:member.memberCode});
    await roleIs(member,'ADMIN','MEMBER_SAME_SESSION');await identity(liveMember,'MEMBER_SAME_SESSION','ADMIN','ROLE08');
    await pageCheck(livePage,'ROLE08','MEMBER_SAME_SESSION','/admin/checkin','/admin/checkin');
    await pageCheck(livePage,'ROLE08','MEMBER_SAME_SESSION','/admin/members','/admin/checkin');
    await api(ownerContext,'ROLE08','OWNER','/api/admin/roles','POST',200,{phone:member.phone,role:'MEMBER'});event('Owner API ADMIN -> MEMBER',{memberCode:member.memberCode});
    await roleIs(member,'MEMBER','MEMBER_SAME_SESSION');await identity(liveMember,'MEMBER_SAME_SESSION','MEMBER','ROLE08');
    await pageCheck(livePage,'ROLE08','MEMBER_SAME_SESSION','/admin/checkin','/member');
    await api(liveMember,'ROLE08','MEMBER_SAME_SESSION','/api/admin/roles','POST',403,{phone:member.phone,role:'ADMIN'});
    await api(ownerContext,'ROLE09','OWNER','/api/admin/roles','POST',404,{phone:staff.phone,role:'MEMBER'});await roleIs(staff,'OWNER','OWNER');event('protected OWNER self-downgrade rejected',{memberCode:staff.memberCode});
    for(const c of couponFixtures) {
      const rows=await sql`SELECT id FROM coupons WHERE id=${c.id} AND member_id=${c.member_id} AND title=${c.title} AND source='WELCOME_REGISTRATION' AND type='FREE_ENTRY' AND status='AVAILABLE' AND used_count=0 AND total_quota=1 AND expire_date>now() AND created_at+interval '30 days'>now()`;
      add('ROLE11','SAFETY','foreign coupon remains usable/unconsumed',rows.length===1,{couponId:c.id});
    }
    await liveMember.close();
    await cleanup(leaseFile,'normal finally restoration');cleanupOK=true;event('restored MEMBER/ADMIN and revoked only new fixture sessions');
    await identity(ownerContext,'OWNER_AFTER_CLEANUP',null,'ROLE12');
    await pageCheck(ownerPage,'ROLE12','OWNER_AFTER_CLEANUP','/admin','/member/login');
    await api(ownerContext,'ROLE12','OWNER_AFTER_CLEANUP','/api/admin/payments/unresolved','GET',403);
    await ownerContext.close();
  } catch {
    add('ROLE12','OPERATOR','run completed without fatal interruption',false,{error:'Sensitive details suppressed; inspect cases and protected recovery lease'});
  } finally {
    try {await cleanup(leaseFile,'finally restoration');cleanupOK=true;event('finally cleanup verified');}
    catch {add('ROLE12','SAFETY','cleanup succeeded',false,{recovery:'Protected lease.json; watchdog will retry at deadline'});}
    if(cleanupOK) watcher.kill();
    // Remove only these exact unused synthetic benefits. Never delete consumed/audited rows.
    for(const c of couponFixtures) {
      const removed=await sql`DELETE FROM coupons WHERE id=${c.id} AND member_id=${c.member_id} AND title=${c.title} AND source='WELCOME_REGISTRATION' AND type='FREE_ENTRY' AND status='AVAILABLE' AND used_count=0 AND total_quota=1 AND NOT EXISTS(SELECT 1 FROM checkins WHERE member_id=${c.member_id} AND notes LIKE ${'%coupon='+c.id+';%'}) RETURNING id`;
      add('ROLE12','SAFETY','remove exact unused fixture coupon',removed.length===1,{couponId:c.id});
    }
    event('coupon cleanup',{couponIds:couponFixtures.map(c=>c.id)});
    if(browser) await browser.close();
    for(const a of [member,staff]) await roleIs(a,a.role,'FINAL');
    const active=await sql`SELECT id FROM auth_sessions WHERE member_id IN (${member.id},${staff.id}) AND id>${maxSessionId} AND revoked_at IS NULL`;
    add('ROLE12','SAFETY','all new fixture sessions revoked',active.length===0,{activeCount:active.length});
    for(const [table,data] of Object.entries(baseline.tables)) {
      if(!/^[a-z_]+$/.test(table)) throw Error('Invalid table');
      const original=JSON.parse(data.rows);const current=(await sql.query(`SELECT to_jsonb(t) AS row FROM public."${table}" t`)).map(x=>x.row);
      const currentSet=new Set(current.map(canonical));
      const liveLimit=r=>table==='auth_login_limits' && (r.phone===member.phone || r.phone===staff.phone);
      add('ROLE12','SAFETY','preserve pre-run baseline '+table,original.filter(r=>!liveLimit(r)).every(r=>currentSet.has(canonical(r))),{baselineRows:original.length,currentRows:current.length,exception:table==='auth_login_limits'?'only fixture-phone limits may change':undefined});
      const originals=new Set(original.map(canonical));const extras=current.filter(r=>!originals.has(canonical(r)));
      const allowedExtras=extras.every(r=>table==='auth_sessions'? [member.id,staff.id].includes(r.member_id) && r.id>maxSessionId && r.revoked_at!==null:liveLimit(r));
      add('ROLE12','SAFETY','only approved new/changed rows '+table,allowedExtras,{extraRows:extras.length});
    }
    const originalSnapshot=JSON.parse(fs.readFileSync(path.join(fixtures.backup,'snapshot.json'),'utf8'));
    for(const table of ['members','coupons','checkins','package_payment_orders','package_payment_attempts','package_payment_point_ledger','package_payment_resolution_audit','payment_transfer_refs','payments']) {
      const original=JSON.parse(originalSnapshot.tables[table].rows);const current=await sql.query(`SELECT to_jsonb(t) AS row FROM public."${table}" t`);const set=new Set(current.map(x=>canonical(x.row)));
      add('ROLE12','SAFETY','preserve original pre-fixture '+table,original.every(r=>set.has(canonical(r))),{baselineRows:original.length});
    }
    const report={createdAt:new Date().toISOString(),passed:results.filter(x=>x.pass).length,failed:results.filter(x=>!x.pass).length,caseMap,results,audit,cleanupOK,baseline:path.relative(process.cwd(),baselineDir),realOrderId:realOrder,fixtures:[{memberCode:member.memberCode,role:'MEMBER'},{memberCode:staff.memberCode,role:'ADMIN'}],limitations:['OWNER /test automatic service API aborted; page permission only, no diagnostics success claimed','Coupon fixtures inserted directly, not proof of registration grant; exact unused rows removed','No payment creation/verification, SMS/OTP, own-coupon redemption, full CRUD or provider calls intended','Additional OWNER member-detail smoke check uses BLU-3 DB fixture; current mock-backed detail cannot find this DB member (MemberDetailClient.tsx:63-70)']};
    save(path.join(output,'results.json'),JSON.stringify(report,null,2));
    save(path.join(output,'report.md'),`# Role UAT continuation\n\nPassed ${report.passed}; failed ${report.failed}; cleanup ${cleanupOK}.\n\nBLU-3 MEMBER; BLU-4 ADMIN restored. No new OWNER account. Temporary role changes and coupon IDs are recorded in operator-audit.json; protected recovery metadata in lease.json. Credentials remain only in ../role-uat-fixtures.json.\n\n## Cases\n${Object.entries(caseMap).map(([id,description])=>{const items=results.filter(x=>x.caseId===id);return '- '+id+': '+description+' — '+items.filter(x=>x.pass).length+'/'+items.length+' passed';}).join('\n')}\n\n## Failures\n${results.filter(x=>!x.pass).map(x=>'- '+x.caseId+' '+x.role+' '+x.name).join('\n')||'None'}\n\n## Limitations\n${report.limitations.map(x=>'- '+x).join('\n')}\n\nRe-run: node scripts/role-browser-uat.mjs (existing localhost:3000 server required). Backup: ${report.baseline}. No application source changes.\n`);
    console.log(JSON.stringify({passed:report.passed,failed:report.failed,cleanupOK,artifacts:path.relative(process.cwd(),output)}));
    if(report.failed) process.exitCode=1;
  }
}
if(process.argv[2]==='--watchdog') watchdog().catch(safeFailure);else main().catch(safeFailure);

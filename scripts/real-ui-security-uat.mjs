import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID, randomBytes, randomInt, scryptSync } from 'node:crypto';
import { client, protect, local, save, stamp, safeFailure } from './db-safety.mjs';

const base = 'http://localhost:3000';
const orderId = randomUUID(); // Nonexistent UUID: never borrow an actual customer's order.
const reads = new Set(['/api/auth/me','/api/member/profile','/api/member/wallet','/api/member/payment-account','/api/rewards/member','/api/rewards/admin','/api/admin/benefits/list','/api/admin/finance/read',`/api/payments/orders/${orderId}`]);
const probes = new Set(['PUT /api/member/profile','DELETE /api/member/profile','PATCH /api/member/profile','POST /api/admin/benefits/list','POST /api/admin/finance/read','GET /api/admin/benefits/create','GET /api/admin/finance/create']);
function allowed(method, url, direct = false) {
  const u = new URL(url);
  if (u.origin !== base) return false;
  if (!u.pathname.startsWith('/api/')) return !direct && method === 'GET';
  // Source-reviewed history endpoint is POST but performs SELECT only; scan remains blocked.
    return method === 'POST' && u.pathname === '/api/admin/checkin/history' || method === 'GET' && reads.has(u.pathname) || direct && (probes.has(`${method} ${u.pathname}`) || method === 'POST' && u.pathname === '/api/auth/login');
}
async function main() {
  protect();
  const sql = client(), accounts = [], results = [], contexts = [], blocked = [], runtimeErrors = [];
  const output = path.join(local, 'real-ui-security-' + stamp()); fs.mkdirSync(output);
  const check = async (name, fn) => { try { const detail = await fn(); results.push({name,pass:true,...detail}); } catch(e) { results.push({name,pass:false,error:String(e.message).slice(0,700)}); } console.log(JSON.stringify(results.at(-1))); };
  const request = async (context, method, url, options = {}) => {
    assert(allowed(method, base + url, true), 'Explicit API whitelist rejected request');
    // APIRequestContext bypasses context.route: every call must go through this wrapper.
    return context.request.fetch(base + url, {method,timeout:15000,maxRedirects:0,...options});
  };
  let browser;
  try {
    const { chromium } = createRequire(path.join(local,'role-browser/package.json'))('playwright');
    const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p=>fs.existsSync(p));
    assert(executablePath,'Local Chrome unavailable');
    browser = await chromium.launch({executablePath,headless:true});
    const makeContext = async () => {
      const c = await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'}); contexts.push(c);
      await c.route('**/*', route => {
        if (!allowed(route.request().method(), route.request().url())) { const u=new URL(route.request().url()); blocked.push({method:route.request().method(),origin:u.origin,path:u.pathname}); return route.abort(); }
        return route.continue();
      });
      return c;
    };
    const guest = await makeContext();
    for (const url of ['/api/member/profile','/api/member/wallet','/api/admin/benefits/list','/api/admin/finance/read',`/api/payments/orders/${orderId}`]) await check('guest denied '+url,async()=>{
      const r=await request(guest,'GET',url); const b=await r.json(); assert.equal(r.status(),401); assert.equal(typeof b.error,'string'); assert(!b.profile&&!b.order&&!b.data); return {status:r.status()};
    });
    for (const role of ['OWNER','ADMIN','MEMBER']) {
      const id=(await sql.query("SELECT nextval(pg_get_serial_sequence('members','id'))::int AS id"))[0].id;
      const password='Uat!'+randomBytes(20).toString('hex'), salt=randomBytes(16).toString('hex');
      const hash=['scrypt',32768,8,1,salt,scryptSync(password,salt,64,{N:32768,r:8,p:1,maxmem:67108864}).toString('hex')].join('$');
      const marker='TEMP_UI_SECURITY_'+randomUUID();
      const name=role==='MEMBER'?'<img src=x onerror="window.__uatXss=1">':marker;
      const a={id,role,phone:'09'+randomInt(10000000,100000000),code:'BLU-'+id,marker,name}; accounts.push(a);
      save(path.join(output,'recovery-'+role+'.json'),JSON.stringify(a));
      await sql`INSERT INTO members(id,member_code,phone,full_name,password_hash,status,role) VALUES(${id},${a.code},${a.phone},${name},${hash},'PENDING',${role}::member_role)`;
      const context=await makeContext();
      await check(role+' temporary password login',async()=>{const r=await request(context,'POST','/api/auth/login',{headers:{Origin:base},data:{phone:a.phone,password}});assert.equal(r.status(),200);const cookies=await context.cookies();assert(cookies.some(c=>c.httpOnly));});
      a.context=context;
      const page=await context.newPage(); page.on('pageerror',e=>runtimeErrors.push({role,message:e.message.slice(0,250)}));
      const pages=['/','/member','/member/benefits','/member/rewards',...(role!=='MEMBER'?['/admin/checkin','/admin/rewards','/admin/coupons','/admin/promo-codes']:[]),...(role==='OWNER'?['/admin','/admin/members','/admin/members/'+a.code,'/admin/finance']:[])];
      for (const width of [360,390,1440]) {
        await page.setViewportSize({width,height:width===1440?1000:844});
        for (const url of pages) await check(`${role} layout ${width} ${url}`,async()=>{
          const response=await page.goto(base+url,{waitUntil:'networkidle',timeout:30000}); assert.equal(response.status(),200);
          const text=await page.locator('body').innerText(); assert(text.trim().length>50);assert(!/Application error:|Internal Server Error|ข้อมูลจำลองสำหรับระบบหลังบ้าน/.test(text));
          const geometry=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,offscreen:[...document.querySelectorAll('button,a,input')].filter(e=>{const r=e.getBoundingClientRect();const s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&(r.left < -2||r.right>innerWidth+2);}).map(e=>e.textContent?.trim().slice(0,50)||e.tagName).slice(0,10)}));
          await page.screenshot({path:path.join(output,`${role}-${width}-${url.replaceAll('/','_')}.png`),fullPage:true});
          assert(geometry.scroll<=width+2,JSON.stringify(geometry)); assert.equal(geometry.offscreen.length,0,JSON.stringify(geometry)); return geometry;
        });
      }
      if(role==='MEMBER') {
        await check('XSS fixture literal text, no injected DOM/execution',async()=>{await page.goto(base+'/member',{waitUntil:'networkidle'});assert((await page.locator('body').innerText()).includes(name)); assert.equal(await page.evaluate(()=>window.__uatXss),undefined);assert.equal(await page.locator('img[onerror]').count(),0);});
        await check('profile query ID tamper remains own profile',async()=>{const r=await request(context,'GET','/api/member/profile?memberId=1&id=1');const b=await r.json();assert.equal(r.status(),200);assert.equal(b.profile.fullName,name);assert(!('passwordHash' in b.profile));});
        await check('random order ID reveals no order',async()=>{const r=await request(context,'GET',`/api/payments/orders/${orderId}`);const b=await r.json();assert.equal(r.status(),404);assert(!b.order);assert.equal(typeof b.error,'string');});
        for(const url of ['/api/admin/benefits/list','/api/admin/finance/read','/api/rewards/admin']) await check('MEMBER role denial '+url,async()=>{const r=await request(context,'GET',url);const b=await r.json();assert.equal(r.status(),403);assert.equal(typeof b.error,'string');assert(!b.data);});
        for(const [method,url] of [['PUT','/api/member/profile'],['DELETE','/api/member/profile'],['POST','/api/admin/benefits/list'],['POST','/api/admin/finance/read'],['GET','/api/admin/benefits/create'],['GET','/api/admin/finance/create']]) await check('method denial '+method+' '+url,async()=>{const r=await request(context,method,url,{headers:{Origin:base},data:{}});assert.equal(r.status(),405);});
        await check('cross-origin profile PATCH rejected without changing fixture',async()=>{const r=await request(context,'PATCH','/api/member/profile',{headers:{Origin:'https://untrusted.invalid'},data:{fullName:'CSRF ATTEMPT',nickname:'',gender:'OTHER',birthDay:1,birthMonth:1,emergencyName:'',emergencyPhone:'',emergencyRelation:''}});assert([400,403].includes(r.status()),'status '+r.status());assert.equal((await sql`SELECT full_name FROM members WHERE id=${id}`)[0].full_name,name);});
        for(const width of [360,390,1440]) {
          await page.setViewportSize({width,height:844}); await page.goto(base+'/',{waitUntil:'networkidle'});
          const trigger=page.locator('button').filter({hasText:/เลือกแพ็กเกจ|เลือกแพ็ก|Select/i}).first();
          await check('PaymentModal open '+width,async()=>{await trigger.click();await page.getByRole('dialog').waitFor();assert((await page.getByRole('dialog').innerText()).includes('ชำระแพ็กเกจ'));});
          if(await page.getByRole('dialog').count()) {
            const dialog=page.getByRole('dialog');
            await check('PaymentModal bounds '+width,async()=>{const b=await dialog.locator('div').first().boundingBox();assert(b.x>=0&&b.x+b.width<=width+1&&b.y>=0&&b.y+b.height<=845);await page.screenshot({path:path.join(output,'modal-'+width+'.png')});});
            await check('PaymentModal initial focus inside '+width,async()=>assert(await dialog.evaluate(e=>e.contains(document.activeElement))));
            await check('PaymentModal keyboard focus trapped '+width,async()=>{await dialog.getByRole('button',{name:'ปิด',exact:true}).focus();await page.keyboard.press('Shift+Tab');assert(await dialog.evaluate(e=>e.contains(document.activeElement)),'Shift+Tab escaped dialog');});
            await check('PaymentModal Escape closes '+width,async()=>{await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);});
            if(await dialog.count()) await dialog.getByRole('button',{name:'ปิด',exact:true}).click();
            await check('PaymentModal restores trigger focus '+width,async()=>assert(await trigger.evaluate(e=>e===document.activeElement)));
          }
        }
        // Inject only read responses; no order/create/verify request is ever fulfilled or sent.
        for (const fault of ['403','network-timeout']) await check('PaymentModal injected read '+fault+' visible error and retry',async()=>{
          const pattern=base+'/api/member/payment-account';
          const handler=route=>fault==='403'?route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({error:'UAT forbidden 403'})}):route.abort('timedout');
          await context.route(pattern,handler);
          try {
            await page.goto(base+'/',{waitUntil:'networkidle'});await page.locator('button').filter({hasText:/เลือกแพ็กเกจ|เลือกแพ็ก|Select/i}).first().click();
            const d=page.getByRole('dialog');await page.waitForTimeout(400);
            assert(await d.getByRole('alert').filter({hasText:fault==='403'?/UAT forbidden 403/:/fetch|network|โหลด|Failed/i}).count());
            assert(await d.getByRole('button',{name:'โหลดคำสั่งซื้อ / สถานะล่าสุด'}).isEnabled());
            assert(await d.getByRole('link',{name:'เข้าสู่ระบบสมาชิก'}).isVisible());
            assert(!(await d.innerText()).includes('ชำระสำเร็จและบันทึกสมาชิกจริงแล้ว'));
          } finally { await context.unroute(pattern,handler); }
        });
        await check('PaymentModal delayed read disables actions and prevents duplicate refresh',async()=>{
          const pattern=base+'/api/member/payment-account';let calls=0;
          const handler=async route=>{calls++;await new Promise(resolve=>setTimeout(resolve,600));await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({pendingOrder:null,readiness:{transfersEnabled:false,blocker:'UAT no transfer'}})});};
          await context.route(pattern,handler);
          try {
            await page.goto(base+'/',{waitUntil:'networkidle'});await page.locator('button').filter({hasText:/เลือกแพ็กเกจ|เลือกแพ็ก|Select/i}).first().click();
            await page.waitForTimeout(800);calls=0;
            const d=page.getByRole('dialog'),refresh=d.getByRole('button',{name:'โหลดคำสั่งซื้อ / สถานะล่าสุด'});
            await refresh.focus();await page.keyboard.press('Enter');await page.keyboard.press('Enter');
            assert(await refresh.isDisabled());assert(await d.getByRole('button',{name:'ปิด',exact:true}).isDisabled());
            assert(await d.getByRole('button',{name:'สร้างคำสั่งซื้อ / แสดงยอดจริง'}).isDisabled());
            await page.waitForTimeout(800);assert.equal(calls,1);assert(await refresh.isEnabled());
          } finally {await context.unroute(pattern,handler);}
        });
        // Open first, then revoke only this disposable identity's active session(s).
        await page.goto(base+'/',{waitUntil:'networkidle'});await page.locator('button').filter({hasText:/เลือกแพ็กเกจ|เลือกแพ็ก|Select/i}).first().click();
        await sql`UPDATE auth_sessions SET revoked_at=clock_timestamp() WHERE member_id=${id} AND revoked_at IS NULL`;
        await check('revoked own session API denies profile',async()=>{const r=await request(context,'GET','/api/member/profile');const b=await r.json();assert.equal(r.status(),401);assert(!b.profile);});
        await check('PaymentModal expired session visible error/login, no success',async()=>{await page.getByRole('dialog').getByRole('button',{name:'โหลดคำสั่งซื้อ / สถานะล่าสุด'}).click();await page.waitForTimeout(1000);const d=page.getByRole('dialog');assert(await d.getByRole('alert').filter({hasText:/เข้าสู่ระบบ|เซสชัน/}).count());assert(await d.getByRole('link',{name:'เข้าสู่ระบบสมาชิก'}).isVisible());assert(!(await d.innerText()).includes('ชำระสำเร็จและบันทึกสมาชิกจริงแล้ว'));});
      }
    }
    await check('no browser runtime errors',async()=>assert.deepEqual(runtimeErrors,[]));
    await check('no attempted business/provider writes from tested UI',async()=>assert.deepEqual(blocked.filter(b=>b.path.startsWith('/api/')&&b.method!=='GET'),[]));
  } catch(e) { results.push({name:'suite execution',pass:false,error:String(e.message).slice(0,700)}); }
  finally {
    for(const c of contexts) await c.close().catch(()=>{}); await browser?.close();
    for(const a of accounts) await check('cleanup temporary '+a.role,async()=>{await sql.transaction([sql`DELETE FROM auth_login_limits WHERE phone=${a.phone}`,sql`DELETE FROM members WHERE id=${a.id} AND member_code=${a.code} AND full_name=${a.name}`]);assert.equal((await sql`SELECT count(*)::int AS n FROM members WHERE id=${a.id}`)[0].n,0);assert.equal((await sql`SELECT count(*)::int AS n FROM auth_sessions WHERE member_id=${a.id}`)[0].n,0);});
    const report={passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,results,blocked,runtimeErrors,limits:['Only temporary login accounts/session revocation; no real user credentials or sessions','No order creation, verify, upload, provider, SMS, benefit/reward/finance CRUD or audit writes','Random nonexistent order ID checks non-disclosure, not cross-owner existing-order ownership','No pending order fixture, so pending order retention/verification concurrency not tested','No full credential leakage audit; artifacts contain only own fixture plus visible authorized pages and remain gitignored','Database sequences advance; accounts/login limits cleaned, sessions cascade']};
    save(path.join(output,'results.json'),JSON.stringify(report,null,2));
    save(path.join(output,'report.md'),'# Real UI/security UAT\n\n'+`PASS ${report.passed}; FAIL ${report.failed}\n\n`+results.map(r=>`- ${r.pass?'PASS':'FAIL'} ${r.name}${r.error?' — '+r.error:''}`).join('\n')+'\n\n## Limits\n'+report.limits.map(s=>'- '+s).join('\n'));
    console.log(JSON.stringify({passed:report.passed,failed:report.failed,artifacts:path.relative(process.cwd(),output)}));if(report.failed)process.exitCode=1;
  }
}
main().catch(safeFailure);

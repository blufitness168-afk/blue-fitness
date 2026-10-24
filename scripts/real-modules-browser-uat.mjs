import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID, randomBytes, randomInt, scryptSync } from 'node:crypto';
import { client, protect, local, save, stamp, safeFailure } from './db-safety.mjs';

const base = 'http://localhost:3000';
const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
async function main() {
  protect();
  const sql = client();
  const original = await sql.query('SELECT member_code,points,(SELECT count(*) FROM checkins c WHERE c.member_id=m.id) AS visits FROM members m ORDER BY id');
  const originalCoupons = await sql.query('SELECT id,member_id,status,used_count,total_quota FROM coupons ORDER BY id');
  const { chromium } = createRequire(path.join(local, 'role-browser/package.json'))('playwright');
  const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p => fs.existsSync(p));
  if (!executablePath) throw Error('Chrome unavailable');
  const output = path.join(local, 'real-modules-browser-' + stamp()); fs.mkdirSync(output);
  const accounts = [], results = [], errors = [];
  const add = (name, pass, detail = {}) => { results.push({ name, pass, ...detail }); console.log(JSON.stringify({ name, pass, ...detail })); };
  let browser;
  try {
    for (const role of ['OWNER', 'ADMIN', 'MEMBER']) {
      const id = (await sql.query("SELECT nextval(pg_get_serial_sequence('members','id'))::int AS id"))[0].id;
      const password = 'Uat!' + randomBytes(20).toString('hex');
      const salt = randomBytes(16).toString('hex');
      const hash = ['scrypt',32768,8,1,salt,scryptSync(password,salt,64,{N:32768,r:8,p:1,maxmem:67108864}).toString('hex')].join('$');
      const account = { id, role, phone: '09' + randomInt(10000000,100000000), password, code: 'BLU-' + id, marker: 'TEMP_REAL_MODULES_' + randomUUID() };
      accounts.push(account);
      save(path.join(output, 'recovery-' + role + '.json'), JSON.stringify({id,phone:account.phone,marker:account.marker,code:account.code}));
      await sql`INSERT INTO members(id,member_code,phone,full_name,password_hash,status,role) VALUES(${id},${account.code},${account.phone},${account.marker},${hash},'PENDING',${role}::member_role)`;
    }
    browser = await chromium.launch({ executablePath, headless: true });
    for (const a of accounts) {
      const context = await browser.newContext({viewport:{width:390,height:844}});
      await context.route('**/*', route => {
        const u = new URL(route.request().url());
        if (u.origin !== base || /\/api\/(test-services|.*provider-diagnostics|auth\/(request|verify|register|password))/.test(u.pathname)) return route.abort();
        return route.continue();
      });
      const login = await context.request.post(base + '/api/auth/login', { headers:{Origin:base}, data:{phone:a.phone,password:a.password},timeout:15000 });
      add(a.role + ' real password login', login.status() === 200, {status:login.status()});
      if (login.status() !== 200) continue;
      const gets = [['/api/member/wallet',200],['/api/member/profile',200],['/api/rewards/member',200],['/api/rewards/admin',a.role==='MEMBER'?403:200],['/api/admin/benefits/list',a.role==='MEMBER'?403:200],['/api/admin/finance/read',a.role==='OWNER'?200:403]];
      for (const [url, expected] of gets) {
        const r = await context.request.get(base + url,{timeout:15000});
        const body = await r.json().catch(()=>null);
        add(a.role + ' ' + url,r.status()===expected && body!==null,{status:r.status(),expected});
      }
      const pages = ['/member','/member/benefits','/member/rewards',...(a.role==='OWNER'?['/admin','/admin/members','/admin/members/'+a.code,'/admin/finance']:[]),...(a.role!=='MEMBER'?['/admin/checkin','/admin/rewards','/admin/coupons','/admin/promo-codes']:[])];
      const page = await context.newPage();
      page.on('pageerror',e=>errors.push({role:a.role,message:e.message.slice(0,180)}));
      for (const url of pages) {
        const r = await page.goto(base + url,{waitUntil:'networkidle',timeout:25000});
        const text = await page.locator('body').innerText();
        add(a.role+' page '+url,r?.status()===200&&!/Application error:|Internal Server Error|Mock •|ข้อมูลจำลองสำหรับระบบหลังบ้าน/.test(text),{status:r?.status()});
        await page.screenshot({path:path.join(output,a.role+'-'+url.replaceAll('/','_')+'.png'),fullPage:true});
      }
      const profile = await context.request.patch(base+'/api/member/profile',{headers:{Origin:base},data:{fullName:a.marker+' UPDATED',nickname:'DB UAT',gender:'OTHER',birthDay:1,birthMonth:1,emergencyName:'',emergencyPhone:'',emergencyRelation:''},timeout:15000});
      const persisted = (await sql`SELECT nickname,full_name FROM members WHERE id=${a.id}`)[0];
      add(a.role+' profile persists in DB',profile.status()===200&&persisted.nickname==='DB UAT'&&persisted.full_name===a.marker+' UPDATED',{status:profile.status()});
      const tamper = await context.request.patch(base+'/api/member/profile',{headers:{Origin:base},data:{phone:'0999999999',role:'OWNER'},timeout:10000});
      add(a.role+' profile rejects sensitive fields',tamper.status()===400,{status:tamper.status()});
      const csrf = await context.request.post(base+'/api/rewards/redeem',{headers:{Origin:'https://untrusted.invalid'},data:{rewardId:1,requestKey:randomUUID()},timeout:10000});
      add(a.role+' cross-origin mutation denied',csrf.status()===400||csrf.status()===403,{status:csrf.status()});
      await context.request.post(base+'/api/auth/logout',{headers:{Origin:base},timeout:10000});
      await context.close();
    }
    add('browser runtime errors zero',errors.length===0,{errors});
  } finally {
    await browser?.close();
    for (const a of accounts) {
      // Exact temporary identity, no shared fixture or real user sessions are touched.
      await sql.transaction([
        sql`DELETE FROM auth_login_limits WHERE phone=${a.phone}`,
        sql`DELETE FROM members WHERE id=${a.id} AND member_code=${a.code} AND full_name IN (${a.marker},${a.marker+' UPDATED'})`,
      ]);
    }
    const after = await sql.query('SELECT member_code,points,(SELECT count(*) FROM checkins c WHERE c.member_id=m.id) AS visits FROM members m ORDER BY id');
    const afterCoupons = await sql.query('SELECT id,member_id,status,used_count,total_quota FROM coupons ORDER BY id');
    add('original members points visits unchanged',canonical(original)===canonical(after));
    add('original coupons unchanged',canonical(originalCoupons)===canonical(afterCoupons));
    const report={passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,results,errors,limits:['Read pages/API and profile updates on disposable accounts only','No SMS, provider calls, fake PAID or reward/coupon grants','No physical USB, multi-connection stress or production build','Sequence values advance; temporary accounts removed']};
    save(path.join(output,'results.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify({passed:report.passed,failed:report.failed,artifacts:path.relative(process.cwd(),output)}));
    if(report.failed)process.exitCode=1;
  }
}
main().catch(safeFailure);

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { client, protect, local, save, stamp, safeFailure } from './db-safety.mjs';
import { backup } from './db-backup.mjs';
import { verify } from './db-verify-backup.mjs';

const BASE='http://localhost:3000';
const BENEFITS='blu_benefits_mock_v1', CATALOG='blu_reward_catalog_mock_v1', SERVICE='blu_admin_service_mock_v1';
const paths=['/admin/checkin','/admin/rewards','/admin/promo-codes','/admin/coupons'];
const canonical=v=>JSON.stringify(v && typeof v==='object' ? Array.isArray(v)?v.map(x=>JSON.parse(canonical(x))):Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(canonical(v[k]))])):v);
async function revoke(file) {
  const info=JSON.parse(fs.readFileSync(file,'utf8'));const sql=client();
  for(const a of info.accounts) {
    await sql`UPDATE auth_sessions SET revoked_at=clock_timestamp() WHERE member_id=${a.id} AND id>${info.maxSessionId} AND revoked_at IS NULL AND EXISTS(SELECT 1 FROM members WHERE id=${a.id} AND member_code=${a.memberCode} AND phone=${a.phone} AND password_hash=${a.hash} AND full_name=${info.marker+'_'+a.role} AND role=${a.role})`;
  }
}
async function watchdog() {
  const file=path.resolve(process.argv[3]||'');
  if(!file.startsWith(local+path.sep)||path.basename(file)!=='session-cleanup.json') throw Error('Invalid cleanup file');
  await new Promise(r=>setTimeout(r,180000));await revoke(file);
}
async function main() {
  protect();
  const sql=client();const fixtures=JSON.parse(fs.readFileSync(path.join(local,'role-uat-fixtures.json'),'utf8'));
  const staff=fixtures.accounts.find(a=>a.memberCode==='BLU-4'&&a.role==='ADMIN');const member=fixtures.accounts.find(a=>a.memberCode==='BLU-3'&&a.role==='MEMBER');
  if(!staff||!member) throw Error('Exact protected fixtures required');
  for(const a of [staff,member]) {
    const found=await sql`SELECT id FROM members WHERE id=${a.id} AND member_code=${a.memberCode} AND phone=${a.phone} AND password_hash=${a.hash} AND full_name=${fixtures.marker+'_'+a.role} AND role=${a.role}`;
    if(found.length!==1) throw Error('Fixture identity/role mismatch');
  }
  const require=createRequire(path.join(local,'role-browser/package.json'));const {chromium}=require('playwright');
  const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>fs.existsSync(p));
  if(!executablePath) throw Error('No system browser');
  const tables=(await sql.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(x=>x.tablename);
  const backupDir=await backup(sql,tables);await verify(backupDir,sql);
  const baseline=JSON.parse(fs.readFileSync(path.join(backupDir,'snapshot.json'),'utf8'));
  const output=path.join(local,'staff-mock-uat-'+stamp());fs.mkdirSync(output,{mode:0o700});
  const results=[],blocked=[],pageErrors=[];
  const [{id:maxSessionId}]=await sql`SELECT coalesce(max(id),0)::int AS id FROM auth_sessions`;
  const cleanupFile=path.join(output,'session-cleanup.json');
  save(cleanupFile,JSON.stringify({marker:fixtures.marker,maxSessionId,accounts:[staff,member].map(({password,...a})=>{void password;return a;})},null,2));
  const watcher=spawn(process.execPath,[import.meta.filename,'--watchdog',cleanupFile],{stdio:'ignore',detached:true,windowsHide:true});watcher.unref();
  const add=(id,refs,name,status,evidence={})=>{const row={id,refs,name,status,evidence};results.push(row);console.log(JSON.stringify(row));};
  let browser,context,page,memberContext;
    let observed={};
  const state=key=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key);
  const benefits=async()=>await state(BENEFITS);
  const shot=async name=>page.screenshot({path:path.join(output,name+'.png'),fullPage:true,timeout:8000});
  const goto=async route=>{const res=await page.goto(BASE+route,{waitUntil:'networkidle',timeout:20000});assert.equal(res.status(),200);assert.equal(new URL(page.url()).pathname,route);await page.locator('h1').waitFor();};
  const dialog=()=>page.getByRole('dialog');
  const row=code=>page.getByRole('row').filter({has:page.getByText(code,{exact:true})});
  const confirm=async()=>{
    const region=page.getByRole('region',{name:'ตรวจสอบก่อนยืนยัน'});const button=region.getByRole('button',{name:/^ยืนยัน/});
    assert.equal(await button.isDisabled(),true);await region.getByRole('checkbox').check();
    await page.keyboard.press('Enter');assert.equal(await region.count(),1);
    await button.click();await region.waitFor({state:'detached'});
  };
  async function test(id,refs,name,fn) {
    observed={};
        try {const evidence=await fn();add(id,refs,name,'PASS',evidence);}
    catch(error) {
      const evidence={...observed,type:error instanceof assert.AssertionError?'AssertionError':'UI action/timeout',diagnostic:error.message.split('\n')[0],dialogTitles:await page?.getByRole('dialog').locator('h2').allTextContents().catch(()=>[])??[],statuses:await page?.getByRole('status').allTextContents().catch(()=>[])??[]};
      add(id,refs,name,'FAIL',evidence);if(page)await shot(id+'-failure').catch(()=>{});
      if(page)await page.goto(BASE+'/admin/coupons',{waitUntil:'domcontentloaded',timeout:15000}).catch(()=>{});
    }
  }
  async function guard(c) {
    await c.route('**/*',route=>{
      const u=new URL(route.request().url());const method=route.request().method();
      if(u.origin===BASE && u.pathname.startsWith('/api/')) {
        const allowed= u.pathname==='/api/auth/me'&&method==='GET' || ['/api/auth/login','/api/auth/logout'].includes(u.pathname)&&method==='POST' || u.pathname==='/api/member/payment-account'&&method==='GET';
        if(!allowed){blocked.push({path:u.pathname,method});return route.abort('blockedbyclient');}
      }
      return route.continue();
    });
    c.on('page',p=>p.on('pageerror',()=>pageErrors.push({event:'uncaught pageerror',path:new URL(p.url()).pathname})));
  }
  async function login(a,c) {
    // APIRequestContext bypasses browser routing: only this hard-coded auth endpoint is used here.
    const r=await c.request.post(BASE+'/api/auth/login',{data:{phone:a.phone,password:a.password},headers:{Origin:BASE},timeout:15000});assert.equal(r.status(),200);
    const me=await (await c.request.get(BASE+'/api/auth/me',{timeout:15000})).json();assert.equal(me.member?.memberCode,a.memberCode);assert.equal(me.member?.role,a.role);
  }
  async function couponDraft(code,type='FREE',unit,benefit='BRING_FRIEND') {
    await page.getByRole('button',{name:'สร้างคูปอง',exact:true}).click();const d=dialog();
    await d.getByLabel('ชื่อคูปอง',{exact:true}).fill('UAT '+code);await d.getByLabel('รหัสคูปอง',{exact:true}).fill(code);
    await d.getByLabel('ประเภทคูปอง',{exact:false}).selectOption(type);
    if(benefit==='EXTRA_DAYS')await d.getByLabel('รูปแบบสิทธิ์',{exact:false}).selectOption(benefit);
    if(unit)await d.getByLabel('หน่วย',{exact:false}).selectOption(unit);
    return d;
  }
  async function saveCoupon(d){await d.getByRole('button',{name:'บันทึกคูปอง',exact:true}).click();await d.waitFor({state:'detached'});}
  async function grantPreview(code,all=false) {
    await row(code).getByRole('button',{name:'แจก',exact:true}).click();const d=dialog();
    if(all)await d.getByRole('radio',{name:/สมาชิกทั้งหมด/}).check();
    else {await d.getByPlaceholder('ค้นหาชื่อ / BLU-… / CARD-…').fill('BLU-1001');await d.locator('label').filter({hasText:'BLU-1001'}).getByRole('checkbox').check();}
    await d.getByRole('button',{name:'ตรวจสอบก่อนแจก',exact:true}).click();await page.getByRole('region',{name:'ตรวจสอบก่อนยืนยัน'}).waitFor();
  }
  try {
    browser=await chromium.launch({headless:true,executablePath,timeout:20000});
    context=await browser.newContext({viewport:{width:1440,height:1000}});await guard(context);await login(staff,context);
    page=await context.newPage();page.setDefaultTimeout(6000);await goto('/admin/coupons');
    await test('STAFF-01',['ROLE-05','UX-06'],'fresh context / real Staff session / four desktop menu items',async()=>{
      const keys=await page.evaluate(()=>Object.keys(localStorage));assert(!keys.some(k=>k==='blu_member'));
      const links=await page.locator('aside:visible nav a[href^="/admin"]').evaluateAll(es=>es.map(e=>e.getAttribute('href')));assert.deepEqual([...links].sort(),[...paths].sort());
      assert((await page.locator('body').innerText()).includes('Mock • เฉพาะเบราว์เซอร์นี้'));await shot('01-desktop-staff');return{menu:links,isolatedProfile:true};
    });
    for(const route of paths) await test('UX-1440-'+route.split('/').pop(),['UX-01','ROLE-05'],'1440px Staff navigation and primary control containment: '+route,async()=>{
      await goto(route);const links=await page.locator('aside:visible nav a[href^="/admin"]').evaluateAll(es=>es.map(e=>e.getAttribute('href')));assert.deepEqual([...links].sort(),[...paths].sort());
      const primary=page.getByRole('button',{name:route==='/admin/checkin'?'เปิด Auto Scan':route==='/admin/rewards'?'เพิ่มรางวัล':route==='/admin/promo-codes'?'สร้างแคมเปญ':'สร้างคูปอง',exact:true});await primary.scrollIntoViewIfNeeded();const box=await primary.boundingBox();const dimensions=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));observed={route,menu:links,...dimensions,primaryBox:box};await page.screenshot({path:path.join(output,'desktop-'+route.split('/').pop()+'.png'),fullPage:false});assert(box&&box.x>=0&&box.x+box.width<=1440);assert(dimensions.scroll<=1440);return observed;
    });
    await goto('/admin/coupons');
    if(!process.argv.includes('--desktop-only')) {
    await test('CP-01',['ROLE-05','BENEFIT-02'],'create all coupon type/unit mappings via UI',async()=>{
      const created=[];
      for(const [code,type,unit,benefit] of [['UAT-FREE','FREE','VISITS'],['UAT-GIFT','GIFT','ITEMS'],['UAT-OTHER','OTHER','VISITS'],['UAT-BAHT','DISCOUNT','BAHT'],['UAT-PERCENT','DISCOUNT','PERCENT'],['UAT-BONUS','BONUS_POINTS','POINTS'],['UAT-DAYS','FREE','DAYS','EXTRA_DAYS']]){
        const d=await couponDraft(code,type,unit,benefit);await saveCoupon(d);
        const saved=(await benefits()).definitions.find(x=>x.code===code);assert.equal(saved.unit,unit);assert.equal(saved.couponType,type);if(benefit)assert.equal(saved.benefit,benefit);created.push({code,type,unit});
      }
      await shot('02-coupon-types');return{created,extraDaysNotRedeemed:true,bonusPointsNotRedeemed:true};
    });
    await test('CP-02',['BENEFIT-02'],'changing type resets unit; invalid unit unavailable',async()=>{
      await row('UAT-DAYS').getByRole('button',{name:'แก้ไข',exact:true}).click();const d=dialog();
      await d.getByLabel('ประเภทคูปอง',{exact:false}).selectOption('BONUS_POINTS');assert.equal(await d.getByLabel('หน่วย',{exact:false}).inputValue(),'POINTS');
      assert.deepEqual(await d.getByLabel('หน่วย',{exact:false}).locator('option').evaluateAll(es=>es.map(e=>e.value)),['POINTS']);
      await d.getByLabel('ประเภทคูปอง',{exact:false}).selectOption('FREE');assert.equal(await d.getByLabel('หน่วย',{exact:false}).inputValue(),'VISITS');
      await d.getByRole('button',{name:'ยกเลิก',exact:true}).click();return{bonus:'POINTS',free:'VISITS',invalidUnitNotSelectable:true};
    });
    await test('CP-03',['BENEFIT-03'],'negative/zero amount, quota, age and excessive percent rejected without persistence',async()=>{
      const d=await couponDraft('UAT-INVALID','DISCOUNT','PERCENT');const before=JSON.stringify(await benefits());
      const checked=[];
      for(const [label,value,restore]of[['จำนวน','-1','1'],['จำนวน','0','1'],['จำนวน','101','1'],['โควต้ารวม','-1','100'],['จำนวนต่อคน','0','1'],['อายุคูปอง (วัน)','-1','30']]){
        const input=d.getByLabel(label,{exact:true});await input.fill(value);await d.getByRole('button',{name:'บันทึกคูปอง',exact:true}).click();assert.equal(await d.count(),1);assert.equal(await input.evaluate(e=>e.checkValidity()),false);assert.equal(JSON.stringify(await benefits()),before);await input.fill(restore);checked.push({label,value});
      }
      await d.getByRole('button',{name:'ยกเลิก',exact:true}).click();return{invalidValues:checked,notExhaustiveBoundaries:true};
    });
    await test('CP-04',['ROLE-05','BENEFIT-01'],'edit coupon / duplicate code rejected / disable and re-enable',async()=>{
      await row('UAT-FREE').getByRole('button',{name:'แก้ไข',exact:true}).click();let d=dialog();await d.getByLabel('รายละเอียด',{exact:true}).fill('UAT edited local-only');await saveCoupon(d);assert.equal((await benefits()).definitions.find(x=>x.code==='UAT-FREE').detail,'UAT edited local-only');
      const before=JSON.stringify(await benefits());d=await couponDraft('UAT-FREE');await saveCoupon(d);assert.equal(JSON.stringify(await benefits()),before);assert((await page.getByRole('status').allTextContents()).some(t=>t.includes('รหัสนิยามซ้ำ')));
      await row('UAT-FREE').getByRole('button',{name:'ปิดใช้งาน',exact:true}).click();await dialog().getByRole('button',{name:'ยืนยันปิดใช้งาน',exact:true}).click();await dialog().waitFor({state:'detached'});assert.equal((await benefits()).definitions.find(x=>x.code==='UAT-FREE').active,false);assert.equal(await row('UAT-FREE').getByRole('button',{name:'แจก',exact:true}).isDisabled(),true);
      await row('UAT-FREE').getByRole('button',{name:'เปิดใช้งาน',exact:true}).click();await dialog().getByRole('button',{name:'ยืนยันเปิดใช้งาน',exact:true}).click();await dialog().waitFor({state:'detached'});assert.equal((await benefits()).definitions.find(x=>x.code==='UAT-FREE').active,true);return{editPersisted:true,duplicateRejected:true,statusRoundTrip:true};
    });
    await test('CP-05',['ROLE-05','BENEFIT-04','UX-02','CHECK-07'],'selected BLU-1001 preview / Cancel no grant / explicit confirmation grants once',async()=>{
      const before=(await benefits()).grants.length;await grantPreview('UAT-FREE');assert.equal((await benefits()).grants.length,before);
      await page.getByRole('region',{name:'ตรวจสอบก่อนยืนยัน'}).getByRole('button',{name:'ยกเลิก',exact:true}).click();assert.equal((await benefits()).grants.length,before);
      await grantPreview('UAT-FREE');await confirm();const issued=(await benefits()).grants.filter(g=>g.definition.code==='UAT-FREE');assert.equal(issued.length,1);assert.equal(issued[0].memberCode,'BLU-1001');assert.equal(issued[0].status,'UNUSED');assert((await page.locator('body').innerText()).includes(issued[0].code));await shot('03-coupon-granted');return{before,after:(await benefits()).grants.length,code:issued[0].code,enterDidNotConfirm:true};
    });
    await test('CP-06',['BENEFIT-04'],'all recipients preview skips previously granted BLU-1001; Cancel remains nonmutating',async()=>{
      const before=JSON.stringify(await benefits());await grantPreview('UAT-FREE',true);const text=await page.getByRole('region',{name:'ตรวจสอบก่อนยืนยัน'}).innerText();assert.match(text,/ข้าม 1 คน/);assert.equal(JSON.stringify(await benefits()),before);await page.getByRole('region',{name:'ตรวจสอบก่อนยืนยัน'}).getByRole('button',{name:'ยกเลิก',exact:true}).click();assert.equal(JSON.stringify(await benefits()),before);return{skipCount:1,allRecipientsCommitNotTested:true};
    });
    await test('CP-07',['ROLE-05','BENEFIT-05','BENEFIT-06','BENEFIT-09','CHECK-07'],'coupon redeem requires consent / one consumption / replay after reload blocked',async()=>{
      const g=(await benefits()).grants.find(g=>g.definition.code==='UAT-FREE');assert(g);
      const scan=async()=>{await page.getByRole('button',{name:'สแกน / กรอกรหัสคูปอง',exact:true}).click();const input=dialog().getByRole('textbox',{name:/สแกนหรือกรอกรหัสคูปอง/});await input.fill(g.code);await input.press('Enter');};
      await scan();await page.getByRole('region',{name:'ตรวจสอบก่อนยืนยัน'}).waitFor();assert.equal((await benefits()).grants.find(x=>x.id===g.id).status,'UNUSED');await shot('04-coupon-confirm');await confirm();assert.equal((await benefits()).grants.find(x=>x.id===g.id).status,'USED');
      await goto('/admin/coupons');const before=JSON.stringify(await benefits());await scan();await page.getByRole('status').filter({hasText:'สิทธิ์นี้ใช้แล้ว ห้ามใช้ซ้ำ'}).waitFor();assert.equal(JSON.stringify(await benefits()),before);assert.equal(await page.getByRole('region',{name:'ตรวจสอบก่อนยืนยัน'}).count(),0);await dialog().getByRole('button',{name:'ปิดหน้าต่าง',exact:true}).click();return{redeemed:1,replayBlockedAfterReload:true,physicalEntryNotProven:true};
    });
    await goto('/admin/promo-codes');
    await test('PR-01',['ROLE-05','BENEFIT-01'],'create fixed/percent promo / edit / duplicate reject / disable',async()=>{
      for(const [code,type,amount] of [['UAT-FIXED','FIXED',25],['UAT-PCT','PERCENT',10]]){
        await page.getByRole('button',{name:'สร้างแคมเปญ',exact:true}).click();const d=dialog();await d.getByLabel('ชื่อแคมเปญ',{exact:true}).fill('UAT '+code);await d.getByLabel('รหัสนิยาม',{exact:true}).fill(code);await d.getByLabel('ประเภทส่วนลด',{exact:false}).selectOption(type);await d.getByLabel('มูลค่าส่วนลด',{exact:true}).fill(String(amount));await d.getByRole('button',{name:'บันทึกแคมเปญ',exact:true}).click();await d.waitFor({state:'detached'});assert.equal((await benefits()).definitions.find(x=>x.code===code).discountType,type);
      }
      await row('UAT-PCT').getByRole('button',{name:'แก้ไข',exact:true}).click();let d=dialog();await d.getByLabel('มูลค่าส่วนลด',{exact:true}).fill('15');await d.getByRole('button',{name:'บันทึกแคมเปญ',exact:true}).click();await d.waitFor({state:'detached'});assert.equal((await benefits()).definitions.find(x=>x.code==='UAT-PCT').amount,15);
      const before=JSON.stringify(await benefits());await page.getByRole('button',{name:'สร้างแคมเปญ',exact:true}).click();d=dialog();await d.getByLabel('ชื่อแคมเปญ',{exact:true}).fill('UAT duplicate');await d.getByLabel('รหัสนิยาม',{exact:true}).fill('UAT-FIXED');await d.getByRole('button',{name:'บันทึกแคมเปญ',exact:true}).click();await d.waitFor({state:'detached'});assert.equal(JSON.stringify(await benefits()),before);assert((await page.getByRole('status').allTextContents()).some(t=>t.includes('รหัสนิยามซ้ำ')));
      await row('UAT-PCT').getByRole('button',{name:'ปิดใช้งาน',exact:true}).click();await dialog().getByRole('button',{name:'ยืนยันปิดใช้งาน',exact:true}).click();await dialog().waitFor({state:'detached'});assert.equal((await benefits()).definitions.find(x=>x.code==='UAT-PCT').active,false);return{types:['FIXED','PERCENT'],percentEditedTo:15,duplicateRejected:true,disabled:true,noRealOrderApplied:true};
    });
    await test('PR-02',['ROLE-05','BENEFIT-04','BENEFIT-05'],'promo selected-recipient preview / cancel / confirm persists UNUSED code',async()=>{
      const before=(await benefits()).grants.length;
      const preview=async()=>{await row('UAT-FIXED').getByRole('button',{name:'แจกให้สมาชิก',exact:true}).click();const d=dialog();await d.getByPlaceholder('ค้นหาชื่อ / BLU-… / CARD-…').fill('BLU-1001');await d.locator('label').filter({hasText:'BLU-1001'}).getByRole('checkbox').check();await d.getByRole('button',{name:'ตรวจสอบจำนวนก่อนแจก',exact:true}).click();};
      await preview();assert.equal((await benefits()).grants.length,before);await page.getByRole('region',{name:'ตรวจสอบก่อนยืนยัน'}).getByRole('button',{name:'ยกเลิก',exact:true}).click();assert.equal((await benefits()).grants.length,before);await preview();await confirm();const grants=(await benefits()).grants.filter(g=>g.definition.code==='UAT-FIXED');assert.equal(grants.length,1);assert.equal(grants[0].status,'UNUSED');assert((await page.locator('body').innerText()).includes(grants[0].code));await shot('05-promo');return{newGrants:1,status:'UNUSED',noCheckoutOrPayment:true};
    });
    await goto('/admin/rewards');
    await test('RW-01',['ROLE-05','BENEFIT-01'],'reward catalog create / edit / deactivate / reactivate persisted',async()=>{
      await page.getByRole('button',{name:'เพิ่มรางวัล',exact:true}).click();const form=page.locator('#reward-catalog form');await form.getByLabel('ชื่อ',{exact:true}).fill('UAT local reward');await form.getByLabel('รูป (HTTPS URL)',{exact:true}).fill(BASE.replace('http:','https:')+'/logo.jpg');await form.getByLabel('แต้มที่ใช้',{exact:true}).fill('5');await form.getByLabel('สต็อกรวม',{exact:true}).fill('3');await form.getByRole('button',{name:'บันทึก',exact:true}).click();await form.waitFor({state:'detached'});
      let saved=(await state(CATALOG)).rewards.find(r=>r.title==='UAT local reward');assert(saved);const r=page.getByRole('row').filter({hasText:'UAT local reward'});await r.getByRole('button',{name:'แก้ไข',exact:true}).click();await form.getByLabel('แต้มที่ใช้',{exact:true}).fill('7');await form.getByRole('button',{name:'บันทึก',exact:true}).click();await form.waitFor({state:'detached'});
      for(const active of [false,true]){await r.getByRole('button',{name:active?'เปิดใช้งาน':'ปิดใช้งาน',exact:true}).click();await dialog().getByRole('button',{name:active?'ยืนยันเปิดใช้งาน':'ยืนยันปิดใช้งาน',exact:true}).click();await dialog().waitFor({state:'detached'});saved=(await state(CATALOG)).rewards.find(x=>x.id===saved.id);assert.equal(saved.isActive,active);}
      await goto('/admin/rewards');saved=(await state(CATALOG)).rewards.find(x=>x.id===saved.id);assert.equal(saved.pointCost,7);assert.equal(saved.stock,3);await shot('06-reward-catalog');return{pointCost:7,stock:3,active:true,noPointSpend:true};
    });
    await test('RW-02',['BENEFIT-11','ROLE-05'],'real DB Member sees same context catalog read-only without spending DB points',async()=>{
      // Log out Staff then log in Member in the same isolated context: mock catalog is not copied from any user profile.
      const out=await context.request.post(BASE+'/api/auth/logout',{headers:{Origin:BASE},timeout:15000});assert.equal(out.status(),200);await login(member,context);
      await goto('/member/rewards');await page.getByText('UAT local reward',{exact:true}).waitFor();const articles=page.locator('article');assert((await articles.count())>0);const buttons=articles.locator('button');const count=await buttons.count();assert(count>0);for(let i=0;i<count;i++){assert.equal(await buttons.nth(i).isDisabled(),true);assert.equal(await buttons.nth(i).innerText(),'ดูตัวอย่างเท่านั้น');}await shot('07-member-readonly');
      const logout=await context.request.post(BASE+'/api/auth/logout',{headers:{Origin:BASE},timeout:15000});assert.equal(logout.status(),200);await login(staff,context);return{catalogVisible:true,disabledButtons:count,redemptionNotSubmitted:true};
    });
    await goto('/admin/checkin');
    await test('CK-01',['ROLE-05','CHECK-01','CHECK-02','CHECK-08'],'manual seeded member check-in / rapid duplicate ignored / next scan checkout',async()=>{
      await page.getByRole('button',{name:'เปิด Auto Scan',exact:true}).click();const input=page.getByRole('textbox',{name:'ช่องรับรหัสเครื่องสแกนสมาชิก',exact:true});
      const before=await state(SERVICE);const count=before?.records.length??0;await input.fill('BLU-1001');await input.press('Enter');await page.getByRole('heading',{name:/เข้าใช้บริการสำเร็จ|ออกจากบริการสำเร็จ/}).waitFor();
      const first=await state(SERVICE);assert.equal(first.records.length,count+1);const firstType=first.records[0].serviceType;
      await input.fill('BLU-1001');await input.press('Enter');assert.equal((await state(SERVICE)).records.length,count+1);
      await page.waitForTimeout(3100);await input.fill('BLU-1001');await input.press('Enter');await page.waitForFunction(({key,n})=>JSON.parse(localStorage.getItem(key)).records.length===n,{key:SERVICE,n:count+2});const after=await state(SERVICE);assert.notEqual(after.records[0].serviceType,firstType);await shot('08-checkin');return{newRecords:2,firstType,secondType:after.records[0].serviceType,rapidDuplicateSuppressed:true,physicalScannerNotTested:true};
    });
    await test('CK-02',['CHECK-01','CHECK-03'],'unknown / expired / pending seed member scan does not create history',async()=>{
      const input=page.getByRole('textbox',{name:'ช่องรับรหัสเครื่องสแกนสมาชิก',exact:true});const before=JSON.stringify(await state(SERVICE));const tested=[];
      for(const [code,title] of [['BLU-999999','ไม่พบสมาชิก'],['BLU-1020','สมาชิกหมดอายุ'],['BLU-1025','สมาชิกยังไม่พร้อมเข้าใช้']]){await input.fill(code);await input.press('Enter');await page.getByRole('heading',{name:title,exact:true}).waitFor();assert.equal(JSON.stringify(await state(SERVICE)),before);tested.push({code,title});}return{tested,suspendedNotTested:true};
    });
    await page.setViewportSize({width:390,height:844});
    for(const route of paths) await test('UX-390-'+route.split('/').pop(),['UX-01','ROLE-05'],'390px four-item Staff menu and primary control containment: '+route,async()=>{
      await goto(route);await page.getByRole('button',{name:'Open menu',exact:true}).click();const links=await page.locator('aside:visible nav a[href^="/admin"]').evaluateAll(es=>es.map(e=>e.getAttribute('href')));assert.deepEqual([...links].sort(),[...paths].sort());await page.screenshot({path:path.join(output,'mobile-menu-'+route.split('/').pop()+'.png'),fullPage:false});await page.getByRole('button',{name:'Close menu',exact:true}).click();
      const dimensions=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));const primary=page.getByRole('button',{name:route==='/admin/checkin'?'เปิด Auto Scan':route==='/admin/rewards'?'เพิ่มรางวัล':route==='/admin/promo-codes'?'สร้างแคมเปญ':'สร้างคูปอง',exact:true});await primary.scrollIntoViewIfNeeded();const box=await primary.boundingBox();observed={route,menu:links,...dimensions,primaryBox:box,buttonWithinWidth:Boolean(box&&box.x>=0&&box.x+box.width<=390)};
      await page.screenshot({path:path.join(output,'mobile-'+route.split('/').pop()+'.png'),fullPage:false});assert(observed.buttonWithinWidth);assert(dimensions.scroll<=dimensions.width,'document horizontal overflow');return{...observed,viewport360NotTested:true};
    });
    }
    await test('SEC-01',['UX-06'],'no uncaught JS errors / no unsafe API attempted',async()=>{assert.equal(pageErrors.length,0);assert.equal(blocked.length,0);return{pageErrorCount:pageErrors.length,blockedUnsafeApiAttempts:blocked.length,browserApiAllowlist:true};});
    const mock=await page.evaluate(keys=>Object.fromEntries(keys.map(key=>[key,localStorage.getItem(key)])),[BENEFITS,CATALOG,SERVICE,'blu_member_account_mock_v1','blu_redemptions']);save(path.join(output,'context-mock-storage.json'),JSON.stringify(mock,null,2));
  } catch {
    add('RUN-FATAL',['ROLE-05'],'setup/navigation completed','FAIL',{error:'Details suppressed; inspect preceding cases and protected credentials locally'});
    if(page)await shot('fatal').catch(()=>{});
  } finally {
    let cleanupOK=false;
    try {await revoke(cleanupFile);cleanupOK=true;watcher.kill();}catch{add('SAFE-CLEANUP',['UX-06'],'new fixture session cleanup','FAIL',{watchdog:'will retry after 180 seconds'});}
    if(memberContext)await memberContext.close().catch(()=>{});if(browser)await browser.close().catch(()=>{});
    const safety=[];
    for(const [table,data]of Object.entries(baseline.tables)){
      if(!/^[a-z_]+$/.test(table))throw Error('Invalid baseline table');
      const original=JSON.parse(data.rows);const current=(await sql.query(`SELECT to_jsonb(t) AS row FROM public."${table}" t`)).map(x=>x.row);const set=new Set(current.map(canonical));const old=new Set(original.map(canonical));
      const limit=r=>table==='auth_login_limits'&&[staff.phone,member.phone].includes(r.phone);
      const preserved=original.filter(r=>!limit(r)).every(r=>set.has(canonical(r)));
      const extras=current.filter(r=>!old.has(canonical(r)));const onlyPermitted=extras.every(r=>limit(r)||table==='auth_sessions'&&[staff.id,member.id].includes(r.member_id)&&r.id>maxSessionId&&r.revoked_at!==null);
      safety.push({table,preserved,onlyPermitted,before:original.length,after:current.length});
    }
    add('SAFE-DB',['UX-06','BENEFIT-11','CHECK-08'],'all pre-existing DB rows unchanged; only own auth-session/login-limit changes',safety.every(x=>x.preserved&&x.onlyPermitted)&&cleanupOK?'PASS':'FAIL',{cleanupOK,tables:safety});
    const limitations=[
      'Every FINAL_TEST reference below is partial subcase coverage; do not mark the whole broad case PASS from this run.',
      'Only context-local mock changes. No DB coupons, checkins, points, roles, payments, SMS/OTP or orders submitted; baseline checked.',
      'No physical USB/camera/gate or cross-device real membership/access proof. Check-in input is keyboard/manual mock.',
      'No reward point redemption/handoff, concurrency, storage corruption/migration, real promo checkout, or own DB point spend tested.',
      'All-recipient grant only previewed/cancelled; selected recipient grant committed. Coupon redeem covers valid/used only, not expired/suspended.',
      'No copy or QR-display control exists in current CouponsAdmin/PromoCodesAdmin; persisted code text verified. Legacy BenefitsAdmin is not mounted on these routes.',
      '390px and 1440px only; 360px not tested. Horizontally scrollable tables permitted, document overflow and primary control containment asserted.',
    ];
    const report={at:new Date().toISOString(),mode:process.argv.includes('--desktop-only')?'desktop-read-only-supplement':'full-staff-mock',results,passed:results.filter(x=>x.status==='PASS').length,failed:results.filter(x=>x.status==='FAIL').length,limitations,blockedRequests:blocked,pageErrors,backup:path.relative(process.cwd(),backupDir),fixtures:[{memberCode:'BLU-3',role:'MEMBER'},{memberCode:'BLU-4',role:'ADMIN'}]};
    save(path.join(output,'results.json'),JSON.stringify(report,null,2));
    save(path.join(output,'report.md'),`# Staff context-local mock UI UAT\n\n${report.passed} subcases passed; ${report.failed} failed. These are not whole FINAL_TEST case completions.\n\n## Actual cases\n${results.map(x=>'- '+x.id+' ['+x.refs.join(', ')+'] '+x.status+': '+x.name).join('\n')}\n\n## Scope and limitations\n${limitations.map(x=>'- '+x).join('\n')}\n\nBackup: ${report.backup}. Credentials never included in artifacts/logs. Browser context was closed; no localStorage imported from user profile. See results.json for exact DB/table checks and screenshots for visual evidence.\n`);
    console.log(JSON.stringify({passed:report.passed,failed:report.failed,cleanupOK,artifacts:path.relative(process.cwd(),output)}));if(report.failed)process.exitCode=1;
  }
}
if(process.argv[2]==='--watchdog')watchdog().catch(safeFailure);else main().catch(safeFailure);

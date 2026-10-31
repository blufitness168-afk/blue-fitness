// All API responses synthetic/intercepted. No DB, credentials, real slips or provider calls.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(path.resolve('.local-db/role-browser/package.json'));
const {chromium,expect}=require('playwright/test');
const base=process.env.PAYMENT_UI_BASE||'http://localhost:3000',id='00000000-0000-4000-8000-00000000face';
const output=path.resolve('.local-db/currency-recovery-ui-'+Date.now());fs.mkdirSync(output,{recursive:true});
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
const scenarios=[...[360,390,1440].map(width=>({name:'success',width})),{name:'prepare-rejected',width:390},{name:'already-prepared',width:390},{name:'member-no-recovery',width:390}];
let browser;const results=[];const deadline=setTimeout(()=>{void browser?.close();},140000);
try{
 const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p=>fs.existsSync(p));assert(executablePath);
 browser=await chromium.launch({executablePath,headless:true});
 for(const scenario of scenarios){
  const context=await browser.newContext({viewport:{width:scenario.width,height:900},serviceWorkers:'block'});let page;const writes=[];let confirms=0;
  const result={...scenario,pass:false};
  const order={id,package:{id:6,name:'UAT daily',durationDays:1,timeSlot:'07:00-22:00',price:100},receiver:{promptpay:'0890000000',bankCode:'002',bankAccount:'1234567890',name:'UAT ONLY DO NOT PAY'},amountSatang:10000,subtotalSatang:10000,discountSatang:0,createdAt:new Date(Date.now()-7200000).toISOString(),expiresAt:new Date(Date.now()-6300000).toISOString(),uploadDeadline:new Date(Date.now()-4500000).toISOString(),status:'PENDING',rejectionReason:null,readiness:{transfersEnabled:true,blocker:null},pointsEarned:5,qrPayload:null,membershipExpiresAt:null};
  try{
   await context.route('**/*',async route=>{
    const req=route.request(),u=new URL(req.url());const json=(status,body)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
    if(u.origin!==base)return route.abort();
    if(u.pathname.startsWith('/api/')){
     if(req.method()==='GET'&&u.pathname==='/api/member/payment-account')return json(200,{pendingOrder:order,readiness:order.readiness,ownerRecheckAvailable:!['member-no-recovery','already-prepared'].includes(scenario.name),ownerRecheckPrepared:scenario.name==='already-prepared'});
     if(req.method()==='GET'&&u.pathname==='/api/packages')return json(200,{packages:[{...order.package,label:'รายวัน',description:'UAT',isActive:true,friendCoupons:0,bonusDays:0,version:1,catalogVersion:1}]});
          if(req.method()==='GET'&&u.pathname==='/api/auth/me')return json(200,{member:null});
     if(req.method()==='POST'&&u.pathname===`/api/admin/payments/${id}/recheck`){
      writes.push('prepare');assert.deepEqual(req.postDataJSON(),{confirmed:true,reason:'THB_NUMERIC_CURRENCY_FIX'});
      return json(scenario.name==='prepare-rejected'?409:200,scenario.name==='prepare-rejected'?{error:'UAT recovery refused'}:{prepared:true});
     }
     if(req.method()==='POST'&&u.pathname===`/api/payments/orders/${id}/verify`){
      writes.push('verify');assert.match(req.postDataBuffer().toString('latin1'),/name="reconcile"\r?\n\r?\ntrue/);assert.match(req.postDataBuffer().toString('latin1'),/uat-same-slip.png/);
      return json(200,{order:{...order,status:'PAID',membershipExpiresAt:new Date(Date.now()+86400000).toISOString()}});
     }
     throw Error('Unexpected API '+req.method()+' '+u.pathname);
    }
    if(!['GET','HEAD'].includes(req.method()))return route.abort();return route.continue();
   });
   page=await context.newPage();page.setDefaultTimeout(7000);page.on('dialog',async d=>{confirms++;await d.accept();});
   await page.goto(base,{waitUntil:'networkidle',timeout:20000});await page.getByRole('button',{name:/เลือก|Select/i}).first().click();
   const dialog=page.getByRole('dialog');await expect(dialog.getByText('UAT daily',{exact:true})).toBeVisible();
   const recovery=dialog.getByRole('button',{name:'OWNER: ตรวจสลิปเดิมอีกครั้งหลังแก้สกุลเงิน (1 ครั้ง)',exact:true});
   if(scenario.name==='member-no-recovery'){assert.equal(await recovery.count(),0);assert.deepEqual(writes,[]);}
   else{
    await dialog.locator('input[type=file]').setInputFiles({name:'uat-same-slip.png',mimeType:'image/png',buffer:png});
    if(scenario.name==='already-prepared'){
     assert.equal(await recovery.count(),0);await dialog.getByRole('button',{name:'ยังไม่ทราบผล: ยืนยันตรวจรูปเดิมซ้ำ (อาจใช้โควตาเพิ่ม)',exact:true}).click();
    }else{await expect(recovery).toBeEnabled();await recovery.click();}
    if(scenario.name==='prepare-rejected'){await expect(dialog.getByRole('alert')).toContainText('UAT recovery refused');assert.deepEqual(writes,['prepare']);}
    else{await expect(dialog.getByText('ชำระสำเร็จและบันทึกสมาชิกจริงแล้ว',{exact:true})).toBeVisible();assert.deepEqual(writes,scenario.name==='already-prepared'?['verify']:['prepare','verify']);}
    assert.equal(confirms,1);
   }
   result.pass=true;
  }catch(e){result.error=e.message;process.exitCode=1;}
  finally{result.writes=writes;result.confirms=confirms;if(page)await page.screenshot({path:path.join(output,scenario.name+'-'+scenario.width+'.png'),fullPage:true}).catch(()=>{});results.push(result);console.log(JSON.stringify(result));await context.close();}
 }
}finally{clearTimeout(deadline);await browser?.close();fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify({passed:results.filter(x=>x.pass).length,total:scenarios.length,output}));}

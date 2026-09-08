import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Usage: node browser-admin.mjs <cached-playwright-directory> <chromium-executable>
const require = createRequire(import.meta.url);
const { chromium } = require(path.resolve(process.argv[2]));
const artifacts = await mkdtemp(path.join(tmpdir(), 'blue-fitness-e2e-'));
const existing = process.argv[4];
const base = existing || 'http://localhost:3197';
const results = [], errors = [];
let server, browser, page, watchdog;
const pass = (name, evidence) => { results.push({ name, evidence }); console.log('PASS', name, JSON.stringify(evidence ?? '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
function killTree() {
  if (!server?.pid) return;
  if (process.platform === 'win32') {
    const killed = spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { timeout: 5000, encoding: 'utf8' });
    console.log('SERVER TREE CLEANUP', killed.status, killed.stdout, killed.stderr);
  } else { try { process.kill(-server.pid, 'SIGKILL'); } catch {} }
}
try {
  if (!existing) server = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', '--hostname', 'localhost', '--port', '3197'], {
    cwd: process.cwd(), detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
  });
  let logs = '';
  server?.stdout.on('data', b => { logs += b; });
  server?.stderr.on('data', b => { logs += b; });
  watchdog = setTimeout(() => { console.error('110s watchdog expired'); killTree(); process.exit(2); }, 110000);
  const start = Date.now();
  while (true) {
    if (server && server.exitCode !== null) throw new Error('Next exited: ' + logs);
    try { const r = await fetch(base + '/admin/promo-codes', { signal: AbortSignal.timeout(1500) }); if (r.ok) break; } catch {}
    if (Date.now() - start > 55000) throw new Error('Server startup timeout: ' + logs);
    await sleep(300);
  }
  browser = await chromium.launch({ executablePath: process.argv[3], headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  page = await context.newPage();
  page.setDefaultTimeout(7000);
  page.on('pageerror', e => errors.push(e.message));
  const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('blu_benefits_mock_v1')));
  const goto = async route => { const r = await page.goto(base + route); assert.equal(r.status(), 200, route); };
  const shot = name => page.screenshot({ path: path.join(artifacts, name + '.png'), fullPage: true });
  const confirm = async () => {
    const region = page.getByRole('region', { name: 'ตรวจสอบก่อนยืนยัน' });
    const button = region.getByRole('button', { name: /^ยืนยัน/ });
    assert.equal(await button.isEnabled(), false);
    await region.getByRole('checkbox').check();
    await page.keyboard.press('Enter');
    assert.equal(await region.count(), 1, 'Enter must not confirm');
    await button.click();
    await region.waitFor({ state: 'detached' });
  };
  const create = async (coupon, name, code, amount) => {
    await page.getByRole('button', { name: /^\+ สร้าง/ }).click();
    await page.getByLabel('ชื่อ', { exact: true }).fill(name);
    await page.getByLabel('รหัสนิยาม', { exact: false }).fill(code);
    if (coupon) await page.getByLabel('ประเภทคูปอง').selectOption('EXTRA_DAYS');
    await page.getByLabel(coupon ? 'จำนวนคน / วัน' : 'มูลค่าส่วนลด', { exact: true }).fill(String(amount));
    await page.getByRole('button', { name: 'บันทึกนิยาม', exact: true }).click();
    await page.getByLabel('ชื่อ', { exact: true }).waitFor({ state: 'detached' });
    const s = await state();
    await page.getByLabel('สิทธิ์ที่จะแจก').selectOption(s.definitions.find(d => d.code === code).id);
  };
  const selectedGrant = async () => {
    const input = page.getByRole('textbox', { name: /^สแกนสมาชิก/ });
    await input.fill('BLU-1001');
    await input.press('Enter');
    await input.evaluate(el => { window.__scannerNode = el; });
    const before = (await state()).grants.length;
    await page.getByRole('button', { name: 'ตรวจสอบรายชื่อและจำนวนก่อนแจก' }).click();
    assert.equal((await state()).grants.length, before);
    assert.equal(await input.evaluate(el => el === window.__scannerNode && el.isConnected && el.readOnly && el.getAttribute('aria-disabled') === 'true'), true);
    await confirm();
    assert.equal((await state()).grants.length, before + 1);
    assert.equal(await input.evaluate(el => el === window.__scannerNode && !el.readOnly), true);
  };
  await goto('/admin/promo-codes');
  assert.match(await page.locator('h1').innerText(), /โค้ดส่วนลด/);
  assert.equal(await page.getByRole('button', { name: 'แลกใช้คูปอง (แยกจากแจก)' }).count(), 0);
  await create(false, 'E2E Zero Payment', 'E2E-ZERO', 100000);
  await selectedGrant();
  pass('Selected promo grant requires explicit confirmation; scanner DOM survives pause');
  const promo = (await state()).grants[0];
  const row = page.getByRole('row').filter({ hasText: promo.memberCode }).filter({ hasText: 'E2E Zero Payment' });
  await row.getByRole('button', { name: 'แสดง QR / รหัส' }).click();
  const displayedCode = await row.locator('p').filter({ hasText: /^BLU-PC-/ }).innerText();
  assert.equal(displayedCode, promo.code);
  pass('Displayed grant code matches persisted storage', displayedCode);
  await page.getByRole('radio', { name: /ทุกคนปัจจุบัน/ }).check();
  const recipients = await page.locator('input[type=checkbox]:checked').count();
  await page.getByRole('button', { name: 'ตรวจสอบรายชื่อและจำนวนก่อนแจก' }).click();
  assert.equal((await state()).grants.length, 1);
  await confirm();
  const all = await state();
  assert.equal(all.grants.length, recipients);
  assert.equal(all.grants.filter(g => g.memberCode === 'BLU-1001').length, 1);
  assert.equal(all.batches[1].mode, 'ALL');
  pass('All recipients grant skips previously selected member', { recipients, grants: all.grants.length });
  await shot('01-promo-grants');
  await goto('/');
  assert.equal(await page.evaluate(() => localStorage.getItem('blu_member')), null);
  await page.locator('#packages button').filter({ hasText: /เลือก|Select/i }).first().click();
  const modal = page.locator('div.fixed.inset-0.z-50').filter({ hasText: 'โหมดทดลองเท่านั้น' });
  await modal.locator('input[type=text]').fill(displayedCode);
  await modal.locator('input[type=text]').press('Enter');
  assert.equal((await state()).grants.find(g => g.id === promo.id).status, 'UNUSED');
  await modal.getByRole('button', { name: 'ยืนยันซื้อแพ็กเกจทดลอง (0 บาท ไม่ต้องแนบสลิป)', exact: true }).click();
  await modal.getByText('บันทึกแพ็กเกจทดลองแล้ว', { exact: true }).waitFor();
  const purchased = await state();
  assert.equal(purchased.grants.filter(g => g.status === 'USED').length, 1);
  assert.equal(purchased.grants.find(g => g.id === promo.id).paidAmount, 0);
  assert.equal(purchased.memberships.length, 1);
  assert.equal(purchased.memberships[0].memberCode, 'BLU-1001');
  assert.ok(purchased.grants.find(g => g.id === promo.id).paymentId);
  pass('Home canonical package: zero-baht purchase, one consumption, default BLU-1001 membership', purchased.memberships[0]);
  await shot('02-payment-success');
  await modal.getByRole('button', { name: 'ดูบัตรสมาชิก', exact: true }).click();
  await page.waitForURL('**/member');
  await page.getByText(purchased.memberships[0].name, { exact: false }).first().waitFor();
  await shot('03-member-purchased');
  await goto('/member/benefits');
  await page.getByText(/^แพ็กเกจ mock:/).waitFor();
  assert.match(await page.locator('main').innerText(), /BLU-1001/);
  pass('Member card and benefits render stored membership');
  await goto('/admin/coupons');
  assert.match(await page.locator('h1').innerText(), /คูปอง/);
  assert.equal(await page.getByRole('row').filter({ hasText: 'E2E Zero Payment' }).count(), 0);
  await create(true, 'E2E Extra 7 Days', 'E2E-DAYS', 7);
  await selectedGrant();
  const coupon = (await state()).grants.find(g => g.definition.kind === 'COUPON');
  await page.getByRole('button', { name: 'แลกใช้คูปอง (แยกจากแจก)', exact: true }).click();
  const scanner = page.getByRole('textbox', { name: 'แลกใช้คูปองที่แจกแล้ว: BLU-CP-… เท่านั้น', exact: true });
  await scanner.evaluate(el => { window.__redeemNode = el; });
  await scanner.fill(coupon.code);
  await scanner.press('Enter');
  await page.getByRole('region', { name: 'ตรวจสอบก่อนยืนยัน' }).waitFor();
  assert.equal(await scanner.evaluate(el => el === window.__redeemNode && el.isConnected && el.readOnly), true);
  assert.equal((await state()).grants.find(g => g.id === coupon.id).status, 'UNUSED');
  await shot('04-coupon-paused');
  await confirm();
  const redeemed = await state();
  assert.equal(redeemed.grants.find(g => g.id === coupon.id).status, 'USED');
  assert.equal(Date.parse(redeemed.memberships[0].expiresAt) - Date.parse(purchased.memberships[0].expiresAt), 7 * 86400000);
  assert.equal(redeemed.memberships[0].totalDays - purchased.memberships[0].totalDays, 7);
  assert.equal(await scanner.evaluate(el => el === window.__redeemNode && !el.readOnly), true);
  pass('EXTRA_DAYS redemption atomically adds exactly seven days; scanner stays mounted', redeemed.memberships[0]);
  await goto('/admin/coupons');
  await page.getByRole('button', { name: 'แลกใช้คูปอง (แยกจากแจก)', exact: true }).click();
  await page.getByRole('textbox', { name: /^แลกใช้คูปองที่แจกแล้ว/ }).fill(coupon.code);
  await page.getByRole('textbox', { name: /^แลกใช้คูปองที่แจกแล้ว/ }).press('Enter');
  await page.getByText('สิทธิ์นี้ใช้แล้ว ห้ามใช้ซ้ำ', { exact: true }).waitFor();
  assert.deepEqual(await state(), redeemed);
  pass('Coupon replay rejected without storage mutation');
  await goto('/member/benefits');
  await page.getByText(/^แพ็กเกจ mock:/).waitFor();
  const expiry = new Date(redeemed.memberships[0].expiresAt).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
  assert.ok((await page.locator('main').innerText()).includes(expiry));
  await shot('05-wallet-extended');
  await goto('/member');
  await page.getByText(redeemed.memberships[0].name, { exact: false }).first().waitFor();
  await shot('06-member-extended');
  pass('Extended membership persists across wallet and member reload');
  assert.deepEqual(errors, [], 'Browser uncaught errors');
  await writeFile(path.join(artifacts, 'next.log'), logs);
} catch (error) {
  console.error('FAIL', error.stack);
  results.push({ failure: error.stack });
  process.exitCode = 1;
  if (page) await page.screenshot({ path: path.join(artifacts, 'failure.png'), fullPage: true, timeout: 3000 }).catch(() => {});
} finally {
  clearTimeout(watchdog);
  killTree();
  if (browser) await browser.close().catch(() => {});
  await writeFile(path.join(artifacts, 'results.json'), JSON.stringify({ results, errors }, null, 2));
  console.log('ARTIFACTS', artifacts);
}

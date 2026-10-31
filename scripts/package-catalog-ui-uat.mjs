// Run against a disposable copied Next runtime only. Its /catalog-uat/page.tsx must
// re-export @/app/admin/packages/PackageCatalogClient (no admin layout/SSR guard).
// This tests the real client, not authorization. Never create this route in src here.
// Controller owns runtime setup/teardown; this script owns no accounts or DB fixtures.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(path.join(root, '.local-db/role-browser/package.json'));
const { chromium, expect } = require('playwright/test');
const base = new URL(process.env.PACKAGE_UI_BASE || 'http://localhost:3001').origin;
assert(['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname), 'Disposable loopback runtime required');
const output = path.join(root, '.local-db', `package-catalog-ui-${Date.now()}`);
fs.mkdirSync(output, { recursive: true });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const seed = { id: 6, name: 'UAT catalog only', label: 'UAT 1 วัน', durationDays: 1,
  timeSlot: '07:00-14:00', price: 100, friendCoupons: 0, bonusDays: 0,
  description: 'Synthetic browser fixture', isActive: true, version: 7 };
const scenarios = [
  ...[360, 390, 1440].map(width => ({ name: 'save-storefront-order', width })),
  { name: 'conflict', width: 390 },
  { name: 'network-retry', width: 390 },
  { name: '503-retry', width: 390 },
  { name: 'reload-failure', width: 390 },
];
const results = [];
let browser;
const deadline = setTimeout(() => {
  process.exitCode = 1;
  console.error('Package catalog UI UAT exceeded 180s deadline');
  void browser?.close();
}, 180000);
// Hard stop also covers a stuck browser launch/close; controller has its own bound.
const hardStop = setTimeout(() => process.exit(1), 190000);

async function noOverflow(page) {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Horizontal page overflow');
}

try {
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  ].find(file => fs.existsSync(file));
  browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true, timeout: 20000 });
  for (const scenario of scenarios) {
    const context = await browser.newContext({ viewport: { width: scenario.width, height: 900 }, serviceWorkers: 'block' });
    const result = { ...scenario, pass: false };
    const writes = [], orders = [], unexpected = [];
    let item = { ...seed }, gets = 0, publicGets = 0, release;
    let page;
    try {
      await context.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url()), method = request.method();
        const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
        // Fail closed: no external resources/providers and no unhandled API reaches Next.
        if (url.origin !== base) return route.abort();
        if (!url.pathname.startsWith('/api/')) {
          if (!['GET', 'HEAD'].includes(method)) { unexpected.push(`${method} ${url.pathname}`); return route.abort(); }
          return route.continue();
        }
        if (url.pathname === '/api/admin/packages' && method === 'GET') {
          gets++;
          if (scenario.name === 'reload-failure' && writes.length) return json(503, { error: 'UAT reload unavailable' });
          return json(200, { data: { packages: [item] } });
        }
        if (url.pathname === '/api/admin/packages' && method === 'POST') {
          writes.push(request.postData());
          // Hold response until the browser proves controls and repeat submits are locked.
          await new Promise(resolve => { release = resolve; });
          if (scenario.name === 'conflict') return json(409, { error: 'VERSION_CONFLICT' });
          if (writes.length === 1 && scenario.name === 'network-retry') return route.abort('failed');
          if (writes.length === 1 && scenario.name === '503-retry') return json(503, { error: 'UAT unknown outcome' });
          const { requestKey, expectedVersion, ...changes } = request.postDataJSON();
          assert.match(requestKey, /^[0-9a-f-]{36}$/i);
          item = { ...changes, version: expectedVersion + 1 };
          return json(200, { data: { package: item } });
        }
        if (url.pathname === '/api/packages' && method === 'GET') {
          publicGets++;
          return json(200, { packages: [item] });
        }
        if (url.pathname === '/api/auth/me' && method === 'GET') return json(200, { member: null });
        if (url.pathname === '/api/member/payment-account' && method === 'GET') {
          return json(200, { pendingOrder: null, readiness: { transfersEnabled: true, blocker: null } });
        }
        if (url.pathname === '/api/payments/orders' && method === 'POST') {
          orders.push(request.postDataJSON());
          // Stop at create contract; deliberately no QR, payment, upload or provider.
          return json(409, { error: 'UAT intercepted order; no payment created' });
        }
        unexpected.push(`${method} ${url.pathname}`);
        return json(501, { error: 'Unexpected API blocked by UAT' });
      });
      page = await context.newPage();
      page.setDefaultTimeout(6000);
      page.setDefaultNavigationTimeout(25000);
      await page.goto(`${base}/catalog-uat`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: 'จัดการแพ็กเกจ', exact: true })).toBeVisible();
      await page.getByRole('button', { name: /#6 · เวอร์ชัน/ }).click();
      const price = page.getByLabel('ราคา (บาท)', { exact: true });
      await price.fill('1234.56');
      await page.getByLabel('ชื่อ', { exact: true }).fill('UAT updated catalog');
      await page.getByLabel('ป้ายชื่อ', { exact: true }).fill('UAT 37 วัน');
      await page.getByLabel('จำนวนวัน (1–3660)', { exact: true }).fill('37');
      await page.getByLabel('ช่วงเวลา', { exact: true }).selectOption('07:00-22:00');
      await noOverflow(page);
      const save = page.getByRole('button', { name: 'บันทึกการเปลี่ยนแปลง', exact: true });
      await save.click();
      await expect.poll(() => writes.length).toBe(1);
      await expect(price).toBeDisabled();
      await expect(save).toBeDisabled();
      await expect(page.getByRole('button', { name: /โหลดข้อมูลล่าสุด \/ ยกเลิก/ })).toBeDisabled();
      // Two real DOM click attempts cannot dispatch an extra request while disabled.
      await save.evaluate(button => { button.click(); button.click(); });
      assert.equal(writes.length, 1);
      const body = JSON.parse(writes[0]);
      assert.match(body.requestKey, uuid);
      assert.deepEqual(body, { requestKey: body.requestKey, id: 6, expectedVersion: 7,
        name: 'UAT updated catalog', label: 'UAT 37 วัน', durationDays: 37,
        timeSlot: '07:00-22:00', price: 1234.56, friendCoupons: 0, bonusDays: 0,
        description: seed.description, isActive: true });
      assert.equal(Math.round(body.price * 100), 123456);
      release(); release = null;
      if (scenario.name.endsWith('-retry')) {
        await expect(page.locator('p[role="status"]').first()).toContainText('ยังไม่ทราบผลการบันทึก');
        await expect(price).toBeDisabled();
        const retry = page.getByRole('button', { name: 'ลองคำขอเดิมซ้ำ', exact: true });
        await expect(retry).toBeEnabled();
        assert.equal(writes.length, 1, 'No automatic retry');
        await retry.click();
        await expect.poll(() => writes.length).toBe(2);
        assert.equal(writes[1], writes[0], 'Independent retry must preserve exact bytes and UUID');
        await expect(price).toBeDisabled();
        const confirming = page.getByRole('button', { name: 'กำลังยืนยันผล…', exact: true });
        await expect(confirming).toBeDisabled();
        await confirming.evaluate(button => { button.click(); button.click(); });
        assert.equal(writes.length, 2);
        release(); release = null;
      }
      if (scenario.name === 'conflict') {
        await expect(page.locator('p[role="status"]').first()).toContainText('เวอร์ชันขัดแย้ง');
        await expect(save).toBeDisabled();
        await page.waitForTimeout(350);
        assert.equal(writes.length, 1, '409 must never silently retry');
        assert.equal(gets, 1, 'Conflict requires explicit reload');
        await page.getByRole('button', { name: /โหลดข้อมูลล่าสุด \/ ยกเลิก/ }).click();
        await expect(page.locator('form')).toHaveCount(0);
        assert.equal(gets, 2);
      } else if (scenario.name === 'reload-failure') {
        await expect(page.locator('p[role="alert"]')).toContainText('โหลดแพ็กเกจไม่สำเร็จ');
        await expect(page.getByRole('button', { name: /#6 · เวอร์ชัน/ })).toBeDisabled();
        await expect(page.locator('p[role="status"]').first()).toContainText('ยังโหลดข้อมูลล่าสุดไม่ได้');
                await expect(page.locator('p[role="status"]').first()).not.toContainText('ใช้ข้อมูลล่าสุดจากเซิร์ฟเวอร์เท่านั้น');
      } else {
        await expect(page.locator('p[role="status"]').first()).toContainText('บันทึกสำเร็จ');
        await expect(page.getByRole('button', { name: /#6 · เวอร์ชัน 8/ })).toContainText('1,234.56 บาท · 37 วัน · 07:00-22:00');
        if (scenario.name === 'save-storefront-order') {
          await page.goto(base, { waitUntil: 'domcontentloaded' });
          const select = page.getByRole('button', { name: /เลือก|Select/i }).first();
          await expect(select).toBeVisible();
          assert(publicGets > 0, 'Homepage must load intercepted public catalog');
          const card = select.locator('..');
          await expect(card).toContainText(/UAT 37 วัน|37 Days Pass/);
          await expect(card).toContainText('07:00-22:00');
          await expect(card).toContainText('1,234.56');
          await noOverflow(page);
          await select.click();
          const dialog = page.getByRole('dialog');
          await expect(dialog).toContainText('UAT updated catalog');
          await dialog.getByLabel('โค้ดส่วนลด (ถ้ามี)').fill('UATONLY');
          await dialog.getByRole('button', { name: 'สร้างคำสั่งซื้อ / แสดงยอดจริง', exact: true }).click();
          await expect(dialog.getByRole('alert')).toContainText('UAT intercepted order');
          assert.equal(orders.length, 1);
          assert.match(orders[0].requestKey, uuid);
          assert.deepEqual(orders[0], { packageId: 6, catalogVersion: 8, promoCode: 'UATONLY', requestKey: orders[0].requestKey });
          await noOverflow(page);
        }
      }
      assert.deepEqual(unexpected, [], 'Every API must be explicitly intercepted');
      assert.equal(writes.length, scenario.name.endsWith('-retry') ? 2 : 1);
      result.pass = true;
    } catch (error) {
      result.error = error.stack || String(error);
      process.exitCode = 1;
    } finally {
      release?.();
      result.adminGets = gets;
      result.publicGets = publicGets;
      result.adminBodies = writes;
      result.orderBodies = orders;
      result.unexpectedApis = unexpected;
      if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, `${scenario.name}-${scenario.width}.png`), fullPage: true, timeout: 5000 }).catch(() => {});
      results.push(result);
      console.log(JSON.stringify(result));
      await context.close();
    }
  }
} finally {
  clearTimeout(deadline);
  await browser?.close();
  clearTimeout(hardStop);
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ passed: results.filter(result => result.pass).length, total: scenarios.length, output }));
}

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Browser-only fixtures: never import DB helpers or forward an API request.
const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(path.join(root, '.local-db/role-browser/package.json'));
const base = 'http://localhost:3000';
const id = '00000000-0000-4000-8000-00000000face';
const output = path.join(root, '.local-db', `payment-feedback-${Date.now()}`);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const scenarios = [
  { status: 422, role: 'alert', text: 'UAT ยอดโอนไม่ตรง' },
  { status: 202, role: 'status', text: 'UAT ยังรอการยืนยัน ห้ามโอนซ้ำ', pending: true },
  { status: 409, role: 'alert', text: 'UAT รายการขัดแย้ง ห้ามโอนซ้ำ' },
];
function fixture() {
  const now = Date.now();
  return {
    id, package: { id: 6, name: 'BLU 07:00-22:00 รายวัน', label: 'รายวัน', durationDays: 1, timeSlot: '07:00-22:00', price: 120, friendCoupons: 0, bonusDays: 0, description: 'UAT synthetic daily', isActive: true },
    receiver: { promptpay: '0000000000000', bankCode: '002', bankAccount: '0000000000', name: 'UAT SYNTHETIC ONLY — DO NOT PAY' },
    amountSatang: 12000, subtotalSatang: 12000, discountSatang: 0,
    createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 900000).toISOString(), uploadDeadline: new Date(now + 2700000).toISOString(),
    status: 'PENDING', paidAt: null, confirmedAt: null, rejectionReason: null,
    readiness: { transfersEnabled: true, blocker: null }, membershipExpiresAt: null, pointsEarned: 0,
    qrPayload: 'UAT-SYNTHETIC-NOT-A-PAYMENT-QR',
  };
}
const results = [];
let browser;
const deadline = setTimeout(() => { console.error('FAIL: 150s total runtime exceeded'); void browser?.close(); process.exit(1); }, 150000);
try {
  fs.mkdirSync(output, { recursive: true });
  const { chromium, expect } = require('playwright/test');
  const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p => fs.existsSync(p));
  assert.ok(executablePath, 'Real Google Chrome required (no Edge/Chromium fallback)');
  browser = await chromium.launch({ executablePath, headless: true, timeout: 15000 });
  console.log(JSON.stringify({ chrome: browser.version(), executablePath, output }));
  for (const width of [360, 390, 1440]) for (const scenario of scenarios) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
    const audit = []; let calls = 0; let accountReads = 0;
    const order = fixture();
    const result = { width, status: scenario.status, pass: false };
    let page;
    try {
      await context.route('**/*', async route => {
        const req = route.request(); const url = new URL(req.url()); const method = req.method();
        const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
        if (url.origin !== base) { audit.push({ blockedExternal: url.origin, method }); return route.abort('blockedbyclient'); }
        if (url.pathname.startsWith('/api/')) {
          audit.push({ method, path: url.pathname });
          if (method === 'GET' && url.pathname === '/api/member/payment-account') {
            accountReads++;
            return json(200, { memberCode: 'UAT-SYNTHETIC', status: 'EXPIRED', expiresAt: null, points: 0, package: null, purchases: [], readiness: order.readiness, pendingOrder: order });
          }
          if (method === 'POST' && url.pathname === `/api/payments/orders/${id}/verify` && !url.search) {
            calls++;
            return json(scenario.status, { error: scenario.text, order, ...(scenario.pending ? { pending: true } : {}) });
          }
          if (method === 'GET' && url.pathname === '/api/auth/me') return json(200, { member: null });
          return json(403, { error: 'UAT blocked API — no upstream request' });
        }
        if (!['GET', 'HEAD'].includes(method)) { audit.push({ deniedNonApiWrite: url.pathname, method }); return route.abort('blockedbyclient'); }
        return route.continue();
      });
      page = await context.newPage();
      page.setDefaultTimeout(8000);
      await page.goto(base, { waitUntil: 'networkidle', timeout: 20000 });
      // The first package selection is the daily card in the default all-day tab.
      await page.getByRole('button', { name: /เลือก|Select/i }).first().click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText(order.package.name, { exact: true })).toBeVisible();
      await dialog.locator('input[type=file]').setInputFiles({ name: 'uat-synthetic.png', mimeType: 'image/png', buffer: png });
      const panel = dialog.locator(':scope > div');
      await panel.evaluate(el => { el.scrollTop = el.scrollHeight; });
      const before = await panel.evaluate(el => ({ top: el.scrollTop, height: el.clientHeight, total: el.scrollHeight }));
      assert.ok(before.top > 0, 'Must scroll inside modal before verifying');
      const verify = dialog.getByRole('button', { name: 'ตรวจสลิปจริง / บันทึกผลเดิม', exact: true });
      await expect(verify).toBeEnabled();
      await verify.click();
      const feedback = dialog.getByRole(scenario.role).filter({ hasText: scenario.text });
      await expect(feedback).toHaveText(scenario.text);
      // toBeVisible alone does not detect clipping by an overflow ancestor.
      await expect.poll(async () => feedback.evaluate(el => {
        const panel = el.closest('[role=dialog]').firstElementChild;
        const r = el.getBoundingClientRect(), p = panel.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.top >= Math.max(0, p.top) && r.bottom <= Math.min(innerHeight, p.bottom) && r.left >= Math.max(0, p.left) && r.right <= Math.min(innerWidth, p.right);
      }), { timeout: 5000 }).toBe(true);
      await page.waitForTimeout(200);
      assert.equal(calls, 1, 'Exactly one intercepted verify POST');
      assert.ok(accountReads >= 1, 'Pending order read fixture used');
      assert.equal(audit.filter(x => x.method !== 'GET' && x.path?.startsWith('/api/') && x.path !== `/api/payments/orders/${id}/verify`).length, 0, 'Unexpected API writes attempted (blocked)');
      result.geometry = await feedback.evaluate(el => ({ feedback: el.getBoundingClientRect().toJSON(), scrollTop: el.closest('[role=dialog]').firstElementChild.scrollTop }));
      result.before = before; result.pass = true;
    } catch (error) { result.error = error.message; process.exitCode = 1; }
    finally {
      result.verifyCalls = calls; result.accountReads = accountReads; result.audit = audit;
      if (page) await page.screenshot({ path: path.join(output, `${width}-${scenario.status}.png`), timeout: 5000 }).catch(error => { result.screenshotError = error.message; });
      results.push(result); console.log(JSON.stringify(result));
      await context.close();
    }
  }
} catch (error) { console.error(error); process.exitCode = 1; }
finally {
  clearTimeout(deadline);
  await browser?.close();
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
  console.log(`RESULT ${results.filter(r => r.pass).length}/9 passed; artifacts: ${output}`);
}

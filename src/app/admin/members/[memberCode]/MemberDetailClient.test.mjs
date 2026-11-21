import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as jsxRuntime from 'react/jsx-runtime';
import ts from 'typescript';

const { outputText } = ts.transpileModule(readFileSync(new URL('./MemberDetailClient.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
});
const exports = {};
const imports = {
  'react/jsx-runtime': jsxRuntime,
  'next/link': ({ href, children }) => createElement('a', { href }, children),
  '@/lib/admin-members-server': { currentStatus: member => member.status },
  '../MemberRoleAction': () => null,
  './OnlineCancellationControls': () => createElement('button', { type: 'button' }, 'ตรวจเงื่อนไขยกเลิก'),
};
vm.runInNewContext(outputText, { exports, URLSearchParams, require: name => {
  assert.ok(Object.hasOwn(imports, name), `Unexpected import: ${name}`);
  return imports[name];
} });

const notice = /ต้องตรวจสอบก่อนยกเลิก/;
function render(callerRole, dataRole, orders, onlineCancellationEnabled = false, histories = {}) {
  const data = {
    callerRole: dataRole,
    member: { memberCode: 'BLU-7', role: 'MEMBER', status: 'ACTIVE', points: 0 },
    orders: { page: 1, rows: orders.map(order => {
      const status = typeof order === 'string' ? order : order.status;
      return {
        id: `fixture-${status}`, status, membershipStartsAt: null, paidAt: '2026-11-20T09:00:00Z',
        membershipExpiresAt: '2026-12-20T09:00:00Z', ...(typeof order === 'string' ? {} : order),
      };
    }) },
    checkins: { page: 1, rows: [] }, coupons: { page: 1, rows: [] }, ...histories,
  };
  return renderToStaticMarkup(createElement(exports.default, { data, callerRole, onlineCancellationEnabled }));
}

test('OWNER sees a read-only review notice on the online PAID row only', () => {
  const html = render('OWNER', 'OWNER', ['PAID', 'PENDING', 'CANCELLED', 'STAFF_TRANSFER']);
  const rows = html.match(/<tr\b[^>]*>.*?<\/tr>/g);
  const paid = rows.find(row => row.includes('fixture-PAID'));
  assert.match(paid, /<td[^>]*>PAID<p/);
  assert.match(paid, notice);
  assert.match(paid, /ไม่เพียงพอที่จะยืนยันที่มาของสิทธิ์/);
  assert.match(paid, /ห้ามคืนเงินก่อนยืนยันว่าเข้าเงื่อนไข/);
  assert.doesNotMatch(paid, /<(?:a|button|form|input)\b/);
  assert.equal(rows.filter(row => notice.test(row)).length, 1);
  assert.match(html, /โอนเงิน · เจ้าหน้าที่บันทึก/);
});

test('canceled staff transfer stays in history with its original start and owner-only amount', () => {
  const startsAt = '2026-12-01T09:00:00Z';
  const transfer = { status: 'STAFF_TRANSFER', membershipStartsAt: startsAt, amountSatang: 99000 };
  for (const role of ['ADMIN', 'OWNER']) {
    const html = render(role, role, [
      { ...transfer, id: 'staff-transfer:7', cancelledAt: '2026-11-22T09:00:00Z' },
      { ...transfer, id: 'staff-transfer:6', cancelledAt: null },
      'CANCELLED',
    ]);
    const rows = html.match(/<tr\b[^>]*>.*?<\/tr>/g);
    const canceled = rows.find(row => row.includes('staff-transfer:7'));
    assert.match(canceled, />โอนเงิน · เจ้าหน้าที่บันทึก · ยกเลิกแล้ว<\/td>/);
    assert.ok(canceled.includes(new Date(startsAt).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })));
    assert.doesNotMatch(canceled, notice);
    if (role === 'OWNER') assert.match(canceled, />990\.00 ฿<\/td>/);
    else assert.doesNotMatch(canceled, /฿/);
    assert.match(rows.find(row => row.includes('staff-transfer:6')), />โอนเงิน · เจ้าหน้าที่บันทึก<\/td>/);
    assert.match(rows.find(row => row.includes('fixture-CANCELLED')), />CANCELLED<\/td>/);
  }
});

test('online cancellation controls require an enabled OWNER view and are hidden for already canceled orders', () => {
  assert.match(render('OWNER', 'OWNER', ['PAID'], true), /ตรวจเงื่อนไขยกเลิก/);
  assert.doesNotMatch(render('ADMIN', 'ADMIN', ['PAID'], true), /ตรวจเงื่อนไขยกเลิก/);
  const canceled = render('OWNER', 'OWNER', [{ status: 'PAID', cancelledAt: '2026-11-22T09:00:00Z' }], true);
  assert.match(canceled, /PAID · ยกเลิกแล้ว/);
  assert.doesNotMatch(canceled, /ตรวจเงื่อนไขยกเลิก/);
});

test('member histories render recorded visit fields and Bangkok coupon use times without filling unknown legacy fields', () => {
  const timestamp = '2026-11-20T21:05:00Z';
  const html = render('ADMIN', 'ADMIN', [], false, {
    checkins: { page: 1, rows: [
      { scannerType: 'HARDWARE_USB', packageName: 'Historical package', usedTimeSlot: '15:00-21:00' },
      { scannerType: 'LEGACY', packageName: null, usedTimeSlot: null },
    ] },
    coupons: { page: 1, rows: [
      { title: 'Logged use', status: 'AVAILABLE', usedCount: 1, totalQuota: 3, lastRecordedUsedAt: timestamp },
      { title: 'Unknown use', status: 'USED', usedCount: 1, totalQuota: 1, lastRecordedUsedAt: null },
      { title: 'Unused', status: 'AVAILABLE', usedCount: 0, totalQuota: 1, lastRecordedUsedAt: null },
    ] },
  });
  const rows = html.match(/<tr\b[^>]*>.*?<\/tr>/g);
  assert.match(rows.find(row => row.includes('Historical package')), /15:00-21:00/);
  assert.equal(rows.find(row => row.includes('LEGACY')).match(/ไม่ทราบ/g).length, 2);
  assert.ok(rows.find(row => row.includes('Logged use')).includes(new Date(timestamp).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })));
  assert.match(rows.find(row => row.includes('Unknown use')), />ไม่ทราบ<\/td><\/tr>$/);
  assert.match(rows.find(row => row.includes('Unused')), />—<\/td><\/tr>$/);
});

test('online review stays hidden without OWNER agreement from page and history', () => {
  for (const [callerRole, dataRole] of [['ADMIN', 'ADMIN'], ['OWNER', 'ADMIN'], ['ADMIN', 'OWNER'], [undefined, 'OWNER']]) {
    const html = render(callerRole, dataRole, ['PAID']);
    assert.match(html, />PAID<\/td>/);
    assert.doesNotMatch(html, notice);
  }
});

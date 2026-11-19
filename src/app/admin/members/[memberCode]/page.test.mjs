import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const { outputText } = ts.transpileModule(readFileSync(new URL('./page.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
});

async function render({ callerRole = 'ADMIN', role = 'MEMBER', state, error } = {}) {
  const data = { callerRole, member: { memberCode: 'BLU-3', role } };
  const reads = [];
  const element = (type, props) => ({ type, props });
  const imports = {
    'react/jsx-runtime': { jsx: element, jsxs: element, Fragment: 'Fragment' },
    'next/navigation': { notFound: () => assert.fail('Member exists') },
    '@/lib/admin-permissions-server': { requireAdminPage: async () => ({ role: callerRole, memberCode: 'BLU-1' }) },
    '@/lib/admin-members-server': { getAdminMember: async () => data },
    '@/lib/member-contact-email-server': { getMemberContactEmail: async () => ({ version: 1 }) },
    '@/lib/admin-member-password-server': { isAdminPasswordResetEnabled: () => false },
    '@/lib/member-time-override-server': { getMemberTimeOverride: async code => {
      reads.push(code);
      if (error) throw error;
      return state;
    } },
    './StaffAvatarSection': { StaffAvatarSection: 'StaffAvatarSection' },
  };
  for (const name of ['MemberDetailClient', 'AdminMemberProfileForm', 'AdminMemberTimeOverrideForm',
    'AdminMemberPasswordForm', 'AdminMemberContactEmailForm', 'MemberCardSection']) {
    imports[`./${name}`] = name;
  }
  const exports = {};
  vm.runInNewContext(outputText, { exports, require: name => {
    assert.ok(name in imports, `Unexpected import: ${name}`);
    return imports[name];
  } });
  const page = await exports.default({ params: Promise.resolve({ memberCode: 'BLU-3' }), searchParams: Promise.resolve({}) });
  const children = page.props.children.filter(Boolean);
  return { reads, find: type => children.find(child => child.type === type) };
}

test('ADMIN and OWNER receive the server-loaded override state only for MEMBER targets', async () => {
  const state = { version: 2, entitlement: { orderId: '11111111-1111-4111-8111-111111111111',
    baseSlot: '07:00-14:00', overrideSlot: '08:00-15:00', expiresAt: '2027-01-02T05:04:03Z' } };
  for (const callerRole of ['ADMIN', 'OWNER']) {
    const { reads, find } = await render({ callerRole, state });
    assert.deepEqual(reads, ['BLU-3']);
    assert.equal(find('AdminMemberTimeOverrideForm').props.memberCode, 'BLU-3');
    assert.equal(find('AdminMemberTimeOverrideForm').props.state, state);
  }
  const { reads, find } = await render({ callerRole: 'OWNER', role: 'ADMIN' });
  assert.deepEqual(reads, []);
  assert.ok(find('AdminMemberProfileForm'));
  assert.equal(find('AdminMemberTimeOverrideForm'), undefined);
  assert.equal(find('p'), undefined);
});

test('missing override migration leaves member detail and profile intact without an editor', async () => {
  const error = Object.assign(new Error('r3_override_read is missing'), { code: '42883' });
  const { reads, find } = await render({ error });
  assert.deepEqual(reads, ['BLU-3']);
  assert.ok(find('MemberDetailClient'));
  assert.ok(find('AdminMemberProfileForm'));
  assert.equal(find('AdminMemberTimeOverrideForm'), undefined);
  assert.equal(find('p').props.role, 'status');
  assert.match(find('p').props.children, /ยังไม่พร้อมใช้งาน/);
});

test('a successful read without an entitlement is passed to the fragment, not treated as unavailable', async () => {
  const state = { version: 0, entitlement: null };
  const { find } = await render({ state });
  assert.equal(find('AdminMemberTimeOverrideForm').props.state, state);
  assert.equal(find('p'), undefined);
});

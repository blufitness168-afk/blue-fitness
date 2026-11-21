import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const { outputText } = ts.transpileModule(readFileSync(new URL('./page.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
});

async function render({ callerRole = 'ADMIN', dataRole = callerRole, role = 'MEMBER', status = 'ACTIVE', state, error,
  staffFreeEnabled = false, candidates = [], env = {} } = {}) {
  const data = { callerRole: dataRole, member: { memberCode: 'BLU-3', role, status } };
  const reads = [], cancellationReads = [];
  const element = (type, props) => ({ type, props });
  const imports = {
    'react/jsx-runtime': { jsx: element, jsxs: element, Fragment: 'Fragment' },
    'next/navigation': { notFound: () => assert.fail('Member exists') },
    './CouponRecipientLink': 'CouponRecipientLink',
    '@/lib/admin-permissions-server': { requireAdminPage: async () => ({ role: callerRole, memberCode: 'BLU-1' }) },
    '@/lib/online-cancellation-rollout-server': { onlineCancellationEnabled: () => env.ENABLE_ONLINE_CANCELLATION === 'true' && env.ENABLE_ONLINE_CANCELLATION_READS === 'true' },
    '@/lib/admin-members-server': { getAdminMember: async () => data },
    '@/lib/member-contact-email-server': { getMemberContactEmail: async () => ({ version: 1 }) },
    '@/lib/admin-member-password-server': { isAdminPasswordResetEnabled: () => false },
    '@/lib/member-time-override-server': { getMemberTimeOverride: async code => {
      reads.push(code);
      if (error) throw error;
      return state;
    } },
    './StaffAvatarSection': { StaffAvatarSection: 'StaffAvatarSection' },
    '@/lib/staff-free-server': { isStaffFreeEnabled: () => staffFreeEnabled },
    '@/lib/staff-paid-rollout-server': { staffPaidReadsEnabled: () => env.ENABLE_STAFF_PAID_READS === 'true' },
    '@/lib/staff-free-cancellation-server': { readStaffFreeCancellationCandidates: async code => {
      cancellationReads.push(code);
      return candidates;
    } },
    '@/lib/staff-free-display-server': { readStaffFreeTerms: async () => [] },
    '@/components/StaffFreeEntitlement': 'StaffFreeEntitlement',
  };
  for (const name of ['MemberDetailClient', 'AdminMemberProfileForm', 'AdminMemberTimeOverrideForm',
    'AdminMemberPasswordForm', 'AdminMemberContactEmailForm', 'MemberCardSection', 'StaffFreeSection', 'StaffFreeCancellationSection', 'StaffTransferSection']) {
    imports[`./${name}`] = name;
  }
  const exports = {};
  vm.runInNewContext(outputText, { exports, process: { env }, require: name => {
    assert.ok(name in imports, `Unexpected import: ${name}`);
    return imports[name];
  } });
  const page = await exports.default({ params: Promise.resolve({ memberCode: 'BLU-3' }), searchParams: Promise.resolve({}) });
  const children = Array.from(page.props.children).filter(Boolean);
  const sections = children.flatMap(child => child.type === 'div' && child.props.id ? [child.props.children] : [child]);
  const actions = children.find(child => child.type === 'MemberDetailClient').props.memberActions;
  return { reads, cancellationReads, find: type => sections.find(child => child.type === type),
    targets: children.filter(child => child.props.id), actions,
    links: actions ? Array.from(actions.props.children[0].props.children).filter(Boolean) : [],
    transferSections: sections.filter(child => child.type === 'StaffTransferSection').map(child => child.props) };
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

test('staff-free form is hidden by default and only enabled for matching staff roles viewing an ACTIVE MEMBER', async () => {
  assert.equal((await render()).find('StaffFreeSection'), undefined);
  for (const callerRole of ['ADMIN', 'OWNER']) {
    assert.equal((await render({ callerRole, staffFreeEnabled: true })).find('StaffFreeSection').props.memberCode, 'BLU-3');
  }
  assert.equal((await render({ callerRole: 'MEMBER', staffFreeEnabled: true })).find('StaffFreeSection'), undefined);
  assert.equal((await render({ callerRole: 'OWNER', role: 'ADMIN', staffFreeEnabled: true })).find('StaffFreeSection'), undefined);
  assert.equal((await render({ status: 'SUSPENDED', staffFreeEnabled: true })).find('StaffFreeSection'), undefined);
  assert.equal((await render({ dataRole: 'OWNER', staffFreeEnabled: true })).find('StaffFreeSection'), undefined);
});

test('member action links target the existing R4 forms and the R6 coupon page without sending member data in the URL', async () => {
  const transfer = { ENABLE_STAFF_PAID_READS: 'true', ENABLE_STAFF_PAID_TRANSFER: 'true' };
  for (const callerRole of ['ADMIN', 'OWNER']) {
    for (const [staffFreeEnabled, env, expected] of [
      [false, {}, []], [true, {}, ['#renew-free']], [false, transfer, ['#renew-transfer']],
      [false, { ENABLE_STAFF_PAID_TRANSFER: 'true' }, []], [false, { ENABLE_STAFF_PAID_READS: 'true' }, []],
      [true, transfer, ['#renew-free', '#renew-transfer']],
    ]) {
      const { links, targets, actions } = await render({ callerRole, staffFreeEnabled, env });
      assert.deepEqual(links.slice(0, -1).map(link => link.props.href), expected);
      assert.deepEqual(targets.map(target => '#' + target.props.id), expected);
      for (const target of targets) {
        const form = target.props.children;
        assert.equal(form.props.memberCode, 'BLU-3');
        if (target.props.id === 'renew-free') assert.equal(form.type, 'StaffFreeSection');
        else {
          assert.equal(form.type, 'StaffTransferSection');
          assert.equal(form.props.mode, 'transfer');
          assert.equal(form.props.canBackdate, callerRole === 'OWNER');
        }
      }
      assert.equal(links.at(-1).type, 'CouponRecipientLink');
      assert.deepEqual({ ...links.at(-1).props }, { memberCode: 'BLU-3' });
      assert.equal(actions.props.children[1].props.children[1].props.children, 'BLU-3');
    }
  }
  for (const options of [{ callerRole: 'MEMBER' }, { dataRole: 'OWNER' }, { role: 'ADMIN' }, { status: 'SUSPENDED' }, { status: 'PENDING' }]) {
    const { links, targets } = await render({ staffFreeEnabled: true, env: transfer, ...options });
    assert.deepEqual(links, []);
    assert.deepEqual(targets, []);
  }
});

test('cancellation lists only for OWNER with flag on and active MEMBER; a list is required to render controls', async () => {
  const candidates = [{ saleId: '11111111-1111-4111-8111-111111111111', packageName: 'Future',
    startsAt: '2027-01-01T00:00:00Z', endsAt: '2027-02-01T00:00:00Z' }];
  const enabled = { callerRole: 'OWNER', staffFreeEnabled: true };
  for (const opts of [{ staffFreeEnabled: false }, { callerRole: 'ADMIN' }, { role: 'OWNER' }, { status: 'SUSPENDED' }]) {
    const page = await render({ ...enabled, ...opts, candidates });
    assert.deepEqual(page.cancellationReads, []);
    assert.equal(page.find('StaffFreeCancellationSection'), undefined);
  }
  const empty = await render(enabled);
  assert.deepEqual(empty.cancellationReads, ['BLU-3']);
  assert.equal(empty.find('StaffFreeCancellationSection'), undefined);
  const page = await render({ ...enabled, candidates });
  assert.deepEqual(page.cancellationReads, ['BLU-3']);
  const section = page.find('StaffFreeCancellationSection');
  assert.equal(section.props.memberCode, 'BLU-3');
  assert.equal(section.props.candidates, candidates);
});

test('R4 transfer and cancellation use separate rollout gates and fail closed on role or target mismatch', async () => {
  const transfer = { ENABLE_STAFF_PAID_READS: 'true', ENABLE_STAFF_PAID_TRANSFER: 'true' };
  const cancellation = { ENABLE_STAFF_PAID_CANCELLATION: 'true' };
  const both = { ...transfer, ...cancellation };
  const owner = { callerRole: 'OWNER' };
  assert.deepEqual((await render(owner)).transferSections, []);
  assert.deepEqual((await render({ ...owner, env: { ENABLE_STAFF_PAID_TRANSFER: '1', ENABLE_STAFF_PAID_CANCELLATION: 'TRUE' } })).transferSections, []);
  for (const options of [{ callerRole: 'MEMBER' }, { role: 'ADMIN' }, { status: 'SUSPENDED' }, { dataRole: 'ADMIN' }]) {
    assert.deepEqual((await render({ ...owner, ...options, env: both })).transferSections, []);
  }
  const sections = async options => (await render(options)).transferSections.map(p => [p.mode, p.memberCode, p.canBackdate]);
  assert.deepEqual(await sections({ env: both }), [['transfer', 'BLU-3', false]]);
  assert.deepEqual(await sections({ ...owner, env: transfer }), [['transfer', 'BLU-3', true]]);
  assert.deepEqual(await sections({ ...owner, env: cancellation }), [['cancellation', 'BLU-3', undefined]]);
  assert.deepEqual(await sections({ ...owner, env: both }), [['transfer', 'BLU-3', true], ['cancellation', 'BLU-3', undefined]]);
});

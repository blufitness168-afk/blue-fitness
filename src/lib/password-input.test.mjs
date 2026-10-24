import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

function control() {
  const exports = {};
  const states = [];
  let cursor = 0;
  const React = {
    useId: () => 'password-field-test',
    useState(initial) {
      const i = cursor++;
      if (!(i in states)) states[i] = initial;
      return [states[i], next => { states[i] = typeof next === 'function' ? next(states[i]) : next; }];
    },
  };
  const source = ts.transpileModule(fs.readFileSync(new URL('../components/PasswordInput.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { exports, require: name => name === 'react' ? React : name === 'lucide-react' ? { Eye: () => null, EyeOff: () => null } : require(name) });
  return props => { cursor = 0; const tree = exports.default(props); const [input, button] = tree.props.children; return { input, button, tree }; };
}

test('password is hidden by default and toggle does not submit, change values or drop input constraints', () => {
  const render = control();
  const onChange = () => {};
  const props = { value: 'example-value-only', onChange, required: true, minLength: 10, maxLength: 128, autoComplete: 'new-password', name: 'password', className: 'test-input' };
  const hidden = render(props);
  assert.equal(hidden.input.props.type, 'password');
  assert.equal(hidden.button.props.type, 'button');
  assert.equal(hidden.button.props['aria-label'], 'แสดงรหัสผ่าน');
  assert.equal(hidden.button.props['aria-pressed'], false);
  hidden.button.props.onClick();
  const shown = render(props);
  assert.equal(shown.input.props.type, 'text');
  assert.equal(shown.button.props['aria-label'], 'ซ่อนรหัสผ่าน');
  assert.equal(shown.button.props['aria-pressed'], true);
  for (const key of ['value', 'onChange', 'required', 'minLength', 'maxLength', 'autoComplete', 'name']) assert.equal(shown.input.props[key], props[key]);
  assert.match(shown.input.props.className, /pr-12/);
  shown.button.props.onClick();
  assert.equal(render(props).input.props.type, 'password');
});

test('confirmation field has an independent toggle, accessible target and disabled state', () => {
  const first = control(), second = control();
  first({}).button.props.onClick();
  assert.equal(first({}).input.props.type, 'text');
  const confirm = second({ id: 'confirmation', visibilityLabel: 'รหัสผ่านยืนยัน', disabled: true });
  assert.equal(confirm.input.props.type, 'password');
  assert.equal(confirm.button.props['aria-label'], 'แสดงรหัสผ่านยืนยัน');
  assert.equal(confirm.button.props['aria-controls'], confirm.input.props.id);
  assert.equal(confirm.button.props.disabled, true);
  assert.equal(confirm.input.props.disabled, true);
});

test('all discovered password forms use the shared component, preserving validation and admin layout', () => {
  const paths = ['../app/member/login/page.tsx', '../app/member/register/page.tsx', '../app/admin/members/[memberCode]/MemberDetailClient.tsx'];
  for (const path of paths) {
    const source = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.ok(source.includes('@/components/PasswordInput'));
    assert.doesNotMatch(source, /<input\b[^>]*\btype="password"/);
  }
  const login = fs.readFileSync(new URL(paths[0], import.meta.url), 'utf8');
  assert.match(login, /PasswordInput key=\{`\$\{mode\}:\$\{Boolean\(ticket\)\}`\}/);
});

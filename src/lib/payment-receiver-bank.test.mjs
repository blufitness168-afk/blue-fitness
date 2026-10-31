// Actual migration chain in an isolated child process; no live DB or provider.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('receiver bank migration: old defect, exact rewrite/ACL, safe rerun, settlement/replay and SQL refusals', { timeout: 120000 }, () => {
 const result = spawnSync(process.execPath, [fileURLToPath(new URL('../../scripts/bangkok-receiver-uat.mjs', import.meta.url))], {
  cwd: fileURLToPath(new URL('../../', import.meta.url)),
  encoding: 'utf8',
  timeout: 110000,
  env: { ...process.env, DATABASE_URL: '', DIRECT_URL: '' },
 });
 assert.ifError(result.error);
 assert.equal(result.status, 0, result.stdout + result.stderr);
 assert.match(result.stdout, /DETECTED EXPECTED DEFECT/);
 assert.match(result.stdout, /PASS: all 9 actual migrations tested/);
 console.log(result.stdout.trim());
});

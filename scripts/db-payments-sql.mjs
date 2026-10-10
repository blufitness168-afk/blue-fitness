// Split PostgreSQL statements without splitting function bodies or quoted/commented text.
export function splitSql(text) {
  const out = []; let buffer = '', state = '', tag = '', depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (state === 'line') { if (c === '\n') { state = ''; buffer += '\n'; } continue; }
    if (state === 'block') {
      if (c === '/' && n === '*') { depth++; i++; }
      else if (c === '*' && n === '/') { if (--depth === 0) state = ''; i++; buffer += ' '; }
      continue;
    }
    if (state === 'dollar') { if (text.startsWith(tag, i)) { buffer += tag; i += tag.length - 1; state = ''; } else buffer += c; continue; }
    if (state === "'" || state === '"') {
      buffer += c;
      if (c === state) { if (n === state) { buffer += n; i++; } else state = ''; }
      else if (state === "'" && c === '\\') throw new Error('Backslash string syntax requires review');
      continue;
    }
    if (c === '-' && n === '-') { state = 'line'; i++; buffer += ' '; continue; }
    if (c === '/' && n === '*') { state = 'block'; depth = 1; i++; buffer += ' '; continue; }
    if (c === "'" || c === '"') { state = c; buffer += c; continue; }
    if (c === '$') { const match = text.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/); if (match) { tag = match[0]; state = 'dollar'; buffer += tag; i += tag.length - 1; continue; } }
    if (c === ';') { if (buffer.trim()) out.push(buffer.trim()); buffer = ''; } else buffer += c;
  }
  if (state && state !== 'line') throw new Error('Unterminated SQL');
  if (buffer.trim()) out.push(buffer.trim());
  return out;
}
export function incrementalPaymentStatements(text) {
  const parts = splitSql(text);
  if (parts.shift() !== 'BEGIN' || parts.pop() !== 'COMMIT') throw new Error('Expected transaction envelope');
  const names = ['normalize_payment_receiver_name', 'protect_package_payment_attempt', 'claim_package_payment_attempt', 'finalize_package_payment', 'prepare_owner_payment_recheck'];
  if (parts.length !== 12) throw new Error('Unexpected incremental shape');
  if (parts[0] !== 'ALTER TABLE package_payment_resolution_audit DROP CONSTRAINT package_payment_resolution_audit_action_check' || !/^ALTER TABLE package_payment_resolution_audit ADD CONSTRAINT package_payment_resolution_audit_action_check CHECK\(action IN \('AUTO_REJECT','OWNER_REJECT','OWNER_RECHECK'\)\)$/.test(parts[1])) throw new Error('Unexpected constraint change');
  for (let i = 0; i < names.length; i++) {
    const prefix = i === 4 ? 'CREATE FUNCTION ' : 'CREATE OR REPLACE FUNCTION ';
    if (!parts[i + 2].startsWith(prefix + names[i] + '(') || !parts[i + 2].includes('SET search_path=public,pg_temp')) throw new Error('Unexpected function change');
  }
  if (!parts.slice(7).every(s => /^REVOKE ALL ON FUNCTION [a-z_]+\([a-z,]*\) FROM PUBLIC$/.test(s))) throw new Error('Unexpected privilege statement');
  return parts;
}

export function migrationStatements(text) {
  const parts = splitSql(text);
  if (parts.shift() !== 'BEGIN' || parts.pop() !== 'COMMIT') throw new Error('Expected transaction envelope');
  for (const part of parts) {
    if (!/^(CREATE (TABLE|FUNCTION|TRIGGER|(?:UNIQUE )?INDEX)\b|INSERT INTO payment_transfer_refs\b)/i.test(part)) throw new Error('Non-additive top-level statement');
  }
  return parts;
}

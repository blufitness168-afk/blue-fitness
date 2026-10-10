import fs from 'node:fs';
import path from 'node:path';
import { client, protect, local, tables, quote, digest, save, stamp, safeFailure } from './db-safety.mjs';

export async function backup(sql = client(), selectedTables = tables) {
  protect();
  // Discovery does not capture data. The following transaction captures all data/DDL in one MVCC snapshot.
  const existing = await sql.query("SELECT tablename FROM pg_tables WHERE schemaname='public'");
  const selected = selectedTables.filter(t => existing.some(r => r.tablename === t));
    if (!selected.length || selected.some(t => !/^[a-z_][a-z_0-9]*$/.test(t))) throw new Error('Invalid backup selection');
  const names = selected.map(t => "'" + t + "'").join(',');
  const results = await sql.transaction([
    sql.query("SELECT current_database() AS database, transaction_timestamp() AS captured_at, pg_current_snapshot()::text AS snapshot"),
    sql.query(`SELECT c.relname AS table_name,a.attname AS column_name,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS not_null,pg_get_expr(d.adbin,d.adrelid) AS default_expr FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum WHERE n.nspname='public' AND c.relname IN (${names}) AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum`),
    sql.query(`SELECT c.relname AS table_name,k.conname,k.contype,pg_get_constraintdef(k.oid) AS definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN (${names}) ORDER BY k.contype,c.relname,k.conname`),
    sql.query(`SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename IN (${names}) ORDER BY tablename,indexname`),
    sql.query("SELECT t.typname,e.enumlabel FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace JOIN pg_enum e ON e.enumtypid=t.oid WHERE n.nspname='public' ORDER BY t.typname,e.enumsortorder"),
    sql.query(`SELECT sequencename,data_type,start_value,min_value,max_value,increment_by,cycle,cache_size,last_value FROM pg_sequences WHERE schemaname='public' AND sequencename IN (SELECT split_part(pg_get_serial_sequence('public.' || tablename,'id'),'.',2) FROM pg_tables WHERE schemaname='public' AND tablename IN (${names}) AND EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema='public' AND c.table_name=tablename AND c.column_name='id' AND c.data_type IN ('smallint','integer','bigint'))) ORDER BY sequencename`),
    ...selected.map(t => sql.query(`SELECT count(*)::text AS row_count,coalesce(json_agg(t ORDER BY to_jsonb(t)::text),'[]'::json)::text AS rows FROM public.${quote(t)} t`)),
  ], { isolationLevel: 'RepeatableRead', readOnly: true });
  const [identity, columns, constraints, indexes, enums, sequences, ...data] = results;
  const bundle = { version: 1, identity: identity[0], columns, constraints, indexes, enums, sequences, tables: Object.fromEntries(selected.map((t, i) => [t, data[i][0]])), sequenceCaveat: 'Sequence values are not MVCC transactional; restore uses at least captured last_value and restored max(id). Not a whole-database/PITR backup.' };
  const literal = v => "'" + String(v).replaceAll("'", "''") + "'";
  const ddl = ['-- Restore ONLY into an EMPTY isolated database; never run against the live database.', 'BEGIN;'];
  for (const name of [...new Set(enums.map(e => e.typname))]) ddl.push(`CREATE TYPE public.${quote(name)} AS ENUM (${enums.filter(e => e.typname === name).map(e => literal(e.enumlabel)).join(',')});`);
  for (const s of sequences) ddl.push(`CREATE SEQUENCE public.${quote(s.sequencename)} AS ${s.data_type} INCREMENT ${s.increment_by} MINVALUE ${s.min_value} MAXVALUE ${s.max_value} START ${s.start_value} CACHE ${s.cache_size} ${s.cycle ? 'CYCLE' : 'NO CYCLE'};`);
  for (const t of selected) ddl.push(`CREATE TABLE public.${quote(t)} (${columns.filter(c => c.table_name === t).map(c => `${quote(c.column_name)} ${c.type}${c.default_expr ? ' DEFAULT ' + c.default_expr : ''}${c.not_null ? ' NOT NULL' : ''}`).join(',')});`);
  for (const t of selected) ddl.push(`INSERT INTO public.${quote(t)} SELECT * FROM json_populate_recordset(NULL::public.${quote(t)}, ${literal(bundle.tables[t].rows)}::json);`);
  for (const c of constraints.filter(c => c.contype !== 'f')) ddl.push(`ALTER TABLE public.${quote(c.table_name)} ADD CONSTRAINT ${quote(c.conname)} ${c.definition};`);
  for (const c of constraints.filter(c => c.contype === 'f')) ddl.push(`ALTER TABLE public.${quote(c.table_name)} ADD CONSTRAINT ${quote(c.conname)} ${c.definition};`);
  for (const i of indexes.filter(i => !constraints.some(c => c.conname === i.indexname))) ddl.push(i.indexdef + ';');
  for (const s of sequences) {
    const t = selected.find(t => columns.some(c => c.table_name === t && c.column_name === 'id' && c.default_expr?.includes(s.sequencename)));
    if (t) {
      ddl.push(`ALTER SEQUENCE public.${quote(s.sequencename)} OWNED BY public.${quote(t)}.id;`);
      ddl.push(`SELECT setval(${literal('public.' + s.sequencename)}, GREATEST(${s.last_value ?? s.start_value}, coalesce((SELECT max(id) FROM public.${quote(t)}), ${s.start_value})), true);`);
    }
  }
  ddl.push('COMMIT;');
  const dir = path.join(local, 'backup-' + stamp());
  fs.mkdirSync(dir, { mode: 0o700 });
  const text = JSON.stringify(bundle, null, 2), restore = ddl.join('\n') + '\n';
  save(path.join(dir, 'snapshot.json'), text);
  save(path.join(dir, 'restore-empty.sql'), restore);
  const parsed = JSON.parse(fs.readFileSync(path.join(dir, 'snapshot.json'), 'utf8'));
  const counts = Object.fromEntries(selected.map(t => { const rows = JSON.parse(parsed.tables[t].rows); if (rows.length !== Number(parsed.tables[t].row_count)) throw new Error('Backup row count mismatch'); return [t, rows.length]; }));
  const manifest = { version: 1, capturedAt: bundle.identity.captured_at, databaseFingerprint: digest(bundle.identity.database), counts, files: { 'snapshot.json': digest(text), 'restore-empty.sql': digest(restore) }, verified: 'JSON parsing, per-table row counts, SHA256; actual restore not executed', limitations: 'Affected tables only; no external table data, roles/grants, triggers, RLS or extension definitions. Review before isolated restore. Sequence state is not MVCC.' };
  save(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify({ backup: path.relative(process.cwd(), dir), counts, verified: manifest.verified }));
  return dir;
}
if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) backup().catch(safeFailure);

// Explicit opt-in only. Creates two labelled UAT members, never a PAID order or SMS.
import fs from 'node:fs';
import path from 'node:path';
import { randomInt } from 'node:crypto';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QRCodeSVG } from 'qrcode.react';
import { client, protect, local, save, safeFailure } from './db-safety.mjs';
import { backup } from './db-backup.mjs';
import { verify } from './db-verify-backup.mjs';
const marker='UAT_KIOSK_20261024';
async function main() {
 if (process.argv.slice(2).some(a=>!['--apply','--preflight'].includes(a))) throw Error('Unknown argument');
 if (!process.argv.includes('--apply')) { console.log('PREPARE ONLY: 2 UAT members + welcome coupons, no DB connection. Apply kiosk migration after review, then --apply.'); return; }
 protect(); const sql=client(); const manifest=path.join(local,'kiosk-fixtures.json');
 if (fs.existsSync(manifest)) throw Error('Existing fixture manifest: inspect/reuse QRs; no automatic reset');
 if ((await sql`SELECT id FROM members WHERE full_name LIKE ${marker+'%'}`).length) throw Error('Unrecorded fixture: manual review required');
 const ready=await sql`SELECT to_regprocedure('public.kiosk_checkin(text,text,uuid,text)') AS ready`;
 if (!ready[0].ready) throw Error('Kiosk migration must be reviewed/applied first');
 const tables=(await sql.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(r=>r.tablename);
 const directory=await backup(sql,tables); await verify(directory,sql);
 const queries=[];
 for (const kind of ['WELCOME','EXPIRED']) {
  const phone='099'+String(randomInt(0,10000000)).padStart(7,'0');
  queries.push(sql`WITH allocated AS (SELECT nextval(pg_get_serial_sequence('members','id'))::integer AS id),
   inserted AS (INSERT INTO members(id,member_code,phone,full_name,status,role,expire_date)
    SELECT id,'BLU-'||id::text,${phone},${marker+'_'+kind},CASE WHEN ${kind}='WELCOME' THEN 'PENDING'::member_status ELSE 'EXPIRED'::member_status END,'MEMBER',CASE WHEN ${kind}='EXPIRED' THEN now()-interval '1 day' ELSE NULL END FROM allocated RETURNING id,member_code),
   coupon AS (INSERT INTO coupons(member_id,type,source,title,total_quota,used_count,expire_date,status)
    SELECT id,'FREE_ENTRY','WELCOME_REGISTRATION',${'UAT ONLY '+kind},1,0,CASE WHEN ${kind}='WELCOME' THEN now()+interval '1 day' ELSE now()-interval '1 day' END,'AVAILABLE' FROM inserted RETURNING id)
   SELECT member_code,${kind}::text AS kind FROM inserted`);
 }
 const results=await sql.transaction(queries,{isolationLevel:'Serializable'});
 const members=results.flat();
 save(manifest,JSON.stringify({marker,members,backup:directory},null,2));
 const output=path.join(local,'kiosk-qr'); fs.mkdirSync(output,{recursive:true});
 for (const member of members) {
  const svg=renderToStaticMarkup(React.createElement(QRCodeSVG,{value:member.member_code,size:320,marginSize:4,level:'M'}));
  fs.writeFileSync(path.join(output,member.kind+'.svg'),svg);
 }
 console.log(JSON.stringify({members,artifacts:'.local-db/kiosk-qr/WELCOME.svg and EXPIRED.svg',note:'WELCOME valid once, within business hours. Duplicate within 3 seconds bounces; later denied as used. No PAID order, password, points or SMS created.'}));
}
main().catch(safeFailure);

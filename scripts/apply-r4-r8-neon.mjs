import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@neondatabase/serverless';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not defined in .env.local');
  process.exit(1);
}

const files = [
  '20261118_R4_online_provenance.sql',
  '20261118_R5_finance.sql',
  '20261119_R4_staff_free_foundation.sql',
  '20261119_R4_staff_free_admission.sql',
  '20261119_R4_staff_free_finance.sql',
  '20261119_R4_staff_free_writer.sql',
  '20261120_R4_staff_free_display.sql',
  '20261120_R4_staff_free_z_cancellation.sql',
  '20261121_R4_staff_free_purchase_guard.sql',
  '20261122_R4_staff_paid_transfer.sql',
  '20261123_R4_staff_paid_cancellation.sql',
  '20261124_R4_online_settlement_evidence.sql',
  '20261125_R4_online_cancellation.sql',
  '20261202_R347_admission_compatibility.sql',
  '20261201_R7_manual_visits.sql',
  '20261203_R7_manual_staff_visits.sql',
  '20261126_R5_finance_import.sql',
  '20261127_R6_coupon_activation.sql',
  '20261128_R6_promo_scope.sql',
  '20261129_R6_staff_grant_targeting.sql',
  '20261201_R6_coupon_campaigns.sql',
  '20261203_R6_checkout_coupons.sql',
  '20261204_R5_finance_lifecycle.sql',
  '20261205_R36_current_term_targeting.sql',
  '20261206_R6_promo_definition_history.sql',
  '20261207_R8_reward_redemption_entitlement.sql',
];

async function main() {
  const client = new Client(process.env.DATABASE_URL);
  console.log('Connecting to Neon PostgreSQL...');
  await client.connect();
  console.log('Connected successfully.\n');

  const startTime = Date.now();
  let successCount = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const filePath = path.join('src/db/migrations', file);
    const rawSql = fs.readFileSync(filePath, 'utf8');
    const normalizedSql = rawSql.replaceAll('\r\n', '\n');

    process.stdout.write(`[${i + 1}/${files.length}] Applying ${file}... `);
    const fileStart = Date.now();
    try {
      await client.query(normalizedSql);
      const elapsed = Date.now() - fileStart;
      console.log(`OK (${elapsed}ms)`);
      successCount++;
    } catch (err) {
      console.log(`FAILED!`);
      console.error(`\nError applying ${file}:`);
      console.error(err);
      await client.end();
      process.exit(1);
    }
  }

  const totalElapsed = Date.now() - startTime;
  console.log(`\n🎉 All ${successCount}/${files.length} migrations applied successfully in ${totalElapsed}ms!\n`);

  // Verification checks
  console.log('--- Verifying Schema Objects ---');
  const checkQueries = [
    { name: 'r4_staff_private tables', sql: "SELECT tablename FROM pg_tables WHERE schemaname = 'r4_staff_private' ORDER BY tablename;" },
    { name: 'r4_online_private tables', sql: "SELECT tablename FROM pg_tables WHERE schemaname = 'r4_online_private' ORDER BY tablename;" },
    { name: 'r7 visits & supplement tables', sql: "SELECT tablename FROM pg_tables WHERE tablename IN ('r7_visits', 'time_supplement_grants', 'time_supplement_activations', 'r6_coupon_campaigns') ORDER BY tablename;" },
    { name: 'r7 / r4 functions', sql: "SELECT proname FROM pg_proc WHERE proname IN ('r7_kiosk_scan', 'r7_manual_visit', 'time_supplement_action', 'reward_redemption_package') ORDER BY proname;" },
    { name: 'scanner_type enum values', sql: "SELECT enumlabel FROM pg_enum WHERE enumtypid = 'scanner_type'::regtype ORDER BY enumsortorder;" },
  ];

  for (const q of checkQueries) {
    try {
      const res = await client.query(q.sql);
      console.log(`\n${q.name}:`, res.rows);
    } catch (err) {
      console.error(`Verification error for ${q.name}:`, err.message);
    }
  }

  await client.end();
  console.log('\nDB connection closed.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

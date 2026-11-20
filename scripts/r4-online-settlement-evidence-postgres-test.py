"""R4 online settlement evidence on disposable native PostgreSQL, synthetic only."""
from concurrent.futures import ThreadPoolExecutor
from importlib import import_module
import re
from time import monotonic, sleep

runner = import_module('r4-staff-free-display-postgres-test')
base = runner.base
MIGRATION = '20261124_R4_online_settlement_evidence'
FINALIZER = 'public.finalize_package_payment(uuid,integer,text,uuid)'
BEFORE = 'r4_online_private.settlement_before'
EFFECTS = 'r4_online_private.settlement_effects'


def exercise(root_query):
    source = (base.ROOT / 'src/lib/package-payment-benefits.test.mjs').read_text(encoding='utf-8')
    fixture = re.search(r'await db\.exec\(`([\s\S]*?)`\);', source)[1]
    seed = (base.ROOT / 'scripts/r4-staff-free-postgres-test.sql').read_text(encoding='utf-8')
    seed = seed.split('SELECT test_settle(3)', 1)[0]
    prepare = seed[seed.index('CREATE FUNCTION test_settle'):seed.index(' SELECT * INTO o FROM finalize_package_payment')]
    prepare = prepare.replace('test_settle(', 'test_prepare(').replace('RETURNS void', 'RETURNS uuid')
    staff = ('20261119_R4_staff_free_foundation', '20261119_R4_staff_free_admission',
             '20261119_R4_staff_free_finance', '20261119_R4_staff_free_writer', runner.DISPLAY,
             '20261120_R4_staff_free_z_cancellation', '20261121_R4_staff_free_purchase_guard',
             '20261122_R4_staff_paid_transfer', '20261123_R4_staff_paid_cancellation')
    for flavor, modules in (
        ('october_finance_staff', staff),
        ('r5_finance_staff', ('20261118_R5_finance', *staff)),
        ('r5_r6_r7', ('20261118_R5_finance', '20261118_R6_time_supplement', '20261118_R7_visits')),
    ):
        db = 'blu_modules_test_r4_evidence_' + flavor
        root_query('CREATE DATABASE ' + db)

        def query(sql, check=True):
            return root_query(sql, check=check, database=db)

        def scalar(sql):
            return query(sql).stdout.strip()

        def deny(sql, code, message):
            r = query(sql, check=False)
            # The bundled libpq client reports only SQLSTATE; psql also supplies the message.
            assert r.returncode and code in r.stderr and (message in r.stderr or r.stderr.strip() == f'SQLSTATE={code}'), (message, r.stderr)

        def apply(*names):
            for name in names:
                query((base.MIGRATIONS / (name + '.sql')).read_text(encoding='utf-8'))

        def finalize(mid, token=None):
            return f"SELECT f.status FROM test_attempts t, LATERAL finalize_package_payment(t.order_id,t.member_id,'{token or f'token-{mid}'}',t.id) f WHERE t.member_id={mid};"

        query(fixture)
        query('ALTER TABLE members ADD COLUMN avatar_changed boolean DEFAULT false;')
        apply(*base.BASE, '20261024_real_rewards')
        query(f'ALTER FUNCTION {FINALIZER} SET search_path TO public,pg_catalog;')
        apply(*base.CATALOG, '20261118_R2_member_cards', '20261118_R2_staff_avatar', *base.R3,
              '20261118_R4_online_provenance', *modules)
        if flavor != 'r5_r6_r7':
            # The full paid-cancellation upgrade must leave the free writer's guard valid.
            query('SELECT r4_staff_private.assert_free_purchase_guard();')
        query(seed + prepare + ''' RETURN a.id; END $$;
          SELECT test_settle(10,2);
          SELECT test_prepare(i,2) FROM generate_series(3,9) i WHERE i<>8;
          SELECT test_prepare(8,6);
          CREATE VIEW test_attempts AS SELECT o.member_id,a.order_id,a.id FROM package_payment_attempts a
          JOIN package_payment_orders o ON o.id=a.order_id;
          UPDATE members SET expire_date=now()-interval '7 days',status='ACTIVE' WHERE id=4;
          UPDATE members SET expire_date=now()+interval '7 days',status='ACTIVE' WHERE id=5;
          UPDATE members SET status='SUSPENDED' WHERE id=9;
          CREATE TABLE test_prior AS SELECT id,expire_date,status::text,points FROM members;
          CREATE FUNCTION test_state() RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_array(
            (SELECT jsonb_agg(m ORDER BY id) FROM members m), (SELECT jsonb_agg(p ORDER BY id) FROM package_payment_orders p),
            (SELECT jsonb_agg(a ORDER BY id) FROM package_payment_attempts a), (SELECT jsonb_agg(l ORDER BY order_id) FROM package_payment_point_ledger l),
            (SELECT jsonb_agg(r ORDER BY trans_ref) FROM payment_transfer_refs r), (SELECT jsonb_agg(c ORDER BY id) FROM coupons c),
            (SELECT jsonb_agg(e ORDER BY order_id) FROM entitlement_online_observations e)) $$;
        ''')
        role = 'r4_untrusted_' + flavor
        query(f'CREATE ROLE {role} NOLOGIN;')
        original = scalar('SELECT test_state()')
        rewrite = f"DO $$ BEGIN EXECUTE replace(pg_get_functiondef('{FINALIZER}'::regprocedure), 'confirmed := clock_timestamp();', 'confirmed := statement_timestamp();'); END $$;"
        migration = (base.MIGRATIONS / (MIGRATION + '.sql')).read_text(encoding='utf-8')
        for drift, msg in ((rewrite, 'finalizer definition'),
                           (f'GRANT EXECUTE ON FUNCTION {FINALIZER} TO PUBLIC;', 'finalizer definition'),
                           (f'GRANT EXECUTE ON FUNCTION {FINALIZER} TO {role};', 'finalizer definition'),
                           (f'ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO {role};', 'Unexpected grants'),
                           ('ALTER TABLE package_payment_orders DISABLE TRIGGER package_paid_benefits;', 'trigger stack')):
            deny('BEGIN;\n' + drift + '\n' + migration.removeprefix(migration.split('BEGIN;', 1)[0] + 'BEGIN;'), '0A000', msg)
            assert scalar("SELECT to_regnamespace('r4_online_private') IS NULL") == 't'
        before_acl = scalar(f"SELECT proowner,proacl,proconfig,prosecdef FROM pg_proc WHERE oid='{FINALIZER}'::regprocedure;")
        apply(MIGRATION)
        assert scalar(f"SELECT proowner,proacl,proconfig,prosecdef FROM pg_proc WHERE oid='{FINALIZER}'::regprocedure;") == before_acl
        assert scalar('SELECT test_state()') == original
        assert scalar(f'SELECT count(*) FROM {BEFORE}') == scalar(f'SELECT count(*) FROM {EFFECTS}') == '0'

        deny(f'SET ROLE {role}; SELECT * FROM {BEFORE}', '42501', 'permission denied')
        for table in (BEFORE, EFFECTS):
            for statement in (f'DELETE FROM {table}', f'UPDATE {table} SET order_id=order_id'):
                deny(statement, '55000', 'append-only')
        deny(f'TRUNCATE {BEFORE}, {EFFECTS}', '55000', 'append-only')
        deny(finalize(3, 'missing'), 'P0001', 'Unauthorized')
        for mid in (3, 4, 5):
            assert scalar(finalize(mid)) == 'PAID'
        after = scalar('SELECT test_state()')
        assert scalar(finalize(3)) == 'PAID'
        assert scalar('SELECT test_state()') == after
        assert scalar(f'''SELECT count(*) FROM {BEFORE} b JOIN {EFFECTS} e USING (order_id)
          JOIN test_prior p ON p.id=b.member_id JOIN package_payment_orders o ON o.id=b.order_id
          WHERE (b.expiry_before,b.status_before,b.points_before) IS NOT DISTINCT FROM (p.expire_date,p.status,p.points)
          AND e.expiry_after=greatest(e.confirmed_at,coalesce(b.expiry_before,e.confirmed_at))
              +(o.package_snapshot->>'durationDays')::integer*interval '24 hours'
          AND e.points_after=b.points_before+e.award_delta AND e.amount_satang=o.amount_satang
          AND e.issued_coupons=(SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'source',c.source,'type',c.type,
            'quota',c.total_quota,'bonusDays',c.bonus_days_value,'expiresAt',c.expire_date) ORDER BY c.source),'[]')
            FROM coupons c WHERE c.source LIKE 'PACKAGE_ORDER:'||o.id||':%')''') == '3'
        assert int(scalar(f'SELECT sum(jsonb_array_length(issued_coupons)) FROM {EFFECTS}')) > 0
        before_failure = scalar('SELECT test_state()')
        assert scalar('BEGIN;' + finalize(6) + 'ROLLBACK;') == 'PAID'
        assert scalar('SELECT test_state()') == before_failure
        deny('BEGIN; ALTER TABLE package_payment_orders DISABLE TRIGGER package_paid_benefits; ' + finalize(6),
             '55000', 'coupon issuance disagrees')
        deny('BEGIN; ALTER TABLE package_payment_orders DISABLE TRIGGER z_r4_online_settlement_effects; ' + finalize(6),
             '55000', 'evidence hook did not run')
        deny(f'''BEGIN; DO $$ BEGIN EXECUTE regexp_replace(pg_get_functiondef('{FINALIZER}'::regprocedure),
          ' INSERT INTO r4_online_private[.]settlement_before.*?IF NOT FOUND THEN RAISE EXCEPTION [^;]+; END IF;', '', 's'); END $$;
          ''' + finalize(6), '55000', 'lacks same-transaction verified pre-state')
        deny(f'''BEGIN; CREATE FUNCTION test_broken() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
          RAISE EXCEPTION 'injected evidence write failure' USING ERRCODE='22000'; END $$;
          CREATE TRIGGER test_broken BEFORE INSERT ON {EFFECTS} FOR EACH ROW EXECUTE FUNCTION test_broken();
          ''' + finalize(6), '22000', 'injected evidence write failure')
        assert scalar('SELECT test_state()') == before_failure
        assert scalar(f'SELECT count(*) FROM {BEFORE}') == scalar(f'SELECT count(*) FROM {EFFECTS}') == '3'
        assert scalar(finalize(9)) == 'REJECTED'
        assert scalar(f'SELECT count(*) FROM {BEFORE}') == '3'

        def wait_for(where, task):
            deadline = monotonic() + 8
            while scalar(f'SELECT EXISTS(SELECT FROM pg_stat_activity WHERE {where});') != 't':
                assert not task.done() and monotonic() < deadline
                sleep(.02)

        with ThreadPoolExecutor(max_workers=3) as pool:
            lock = pool.submit(query, "BEGIN; SET LOCAL application_name='r4-evidence-lock'; UPDATE members SET points=43 WHERE id=7; SELECT pg_sleep(4); COMMIT;")
            wait_for("application_name='r4-evidence-lock' AND wait_event='PgSleep'", lock)
            settlers = [pool.submit(query, f"SET application_name='r4-evidence-{i}'; " + finalize(7)) for i in range(2)]
            wait_for("application_name='r4-evidence-0' AND wait_event_type='Lock'", settlers[0])
            wait_for("application_name='r4-evidence-1' AND wait_event_type='Lock'", settlers[1])
            lock.result()
            assert [f.result().stdout.strip() for f in settlers] == ['PAID', 'PAID']
        assert scalar(f'SELECT points_before FROM {BEFORE} WHERE member_id=7') == '43'
        assert scalar(f'SELECT count(*) FROM {BEFORE}') == scalar(f'SELECT count(*) FROM {EFFECTS}') == '4'
        # Use the real admission writer, pinning only Bangkok slot evaluation.
        # The persisted checkin timestamp keeps its transaction-start default.
        query('''DO $$
          DECLARE definition text:=pg_get_functiondef('public.real_frontdesk_checkin(text,text,uuid,text)'::regprocedure);
                  anchor constant text:='local_time:=(t AT TIME ZONE ''Asia/Bangkok'')::time;';
          BEGIN
            IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Unknown front-desk slot clock'; END IF;
            EXECUTE replace(definition,anchor,$slot$local_time:=time '10:00';$slot$);
          END $$;''')
        with ThreadPoolExecutor(max_workers=2) as pool:
            settlement = pool.submit(query, '''BEGIN; SET LOCAL application_name='r4-before-scan-settlement';
              DO $$ BEGIN
                PERFORM 1 FROM members WHERE id=8 FOR UPDATE;
                LOOP
                  PERFORM pg_stat_clear_snapshot();
                  EXIT WHEN EXISTS (SELECT FROM pg_stat_activity WHERE application_name='r4-before-scan'
                    AND wait_event_type='Lock');
                  PERFORM pg_sleep(.02);
                END LOOP;
              END $$;
            ''' + finalize(8) + 'COMMIT;')
            wait_for("application_name='r4-before-scan-settlement' AND wait_event='PgSleep'", settlement)
            scan = pool.submit(scalar, "BEGIN; SET LOCAL application_name='r4-before-scan'; "
                               "SELECT real_frontdesk_checkin('token-1','r4-evidence-scan',gen_random_uuid(),'BLU-8')->>'reason'; COMMIT;")
            assert settlement.result().stdout.strip() == 'PAID'
            assert scan.result() == 'PAID_ENTRY'
        assert scalar(f'''SELECT count(*) FROM {BEFORE} b JOIN {EFFECTS} e USING (order_id)
          JOIN members m ON m.id=b.member_id JOIN checkins c ON c.member_id=m.id
          JOIN kiosk_member_bounce k ON k.member_id=m.id AND k.station=c.scanner_device_id
          WHERE m.id=8 AND b.expiry_before IS NULL AND e.issued_coupons='[]' AND e.promo_assignment_id IS NULL
          AND e.award_delta>0 AND (m.expire_date,m.status::text,m.points)=(e.expiry_after,e.status_after,e.points_after)
          AND c.checkin_time<e.confirmed_at AND k.accepted_at>e.confirmed_at''') == '1'
        assert scalar(f'''SELECT e.checkin_fingerprint <> r4_online_private.checkin_fingerprint(b.member_id)
          FROM {BEFORE} b JOIN {EFFECTS} e USING (order_id) WHERE b.member_id=8''') == 't'
        print(f'PASS {flavor}: evidence guards/settlement/rollback/lock/replay; fingerprint detects paid admission with an earlier timestamp', flush=True)


if __name__ == '__main__':
    runner.exercise = exercise
    runner.main()

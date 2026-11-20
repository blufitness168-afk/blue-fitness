"""R4 online cancellations: actual migrations on disposable native PostgreSQL."""
from concurrent.futures import ThreadPoolExecutor
from importlib import import_module
import json
import re
from time import monotonic, sleep
from uuid import uuid4

runner = import_module('r4-staff-free-display-postgres-test')
base = runner.base
schema = 'r4_online_private'


def exercise(root_query):
    source = (base.ROOT / 'src/lib/package-payment-benefits.test.mjs').read_text(encoding='utf-8')
    fixture = re.search(r'await db\.exec\(`([\s\S]*?)`\);', source)[1]
    seed = (base.ROOT / 'scripts/r4-staff-free-postgres-test.sql').read_text(encoding='utf-8').split('SELECT test_settle(3)', 1)[0]
    prepare = seed[seed.index('CREATE FUNCTION test_settle'):seed.index(' SELECT * INTO o FROM finalize_package_payment')]
    prepare = prepare.replace('test_settle(', 'test_prepare(').replace('RETURNS void', 'RETURNS uuid')
    for flavor, finance in (('october', ()), ('r5', ('20261118_R5_finance',))):
        db = 'blu_modules_test_r4_online_' + flavor
        root_query('CREATE DATABASE ' + db)

        def query(sql, check=True):
            return root_query(sql, check=check, database=db)

        def scalar(sql):
            return query(sql).stdout.strip()

        def deny(sql, code):
            r = query(sql, check=False)
            assert r.returncode and code in r.stderr, (sql, r.stdout, r.stderr)

        def apply(*names):
            for name in names:
                query((base.MIGRATIONS / (name + '.sql')).read_text(encoding='utf-8'))

        query(fixture)
        query('ALTER TABLE members ADD COLUMN avatar_changed boolean DEFAULT false;')
        apply(*base.BASE, '20261024_real_rewards')
        query('ALTER FUNCTION finalize_package_payment(uuid,integer,text,uuid) SET search_path TO public,pg_catalog;')
        apply(*base.CATALOG, '20261118_R2_member_cards', '20261118_R2_staff_avatar', *base.R3,
              '20261118_R4_online_provenance', *finance, '20261119_R4_staff_free_foundation',
              '20261119_R4_staff_free_admission', '20261119_R4_staff_free_finance', '20261119_R4_staff_free_writer',
              runner.DISPLAY, '20261120_R4_staff_free_z_cancellation', '20261121_R4_staff_free_purchase_guard',
              '20261122_R4_staff_paid_transfer', '20261123_R4_staff_paid_cancellation')
        query(seed + prepare + ''' RETURN a.id; END $$;
          INSERT INTO members(member_code,full_name,status,role,points)
          SELECT 'BLU-'||i,'Synthetic','EXPIRED','MEMBER',7 FROM generate_series(11,18) i;
          INSERT INTO auth_sessions(member_id,token_hash,expires_at)
          SELECT id,'token-'||id,now()+interval '1 day' FROM members WHERE id>=11;
          INSERT INTO auth_sessions(member_id,token_hash,expires_at,mode,device_id)
          VALUES (2,'owner-kiosk',now()+interval '1 day','KIOSK','desk'),(2,'owner-expired',now()-interval '1 day','NORMAL',NULL);
          INSERT INTO auth_sessions(member_id,token_hash,expires_at,revoked_at)
          VALUES (2,'owner-revoked',now()+interval '1 day',now());
          SELECT test_settle(10,6);
          UPDATE members SET expire_date=now()-interval '7 days',status='ACTIVE',points=42 WHERE id=4;
          UPDATE members SET expire_date=now()+interval '7 days',status='ACTIVE' WHERE id=5;
          UPDATE members SET status='PENDING' WHERE id=3;
          CREATE TABLE test_prior AS SELECT id,expire_date,status::text,points FROM members;
          CREATE TABLE test_supported_orders(mid integer PRIMARY KEY,id uuid,amount integer);
          CREATE FUNCTION test_sources() RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_array(
            (SELECT jsonb_agg(p ORDER BY id) FROM package_payment_orders p),
            (SELECT jsonb_agg(a ORDER BY id) FROM package_payment_attempts a),
            (SELECT jsonb_agg(l ORDER BY order_id) FROM package_payment_point_ledger l),
            (SELECT jsonb_agg(r ORDER BY trans_ref) FROM payment_transfer_refs r),
            (SELECT jsonb_agg(v ORDER BY order_id) FROM entitlement_online_observations v),
            (SELECT jsonb_agg(c ORDER BY id) FROM coupons c)) $$;
        ''')
        before_install = scalar('SELECT test_sources()')
        apply('20261124_R4_online_settlement_evidence', '20261125_R4_online_cancellation')
        assert scalar('SELECT test_sources()') == before_install
        query('''SELECT test_settle(i,CASE WHEN i=6 THEN 2 ELSE 6 END) FROM generate_series(3,18) i WHERE i<>10;
          INSERT INTO test_supported_orders SELECT member_id,id,amount_satang FROM package_payment_orders;
          CREATE ROLE r4_online_test_app_''' + flavor + ''' NOLOGIN;
          SELECT test_buy(7,6);
          UPDATE members SET points=0 WHERE id=9;
          INSERT INTO checkins(member_id,checkin_time,scanner_type,scanner_device_id,points_awarded,notes)
          SELECT member_id,confirmed_at-interval '1 second','WEB_CAMERA','synthetic',0,'prior timestamp but recorded later'
          FROM package_payment_orders WHERE member_id=8;
        ''')

        def cancel(mid, key=None, token='token-2', amount='x.amount', reason="'External refund'", confirmed='true'):
            key = key or uuid4()
            return (f"SELECT {schema}.cancel_online_order('{token}',x.id,'{key}',{amount},{reason},{confirmed}) "
                    f"FROM test_supported_orders x WHERE mid={mid};")

        def preview(mid):
            return json.loads(scalar(f"SELECT {schema}.preview_online_cancellation('token-2',id) FROM test_supported_orders WHERE mid={mid}"))

        assert preview(3)['blocker'] == 'READERS_NOT_ENABLED'
        deny(cancel(3), '55000')
        query(f'INSERT INTO {schema}.reader_cutover VALUES (1);')
        for token in ('token-1','token-3','missing','owner-kiosk','owner-expired','owner-revoked'):
            deny(cancel(3, token=token), '42501')
        deny('SET ROLE r4_online_test_app_' + flavor + ';' + cancel(3), '42501')
        deny('BEGIN ISOLATION LEVEL REPEATABLE READ;' + cancel(3), '0A000')
        for sql in ("CREATE TABLE public.r7_visits (id integer);",
                    "CREATE FUNCTION public.time_supplement_allows(integer,timestamptz) RETURNS boolean LANGUAGE sql AS 'SELECT true';",
                    'ALTER TABLE package_payment_orders DISABLE TRIGGER z_r4_online_settlement_effects;'):
            deny('BEGIN;' + sql + cancel(3), '0A000')
        deny(cancel(3, amount='x.amount-1'), '22023')
        deny(cancel(3, confirmed='false'), '22023')
        query('''INSERT INTO rewards(title,description,point_cost,stock,is_active) VALUES ('Synthetic','Synthetic',1,3,true);
          SELECT real_rewards_action('token-14','redeem',gen_random_uuid(),jsonb_build_object('rewardId',id)) FROM rewards;
          -- Simulate an otherwise exact aggregate after a proved point spend.
          UPDATE members m SET points=e.points_after,updated_at=e.confirmed_at FROM test_supported_orders x
           JOIN r4_online_private.settlement_effects e ON e.order_id=x.id WHERE x.mid=14 AND m.id=x.mid;
          SELECT r4_staff_private.record_free_sale('token-1',gen_random_uuid(),'BLU-15',
            r4_staff_private.preview_free_sale('token-1','BLU-15'),'Synthetic future term');
          SELECT r3_override_write('token-2',gen_random_uuid(),jsonb_build_object('memberCode','BLU-16',
            'expectedOrderId',id,'expectedVersion',0,'timeSlot','06:00-12:00','reason','Synthetic override'))
           FROM test_supported_orders WHERE mid=16;
          SELECT test_settle(17,6);
        ''')
        for mid in (5,6,7,8,9,10,14,15,16,17):
            assert preview(mid)['blocker'] == 'REVIEW_REQUIRED', mid
            deny(cancel(mid), '55000')
        assert preview(3)['eligible'] and preview(4)['eligible']
        assert scalar(f'SELECT count(*) FROM {schema}.cancellations') == '0'

        sources = scalar('SELECT test_sources()')
        key = uuid4()
        result = json.loads(scalar('BEGIN;' + cancel(3,key) + 'ROLLBACK;'))
        assert result['pointsReversed'] > 0
        assert scalar(f'SELECT count(*) FROM {schema}.cancellations') == '0'
        deny('''BEGIN; CREATE FUNCTION test_fail_restore() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
          RAISE EXCEPTION 'injected restore failure' USING ERRCODE='22000'; END $$;
          CREATE TRIGGER test_fail_restore BEFORE UPDATE ON members FOR EACH ROW EXECUTE FUNCTION test_fail_restore();
          ''' + cancel(3,key), '22000')
        assert scalar(f'SELECT count(*) FROM {schema}.cancellations') == '0'
        receipt = json.loads(scalar(cancel(3,key)))
        assert receipt == json.loads(scalar(cancel(3,key,reason="'  External refund  '")))
        deny(cancel(3,key,reason="'Different'"), '22023')
        deny(cancel(4,key), '22023')
        deny(cancel(3), '55000')
        for sql in (f'DELETE FROM {schema}.cancellations', f'UPDATE {schema}.cancellations SET reason=reason', f'TRUNCATE {schema}.cancellations'):
            deny(sql, '55000')
        assert json.loads(scalar(cancel(4)))['status'] == 'CANCELLED'
        assert scalar('SELECT test_sources()') == sources
        assert scalar('''SELECT count(*) FROM members m JOIN test_prior p USING(id) WHERE m.id IN (3,4)
          AND (m.expire_date,m.status::text,m.points) IS NOT DISTINCT FROM (p.expire_date,p.status,p.points)''') == '2'
        assert scalar(f'SELECT count(*) FROM {schema}.point_reversals WHERE delta<0 AND member_id IN (3,4)') == '2'
        assert scalar(f'SELECT count(*) FROM {schema}.active_paid_orders WHERE member_id IN (3,4)') == '0'
        assert preview(3)['blocker'] == 'ALREADY_CANCELLED'
        report = json.loads(scalar("SELECT real_finance_action('token-2','read',NULL,'{}')"))
        order = receipt['orderId']
        refunds = [e for e in report['records'] if e['id'] == f'online-refund:{order}']
        assert len(refunds) == 1 and refunds[0]['source'] == 'ONLINE_REFUND' and refunds[0]['type'] == 'EXPENSE'
        assert round(refunds[0]['amount'] * 100) == receipt['refundSatang']
        assert any(e['id'] == f'package:{order}' and e['type'] == 'INCOME' for e in report['records']), report['records']
        assert scalar("SELECT real_frontdesk_checkin('token-1','refund-test',gen_random_uuid(),'BLU-3')->>'reason'") == 'NO_ENTITLEMENT'
        assert scalar("SELECT f.status FROM test_supported_orders x JOIN package_payment_attempts a ON a.order_id=x.id, LATERAL finalize_package_payment(x.id,3,'token-3',a.id) f WHERE mid=3") == 'PAID'
        assert scalar('SELECT test_sources()') == sources
        query('SELECT test_settle(3,6);')
        assert scalar('SELECT count(*) FROM r3_override_current_order(3,clock_timestamp())') == '1'
        assert scalar(f'SELECT count(*) FROM {schema}.active_paid_orders WHERE member_id=3') == '1'
        assert json.loads(scalar(cancel(3,key))) == receipt

        def wait_for(where, task):
            deadline = monotonic() + 8
            while scalar(f'SELECT EXISTS(SELECT FROM pg_stat_activity WHERE {where})') != 't':
                assert not task.done() and monotonic() < deadline
                sleep(.02)

        with ThreadPoolExecutor(max_workers=3) as pool:
            # Same actor and key can run concurrently, but yields the identical receipt.
            request = cancel(11)
            one = pool.submit(scalar, request)
            two = pool.submit(scalar, request)
            assert json.loads(one.result()) == json.loads(two.result())
            # Different keys cannot duplicate a cancellation across connections.
            conflicts = [pool.submit(query, cancel(12), False) for _ in range(2)]
            outcomes = [f.result() for f in conflicts]
            assert sorted(bool(r.returncode) for r in outcomes) == [False, True]
            assert any('55000' in r.stderr for r in outcomes)
            # Real self-welcome shape: the coupon update and check-in are atomic,
            # but the writer has no explicit member lock. A held RowExclusiveLock
            # forces lock timeout rather than permission based on stale evidence.
            holder = pool.submit(query, '''BEGIN; SET LOCAL application_name='r4-welcome';
              INSERT INTO coupons(member_id,source,type,title,total_quota,used_count,bonus_days_value,expire_date,status)
                VALUES(13,'WELCOME_REGISTRATION','FREE_ENTRY','Welcome',1,0,0,now()+interval '1 day','AVAILABLE');
              WITH consumed AS (UPDATE coupons SET used_count=1,status='USED' WHERE member_id=13 AND source='WELCOME_REGISTRATION'
                RETURNING member_id) INSERT INTO checkins(member_id,scanner_type,scanner_device_id,points_awarded,notes)
                SELECT member_id,'WEB_CAMERA','MEMBER_COUPON_SELF_SERVICE',0,'WELCOME_REGISTRATION' FROM consumed;
              SELECT pg_sleep(3); COMMIT;''')
            wait_for("application_name='r4-welcome' AND wait_event='PgSleep'", holder)
            deny(cancel(13), '55P03')
            holder.result()
            deny(cancel(13), '55000')
            # Production checkins has a member FK; model its KEY SHARE acquisition
            # after taking RowExclusiveLock. The cancelling connection detects the
            # resulting cycle first, and must not proceed with an unlocked check.
            holder = pool.submit(query, '''BEGIN;
              SET LOCAL application_name='r4-welcome-deadlock';
              SET LOCAL statement_timeout='5s'; SET LOCAL deadlock_timeout='2s';
              LOCK TABLE checkins IN ROW EXCLUSIVE MODE;
              DO $$ BEGIN LOOP
                PERFORM pg_stat_clear_snapshot();
                EXIT WHEN EXISTS (SELECT FROM pg_stat_activity WHERE application_name='r4-cancel-deadlock'
                  AND wait_event_type='Lock' AND wait_event='relation');
                PERFORM pg_sleep(.02);
              END LOOP; END $$;
              SELECT id FROM members WHERE id=18 FOR KEY SHARE;
              INSERT INTO checkins(member_id,scanner_type,scanner_device_id,points_awarded,notes)
                VALUES(18,'WEB_CAMERA','MEMBER_COUPON_SELF_SERVICE',0,'Synthetic competing visit');
              COMMIT;''')
            wait_for("application_name='r4-welcome-deadlock' AND wait_event='PgSleep'", holder)
            deny("SET application_name='r4-cancel-deadlock'; SET deadlock_timeout='150ms';" + cancel(18), '40P01')
            holder.result()
            deny(cancel(18), '55000')
        assert scalar(f'SELECT count(*) FROM {schema}.cancellations WHERE member_id IN (13,18)') == '0'
        print(f'PASS {flavor}: online cancellation, reader gate, auth, exact restoration, refund/wallet, rollback, replay, repurchase and check-in contention', flush=True)


if __name__ == '__main__':
    runner.exercise = exercise
    runner.main()

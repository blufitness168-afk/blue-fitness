"""R6 promo scope on a disposable native SCRAM loopback cluster; no app credentials."""
from concurrent.futures import ThreadPoolExecutor
from importlib import import_module
import json
import re
from threading import Barrier
from uuid import uuid4

runner = import_module('r4-staff-free-display-postgres-test')
base = runner.base


def exercise(runner_query):
    def scalar(sql):
        return query(sql).stdout.strip()

    def denied(sql, code):
        failure = query(sql, check=False)
        assert failure.returncode and code in failure.stderr, (failure.stdout, failure.stderr)

    def denied_message(sql, message):
        # The portable libpq client emits SQLSTATE only; assert messages in the database.
        query(f"""DO $test$ BEGIN
          EXECUTE $cmd${sql}$cmd$;
          RAISE EXCEPTION 'Unexpected success' USING ERRCODE='XX000';
        EXCEPTION WHEN OTHERS THEN
          IF position('{message}' in SQLERRM)=0 THEN RAISE; END IF;
        END $test$;""")

    def apply(*names):
        for name in names:
            query((base.MIGRATIONS / (name + '.sql')).read_text(encoding='utf-8'))

    def j(value):
        return f'$p${json.dumps(value)}$p$::jsonb'

    def admin(action, value, key=None):
        return f"SELECT real_benefits_admin_action('token-1','{action}','{key or uuid4()}',{j(value)});"

    def create(value, key=None, actor=1):
        return f"SELECT r6_create_scoped_promo('token-{actor}','{key or uuid4()}',{j(value)});"

    receiver = j(dict(promptpay='0890000000', bankCode='002', bankAccount='1234567890', name='SYNTHETIC UAT'))
    promo = dict(kind='PROMO', title='Scope', code='SCOPED', discountType='PERCENT', discountValue=5,
                 minSatang=90000, maxDiscountSatang=4000, usageLimit=20, expiresAt='2099-01-01T00:00:00Z')
    scoped = {**promo, 'maxSatang': 100000, 'eligiblePackageIds': [8, 7, 2, 1]}

    def order(member, package, code, key=None, version=1):
        quote = dict(package=dict(id=package, catalogVersion=version), promo=dict(code=code) if code else None,
                     subtotalSatang=1, discountSatang=0)
        return (f"SELECT to_jsonb(o) FROM create_catalog_package_payment_order('{uuid4()}',{member},'token-{member}',"
                f"'{key or uuid4()}',{j(quote)},{receiver}) o;")

    def grant(definition, member):
        query(admin('grant', dict(definitionId=definition, memberCode=f'BLU-{member}')))

    def snapshot():
        return scalar("SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM package_payment_orders o;")

    def settle(row):
        attempt = uuid4()
        oid, actor = row['id'], row['member_id']
        query(f"SELECT claim_package_payment_attempt('{oid}',{actor},'token-{actor}','{attempt}',repeat('a',64),false);")
        proof = dict(transRef=str(uuid4()), amountSatang=row['amount_satang'], bankCode='002', orderId=oid,
                     paidAt=row['created_at'], receiverEvidence='REGISTERED_ACCOUNT_V2', providerStrategy='EASYSLIP_V2_REGISTERED_ACCOUNT',
                     receiverIdentity=dict(matchingType='BANK_ACCOUNT', bankCode='002', bankAccount='1234567890',
                                           name='SYNTHETIC UAT', expectedName='SYNTHETIC UAT', normalizedName='SYNTHETICUAT'))
        query(f"UPDATE package_payment_attempts SET state='VERIFIED', evidence={j(proof)} WHERE id='{attempt}';")
        return json.loads(scalar(f"SELECT to_jsonb(o) FROM finalize_package_payment('{oid}',{actor},'token-{actor}','{attempt}') o;"))

    fixture = (base.ROOT / 'src/lib/package-payment-benefits.test.mjs').read_text(encoding='utf-8')
    # Both profiles use the real October hardening fixture before the guarded receiver migration.
    for upgraded in (False, True):
        db = 'blu_modules_test_promo_upgraded' if upgraded else 'blu_modules_test_promo_october'
        runner_query(f'CREATE DATABASE {db};')
        query = lambda sql, check=True: runner_query(sql, check=check, database=db)
        query(re.search(r'await db\.exec\(`([\s\S]*?)`\);', fixture)[1])
        apply(*base.BASE)
        query("""DO $$ DECLARE f record; BEGIN FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc
            WHERE pronamespace='public'::regnamespace LOOP
            EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f.signature);
            EXECUTE format('ALTER FUNCTION %s SET search_path=public,pg_catalog',f.signature); END LOOP; END $$;""")
        apply(*base.CATALOG)
        if upgraded:
            apply(*base.R3, '20261127_R6_coupon_activation')
        query("""INSERT INTO members(member_code,full_name,status,role,expire_date)
          SELECT 'BLU-'||i,'Synthetic','ACTIVE',CASE WHEN i=1 THEN 'ADMIN' WHEN i=2 THEN 'OWNER' ELSE 'MEMBER' END,
          now()+interval '7 days' FROM generate_series(1,14) i;
          INSERT INTO auth_sessions(member_id,token_hash,expires_at) SELECT id,'token-'||id,now()+interval '1 day' FROM members;
          UPDATE package_catalog SET price_satang=100000,version=2 WHERE id=3;
          UPDATE package_catalog SET is_active=false,version=2 WHERE id=10;""")
        old = json.loads(scalar(admin('create', {**promo, 'code': 'LEGACY'})))
        for member in (3, 4, 12):
            grant(old['id'], member)
        pending_key = uuid4()
        pending = json.loads(scalar(order(3, 7, 'LEGACY', pending_key)))
        paid = settle(json.loads(scalar(order(4, 7, 'LEGACY'))))
        assert paid['status'] == 'PAID'
        before = snapshot()
        before_admin = scalar("SELECT md5(pg_get_functiondef('real_benefits_admin_action(text,text,uuid,jsonb)'::regprocedure));")
        migration = (base.MIGRATIONS / '20261128_R6_promo_scope.sql').read_text(encoding='utf-8')
        query('ALTER TABLE package_payment_orders DISABLE TRIGGER package_catalog_order_insert_guard;')
        denied(migration, 'P0001')
        assert scalar("SELECT count(*) FROM pg_attribute WHERE attrelid='benefit_definitions'::regclass AND attname='max_satang';") == '0'
        query('ALTER TABLE package_payment_orders ENABLE TRIGGER package_catalog_order_insert_guard;')
        guard = scalar("SELECT pg_get_functiondef('guard_package_catalog_order_insert()'::regprocedure);")
        query(guard.replace(' RETURN NEW;', ' -- Fixture-only source drift\n RETURN NEW;'))
        denied(migration, 'P0001')
        assert scalar("SELECT to_regprocedure('r6_create_scoped_promo(text,uuid,jsonb)') IS NULL;") == 't'
        query(guard)
        installed = query(migration, check=False)
        assert not installed.returncode, (installed.stderr, scalar("""SELECT string_agg(proname||':'||md5(replace(prosrc,chr(13),''))||':'||proconfig::text, E'\\n' ORDER BY proname) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('create_catalog_package_payment_order','create_package_payment_order','guard_package_catalog_order_insert');"""))
        assert before == snapshot()
        assert before_admin == scalar("SELECT md5(pg_get_functiondef('real_benefits_admin_action(text,text,uuid,jsonb)'::regprocedure));")
        assert pending == json.loads(scalar(order(3, 7, 'LEGACY', pending_key, version=999)))
        assert settle(pending)['promo_snapshot'] == pending['promo_snapshot']
        denied(create(scoped, actor=3), '42501')
        assert scalar("SELECT has_function_privilege('public','r6_create_scoped_promo(text,uuid,jsonb)','EXECUTE');") == 'f'
        for invalid in ({'maxSatang': 89999}, {'maxSatang': '100000'}, {'maxSatang': 100000.5},
                        {'eligiblePackageIds': []}, {'eligiblePackageIds': [7, 7]}, {'eligiblePackageIds': ['7']},
                        {'eligiblePackageIds': [10]}, {'eligiblePackageIds': [98765]}, {'eligiblePackageIds': [None]}):
            denied(create({**scoped, **invalid}), '22023')
        key = uuid4()
        definition = json.loads(scalar(create(scoped, key)))
        assert definition['eligible_package_ids'] == [1, 2, 7, 8] and definition['max_satang'] == 100000
        assert definition == json.loads(scalar(create(scoped, key)))
        denied_message(create({**scoped, 'maxSatang': 100001}, key), 'Request key reused')
        denied_message(admin('create', promo, key), 'Request key reused')
        assert json.loads(scalar(admin('list', {})))['definitions'][0] == definition
        for member in (5, 6, 7, 8, 9, 11):
            grant(definition['id'], member)
        before = snapshot()
        denied_message(order(5, 1, 'SCOPED'), 'Promo unavailable')  # below minimum
        denied_message(order(5, 8, 'SCOPED'), 'Promo unavailable')  # allowed ID, above maximum
        denied_message(order(5, 3, 'SCOPED', version=2), 'Promo unavailable')  # same as max, wrong ID
        denied_message(order(10, 7, 'SCOPED'), 'Promo unavailable')  # no grant
        assert snapshot() == before
        lower = json.loads(scalar(order(6, 2, 'SCOPED')))
        upper = json.loads(scalar(order(7, 7, 'SCOPED')))
        assert (lower['subtotal_satang'], upper['subtotal_satang']) == (90000, 100000)
        assert lower['discount_satang'] == upper['discount_satang'] == 4000
        assert scalar('SELECT count(*) FROM benefit_promo_reservations;') == '4'

        # Direct wrapper: enforce the maximum before calculating a reservation.
        raw_snapshot = upper['package_snapshot']
        direct_quote = dict(package=raw_snapshot, subtotalSatang=100001, promo=dict(code='SCOPED'))
        denied_message(f"SELECT create_package_payment_order('{uuid4()}',8,'token-8','{uuid4()}',{j(direct_quote)},{receiver});", 'Promo unavailable')
        # Direct INSERT with genuine catalog snapshot / correct subtotal, wrong eligible ID.
        control = json.loads(scalar(order(12, 3, 'LEGACY', version=2)))
        raw_fields = '(id,member_id,request_key,package_snapshot,receiver_snapshot,subtotal_satang,discount_satang,amount_satang,promo_snapshot,promo_code,points_earned,created_at,expires_at,upload_deadline)'
        denied_message(f"INSERT INTO package_payment_orders {raw_fields} SELECT '{uuid4()}',8,'{uuid4()}',package_snapshot,receiver_snapshot,"
               f"subtotal_satang,discount_satang,amount_satang,{j(upper['promo_snapshot'])},'SCOPED',points_earned,created_at,expires_at,upload_deadline "
               f"FROM package_payment_orders WHERE id='{control['id']}';", 'Promo unavailable')
        query('UPDATE package_catalog SET price_satang=100001,version=2 WHERE id=7;')
        denied_message(order(8, 7, 'SCOPED', version=2), 'Promo unavailable')
        repriced = json.loads(scalar(order(13, 7, None, version=2)))
        assert repriced['subtotal_satang'] == 100001
        forged_quote = dict(package=repriced['package_snapshot'], subtotalSatang=100000, promo=dict(code='SCOPED'))
        denied_message(f"SELECT create_package_payment_order('{uuid4()}',8,'token-8','{uuid4()}',{j(forged_quote)},{receiver});", 'does not match current catalog')
        # Quota still serializes across distinct members through the same definition.
        limited = json.loads(scalar(create({**scoped, 'code': 'ONELEFT', 'usageLimit': 1})))
        for member in (8, 9):
            grant(limited['id'], member)
        barrier = Barrier(2, timeout=5)

        def reserve(member):
            barrier.wait()
            return query('BEGIN; ' + order(member, 2, 'ONELEFT') + ' SELECT pg_sleep(0.3); COMMIT;', check=False)

        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = list(pool.map(reserve, (8, 9)))
        assert sorted(r.returncode == 0 for r in outcomes) == [False, True]
        assert any('P0001' in r.stderr for r in outcomes)
        assert scalar("SELECT count(*) FROM package_payment_orders WHERE promo_code='ONELEFT';") == '1'
        print(f'PASS: {"R3 bonus + coupon activation" if upgraded else "October"} — guarded install, legacy replay/PAID, typed promo creation, scope at quote/reservation/INSERT, quota race', flush=True)


if __name__ == '__main__':
    runner.exercise = exercise
    runner.main()

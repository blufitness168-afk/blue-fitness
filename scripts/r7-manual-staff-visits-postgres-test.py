"""Manual staff sources after the actual R4-first migration chain, scratch PostgreSQL only."""
from concurrent.futures import ThreadPoolExecutor
from importlib import import_module
import json
from uuid import uuid4

combined = import_module('r347-compatibility-postgres-test')
runner = combined.runner
MIGRATION = '20261203_R7_manual_staff_visits.sql'


def exercise(query):
    combined.exercise(query)

    def scalar(sql):
        return query(sql).stdout.strip()

    def read(sql):
        return json.loads(scalar(sql))

    def deny(sql, code):
        result = query(sql, check=False)
        assert result.returncode and code in result.stderr, result.stderr

    def state():
        return scalar('''SELECT jsonb_build_array(test_combined_money(),
          (SELECT jsonb_agg(m ORDER BY id) FROM members m),
          (SELECT jsonb_agg(f ORDER BY sale_id) FROM r4_staff_private.free_sales f),
          (SELECT jsonb_agg(c ORDER BY id) FROM coupons c),
          (SELECT jsonb_agg(g ORDER BY coupon_id) FROM time_supplement_grants g),
          (SELECT jsonb_agg(a ORDER BY coupon_id) FROM time_supplement_activations a));''')

    def call(key=None, token='token-2', **changes):
        payload = dict(code='BLU-10', inAt='2020-01-01T23:50+07:00', outAt='2020-01-02T00:20+07:00',
                       orderId=None, usedTimeSlot=None, serviceType='Gym', reason='Paper log', note=None)
        payload.update(changes)
        return f"SELECT r7_manual_visit('{token}','{key or uuid4()}',$payload${json.dumps(payload)}$payload$::jsonb);"

    def term(mid, offset, boundary='starts_at'):
        return read(f'''WITH t AS (
          SELECT sale_id, {boundary}+interval '{offset}' AS moment, r347_staff_package(f) AS package
          FROM r4_staff_private.free_sales f WHERE member_id={mid}
        ) SELECT jsonb_build_object('input',jsonb_build_object('code','BLU-{mid}','staffSaleId',sale_id,
          'inAt',to_char(moment AT TIME ZONE 'Asia/Bangkok','YYYY-MM-DD"T"HH24:MI:SS')||'+07:00',
          'outAt',to_char((moment+interval '1 second') AT TIME ZONE 'Asia/Bangkok','YYYY-MM-DD"T"HH24:MI:SS')||'+07:00'),
          'package',package) FROM t;''')

    old_call = call()
    old = read(old_call)
    assert old['ok'], old
    query('GRANT EXECUTE ON FUNCTION r7_manual_visit(text,uuid,jsonb) TO combined_legacy_acl;')
    before = state()
    query((combined.base.MIGRATIONS / MIGRATION).read_text(encoding='utf-8'))
    assert read(old_call) == old and state() == before
    assert scalar('''SELECT has_function_privilege('combined_legacy_acl','r7_manual_visit(text,uuid,jsonb)','EXECUTE')
      AND NOT has_function_privilege('combined_untrusted','r7_manual_visit(text,uuid,jsonb)','EXECUTE')
      AND NOT has_function_privilege('combined_untrusted','r7_manual_staff_source(integer,timestamptz,uuid)','EXECUTE');''') == 't'
    for token in ('token-1', 'token-4', 'kiosk', 'missing'):
        deny(call(token=token, staffSaleId=str(uuid4())), '42501')
    deny(call(staffSaleId='invalid'), '22023')
    deny(call(staffSaleId=str(uuid4()), orderId=str(uuid4())), '22023')
    deny(call(inAt='2999-01-01T10:00+07:00',outAt='2999-01-01T11:00+07:00',staffSaleId=str(uuid4())), '22023')

    # Real writers reserve future terms. Move only the observed-time ceiling in the scratch RPC,
    # leaving actual sale provenance, member locks, session and overlap verification unchanged.
    query("""DO $clock$ BEGIN
       EXECUTE replace(pg_get_functiondef('r7_manual_visit(text,uuid,jsonb)'::regprocedure),
         'exit_at>clock_timestamp()', 'exit_at>clock_timestamp()+interval ''5 years''');
       END $clock$;""")
    for mid, method in ((4, 'STAFF_FREE'), (5, 'STAFF_TRANSFER')):
        source = term(mid, '2 seconds')
        fields = source['input']
        key = uuid4()
        sql = call(key, **fields)
        assert read(call(**{**fields, 'staffSaleId':str(uuid4())}))['reason'] == 'PACKAGE_UNVERIFIED'
        assert read(call(**{**fields, 'code':'BLU-10'}))['reason'] == 'PACKAGE_UNVERIFIED'
        assert read(call(**term(mid, '-2 seconds')['input']))['reason'] == 'PACKAGE_UNVERIFIED'
        assert read(call(**term(mid, '1 second', 'ends_at')['input']))['reason'] == 'PACKAGE_UNVERIFIED'
        with ThreadPoolExecutor(max_workers=2) as pool:
            first, replay = list(pool.map(read, [sql, sql]))
        assert first == replay and first['ok'], first
        deny(call(key, **{**fields, 'staffSaleId':str(uuid4())}), '22023')
        assert read(call(**fields))['reason'] == 'OVERLAP'
        snapshot = read(f"SELECT snapshot FROM r7_visits WHERE id={first['visitId']};")
        assert snapshot['reason'] == 'MANUAL_PAIR' and snapshot['orderId'] is None
        assert snapshot['staffSaleId'] == fields['staffSaleId'] and snapshot['packageSource'] == method
        assert snapshot['package'] == source['package'] and snapshot['mainTimeSlot'] == source['package']['timeSlot']
        assert snapshot['usedTimeSlot'] is None and 'supplement' not in snapshot
        assert scalar(f"SELECT count(*)=1 FROM r7_visit_requests WHERE request_key='{key}';") == 't'
    assert state() == before

    def visit_counts():
        return scalar('''SELECT jsonb_build_array((SELECT count(*) FROM checkins),
          (SELECT count(*) FROM r7_visits),(SELECT count(*) FROM r7_visit_requests));''')

    before_failure = visit_counts()
    failed = call(**term(4, '60 seconds')['input'])
    query('''CREATE TRIGGER fail_manual_staff_audit BEFORE INSERT ON r7_visit_requests
      FOR EACH STATEMENT EXECUTE FUNCTION r7_audit_guard();''')
    deny(failed, 'P0001')
    assert visit_counts() == before_failure and state() == before
    query('DROP TRIGGER fail_manual_staff_audit ON r7_visit_requests;')
    assert read(failed)['ok'] and state() == before

    # A real scheduled sale cancelled before activation can no longer corroborate a visit.
    sale = read('''SELECT r4_staff_private.record_free_sale('token-2',gen_random_uuid(),'BLU-3',
      r4_staff_private.preview_free_sale('token-2','BLU-3'),'Synthetic cancellation case');''')['saleId']
    query(f"SELECT r4_staff_private.cancel_free_sale('token-2',gen_random_uuid(),'{sale}','Synthetic cancellation');")
    assert scalar(f"SELECT EXISTS(SELECT FROM r4_staff_private.free_sale_cancellations WHERE sale_id='{sale}');") == 't'
    before = state()
    assert read(call(**term(3, '2 seconds')['input']))['reason'] == 'PACKAGE_UNVERIFIED'
    assert state() == before
    assert scalar('SELECT bool_and(points_awarded=0) FROM checkins;') == 't'
    print('PASS: exact free/transfer manual sources, old receipts and ACLs, denial boundaries/cancellation, overlap/replay, atomic audit rollback, unchanged business state', flush=True)


if __name__ == '__main__':
    runner.exercise = exercise
    runner.main()

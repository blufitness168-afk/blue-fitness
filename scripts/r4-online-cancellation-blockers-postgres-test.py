"""Demonstrate current paid-cancellation blockers in a disposable native cluster."""
from importlib import import_module
import re

runner = import_module('r4-staff-free-display-postgres-test')
base = runner.base


def exercise(query):
    def apply(*names):
        for name in names:
            query((base.MIGRATIONS / (name + '.sql')).read_text(encoding='utf-8'))

    fixture = (base.ROOT / 'src/lib/package-payment-benefits.test.mjs').read_text(encoding='utf-8')
    seed = (base.ROOT / 'scripts/r4-staff-free-postgres-test.sql').read_text(encoding='utf-8')
    query(re.search(r'await db\.exec\(`([\s\S]*?)`\);', fixture)[1])
    query('ALTER TABLE members ADD COLUMN avatar_changed boolean DEFAULT false;')
    apply(*base.BASE)
    query('ALTER FUNCTION finalize_package_payment(uuid,integer,text,uuid) SET search_path TO public,pg_catalog;')
    apply(*base.CATALOG, '20261118_R2_member_cards', '20261118_R2_staff_avatar', *base.R3,
          '20261118_R4_online_provenance', '20261119_R4_staff_free_foundation',
          '20261119_R4_staff_free_admission', '20261119_R4_staff_free_finance',
          '20261119_R4_staff_free_writer', '20261120_R4_staff_free_display',
          '20261120_R4_staff_free_z_cancellation', '20261121_R4_staff_free_purchase_guard',
          '20261124_R4_online_settlement_evidence')
    query(seed.split('SELECT test_settle(3)', 1)[0])
    query('''
      BEGIN;
      -- Two starting states: no historical expiry, and an expired aggregate.
      UPDATE members SET expire_date=now()-interval '7 days',status='ACTIVE' WHERE id=4;
      SELECT test_settle(3),test_settle(4);
      DO $$ BEGIN
        IF (SELECT count(*) FROM entitlement_online_observations e
            JOIN members m ON m.id=e.member_id
            JOIN LATERAL r3_override_current_order(m.id,clock_timestamp()) o ON o.id=e.order_id
            WHERE m.id IN (3,4) AND m.expire_date=e.confirmed_at+interval '24 hours') <> 2 THEN
          RAISE EXCEPTION 'Expected both prior states to satisfy the same single-order proof';
        END IF;
      END $$;

      -- Test-only marker: deliberately not an implementation or refund. Pin
      -- the scan clock (not the entitlement predicate) within the PAID slot.
      CREATE TEMP TABLE hypothetical_cancellations(order_id uuid PRIMARY KEY);
      CREATE TEMP TABLE original AS SELECT * FROM package_payment_orders WHERE member_id=3;
      INSERT INTO hypothetical_cancellations SELECT id FROM original;
      DO $$
      DECLARE sig regprocedure:='public.real_frontdesk_checkin(text,text,uuid,text)'::regprocedure;
              d text; t timestamptz; r jsonb; o package_payment_orders;
      BEGIN
        SELECT * INTO STRICT o FROM original;
        d:=pg_get_functiondef(sig);
        IF strpos(d,'t:=clock_timestamp();')=0 THEN RAISE EXCEPTION 'Unknown scan clock'; END IF;
        EXECUTE replace(d,'t:=clock_timestamp();',
          $clock$t:=current_setting('test.r4_online_scan_at')::timestamptz;$clock$);
        t:=(((o.confirmed_at AT TIME ZONE 'Asia/Bangkok')::date)+time '10:00') AT TIME ZONE 'Asia/Bangkok';
        IF t<o.confirmed_at THEN t:=t+interval '24 hours'; END IF;
        PERFORM set_config('test.r4_online_scan_at',t::text,true);
        r:=real_frontdesk_checkin('token-1','test-marker-only',gen_random_uuid(),'BLU-3');
        IF r->>'reason' IS DISTINCT FROM 'PAID_ENTRY' THEN
          RAISE EXCEPTION 'Expected marker alone not to stop admission: %',r;
        END IF;
        -- Demonstrate a naive expiry clamp (not a supported reversal): it
        -- stops admission here, but the direct payment-account input still
        -- selects the original snapshot as the member's package.
        UPDATE members SET expire_date=o.confirmed_at WHERE id=3;
        r:=real_frontdesk_checkin('token-1','test-clamp',gen_random_uuid(),'BLU-3');
        IF r->>'reason' IS DISTINCT FROM 'NO_ENTITLEMENT' THEN
          RAISE EXCEPTION 'Expected fresh scan to stop after clamp: %',r;
        END IF;
        IF (SELECT p.package_snapshot FROM package_payment_orders p
            WHERE p.member_id=3 AND p.status='PAID' ORDER BY p.created_at DESC LIMIT 1)
            IS DISTINCT FROM o.package_snapshot THEN
          RAISE EXCEPTION 'Expected legacy payment-account projection to retain package';
        END IF;
        IF (SELECT to_jsonb(p) FROM package_payment_orders p WHERE p.id=o.id) IS DISTINCT FROM to_jsonb(o) THEN
          RAISE EXCEPTION 'Expected unchanged transaction history';
        END IF;
      END $$;
      ROLLBACK;
    ''')
    query('''
      BEGIN;
      SELECT test_settle(6,1);
      DO $$
      DECLARE first_order package_payment_orders; next_order package_payment_orders;
              b r4_online_private.settlement_before; e r4_online_private.settlement_effects;
      BEGIN
        SELECT * INTO STRICT first_order FROM package_payment_orders WHERE member_id=6 AND status='PAID';
        SELECT * INTO STRICT b FROM r4_online_private.settlement_before WHERE order_id=first_order.id;
        SELECT * INTO STRICT e FROM r4_online_private.settlement_effects WHERE order_id=first_order.id;
        IF b.expiry_before IS NOT NULL OR e.issued_coupons<>'[]' OR e.promo_assignment_id IS NOT NULL
          OR e.checkin_fingerprint IS DISTINCT FROM r4_online_private.checkin_fingerprint(6)
          OR NOT EXISTS (SELECT FROM members m WHERE m.id=6 AND
            (m.expire_date,m.status::text,m.points)=(e.expiry_after,e.status_after,e.points_after))
          OR NOT EXISTS (SELECT FROM r3_override_current_order(6,clock_timestamp()) p WHERE p.id=first_order.id) THEN
          RAISE EXCEPTION 'Expected intact evidence for a standalone no-benefit order';
        END IF;

        -- Test-only restoration (no cancellation, refund, or point ledger write).
        UPDATE members SET expire_date=b.expiry_before,status=b.status_before::member_status,points=b.points_before WHERE id=6;
        IF (SELECT p.id FROM package_payment_orders p WHERE p.member_id=6 AND p.status='PAID'
            ORDER BY p.created_at DESC LIMIT 1) IS DISTINCT FROM first_order.id THEN
          RAISE EXCEPTION 'Expected paymentAccount selection to retain the original package after exact restoration';
        END IF;
        PERFORM test_settle(6,6);
        PERFORM test_settle(7,6);
        SELECT * INTO STRICT next_order FROM package_payment_orders WHERE member_id=6 AND status='PAID' AND id<>first_order.id;
        IF next_order.membership_expires_at IS DISTINCT FROM next_order.confirmed_at+interval '24 hours'
          OR (SELECT to_jsonb(p) FROM package_payment_orders p WHERE p.id=first_order.id) IS DISTINCT FROM to_jsonb(first_order)
          OR NOT EXISTS (SELECT FROM r3_override_current_order(7,clock_timestamp()))
          OR EXISTS (SELECT FROM r3_override_current_order(6,clock_timestamp())) THEN
          RAISE EXCEPTION 'Expected a new standalone sale to lose R3 proof solely with preserved PAID history';
        END IF;
      END $$;
      ROLLBACK;
    ''')
    print('PASS: native online blockers (marker alone still admits; exact restoration leaves the legacy package; preserved PAID blocks R3 repurchase proof)', flush=True)


if __name__ == '__main__':
    runner.exercise = exercise
    runner.main()

-- Prepare only. Apply after the R4 staff-free writer and cancellation migrations.
BEGIN;
SET LOCAL search_path = pg_catalog;
SELECT r4_staff_private.assert_writer_stack();
DO $$ BEGIN
 IF to_regclass('r4_staff_private.free_sale_cancellations') IS NULL THEN
  RAISE EXCEPTION 'R4 purchase guard requires staff-free cancellation' USING ERRCODE='0A000';
 END IF;
END $$;

CREATE FUNCTION r4_staff_private.guard_online_purchase() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog AS $$
BEGIN
  -- Serialize with the staff writer and cancellation even on direct inserts.
  -- Read Committed lets the check see a staff term committed while waiting.
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Online order requires Read Committed' USING ERRCODE = '0A000';
  END IF;
  PERFORM 1 FROM public.members WHERE id = NEW.member_id FOR UPDATE;
  IF EXISTS (
    SELECT FROM r4_staff_private.free_sales s
    WHERE s.member_id = NEW.member_id AND s.ends_at > clock_timestamp()
      AND NOT EXISTS (SELECT FROM r4_staff_private.free_sale_cancellations c WHERE c.sale_id = s.sale_id)
  ) THEN
    RAISE EXCEPTION 'Online purchase blocked by staff term' USING ERRCODE = 'P4F01';
  END IF;
  RETURN NEW;
END $$;

-- Run before the catalog insert guard to preserve member-before-catalog lock order.
CREATE TRIGGER a_r4_staff_free_online_purchase_guard
BEFORE INSERT ON public.package_payment_orders
FOR EACH ROW EXECUTE FUNCTION r4_staff_private.guard_online_purchase();
REVOKE ALL ON FUNCTION r4_staff_private.guard_online_purchase() FROM PUBLIC;
SELECT r4_staff_private.assert_free_purchase_guard();
COMMIT;

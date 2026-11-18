-- PREPARE ONLY: additive shadow observations, NOT an entitlement authority.
-- No backfill, no finalizer replacement, no new points/coupons/income.
BEGIN;
CREATE TABLE public.entitlement_online_observations (
 order_id uuid PRIMARY KEY REFERENCES public.package_payment_orders(id) ON DELETE RESTRICT,
 member_id integer NOT NULL REFERENCES public.members(id) ON DELETE RESTRICT,
 point_ledger_order_id uuid NOT NULL UNIQUE REFERENCES public.package_payment_point_ledger(order_id) ON DELETE RESTRICT,
 package_snapshot jsonb NOT NULL,
 confirmed_at timestamptz NOT NULL,
 membership_expires_at timestamptz NOT NULL,
 points_delta integer NOT NULL CHECK(points_delta>=0),
 points_balance_after integer NOT NULL CHECK(points_balance_after>=0),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 provenance_version integer NOT NULL DEFAULT 1 CHECK(provenance_version=1),
 CHECK(point_ledger_order_id=order_id),
 CHECK(jsonb_typeof(package_snapshot)='object'),
 CHECK(membership_expires_at>confirmed_at)
);
COMMENT ON TABLE public.entitlement_online_observations IS
 'Shadow audit of new online PAID transitions only. Expiry is an aggregate observation, not a proven entitlement interval. No staff sales, reversal authority or historical reconstruction.';
CREATE FUNCTION public.entitlement_observation_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN RAISE EXCEPTION 'Online provenance is append-only'; END $$;
CREATE TRIGGER entitlement_observation_guard BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.entitlement_online_observations FOR EACH STATEMENT
 EXECUTE FUNCTION public.entitlement_observation_immutable();
CREATE FUNCTION public.entitlement_observe_online_paid() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE award public.package_payment_point_ledger;
BEGIN
 IF OLD.status IS DISTINCT FROM 'PENDING' OR NEW.status IS DISTINCT FROM 'PAID' THEN RETURN NEW; END IF;
 SELECT * INTO award FROM public.package_payment_point_ledger WHERE order_id=NEW.id;
 IF award.order_id IS NULL OR award.member_id IS DISTINCT FROM NEW.member_id
 OR award.delta IS DISTINCT FROM NEW.points_earned THEN
  RAISE EXCEPTION 'Online provenance requires matching original point ledger';
 END IF;
 INSERT INTO public.entitlement_online_observations
 (order_id,member_id,point_ledger_order_id,package_snapshot,confirmed_at,membership_expires_at,points_delta,points_balance_after)
 VALUES(NEW.id,NEW.member_id,award.order_id,NEW.package_snapshot,NEW.confirmed_at,NEW.membership_expires_at,award.delta,award.balance_after);
 -- Unique source identity intentionally fails on inconsistent duplicate issuance;
 -- terminal finalizer replay does not perform another PENDING -> PAID transition.
 RETURN NEW;
END $$;
CREATE TRIGGER entitlement_online_paid_observation AFTER UPDATE OF status
 ON public.package_payment_orders FOR EACH ROW
 EXECUTE FUNCTION public.entitlement_observe_online_paid();
REVOKE ALL ON public.entitlement_online_observations FROM PUBLIC;
REVOKE ALL ON FUNCTION public.entitlement_observation_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.entitlement_observe_online_paid() FROM PUBLIC;
COMMIT;

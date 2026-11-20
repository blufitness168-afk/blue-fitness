-- PREPARE ONLY. This migration has no writer or application grants.
BEGIN;
SET LOCAL search_path = pg_catalog;
CREATE SCHEMA r4_staff_private;
REVOKE ALL ON SCHEMA r4_staff_private FROM PUBLIC;

-- One immutable fact is the sale, its candidate term and its audit. The
-- finance projection derives from that same row, so it cannot be orphaned.
CREATE TABLE r4_staff_private.free_sales (
 sale_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 member_id integer NOT NULL REFERENCES public.members(id),
 member_code text NOT NULL CHECK (member_code ~ '^BLU-[0-9]{1,12}$'),
 predecessor_order_id uuid NOT NULL UNIQUE REFERENCES public.package_payment_orders(id),
 actor_id integer NOT NULL REFERENCES public.members(id),
 actor_role text NOT NULL CHECK (actor_role IN ('ADMIN','OWNER')),
 request_key uuid NOT NULL,
 reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 240 AND reason ~ '[^[:space:]]'),
 package_id integer NOT NULL REFERENCES public.package_catalog(id),
 catalog_version integer NOT NULL CHECK (catalog_version > 0),
 package_name text NOT NULL CHECK (length(package_name) BETWEEN 1 AND 200),
 duration_days integer NOT NULL CHECK (duration_days BETWEEN 1 AND 3660),
 daily_slot text NOT NULL CHECK (public.package_catalog_daily_slot_valid(daily_slot) IS TRUE),
 catalog_price_satang integer NOT NULL CHECK (catalog_price_satang > 0),
 amount_satang integer NOT NULL DEFAULT 0 CHECK (amount_satang = 0),
 method text NOT NULL DEFAULT 'STAFF_FREE' CHECK (method = 'STAFF_FREE'),
 occurred_at timestamptz NOT NULL,
 recorded_at timestamptz NOT NULL,
 starts_at timestamptz NOT NULL,
 ends_at timestamptz NOT NULL,
 UNIQUE (actor_id,request_key),
 CHECK (actor_id <> member_id),
 CHECK (isfinite(recorded_at) AND isfinite(starts_at) AND isfinite(ends_at)),
 CHECK (occurred_at = recorded_at AND starts_at > occurred_at),
 CHECK (ends_at = starts_at + duration_days * interval '24 hours')
);
COMMENT ON TABLE r4_staff_private.free_sales IS
 'Disabled R4 foundation: candidate terms only. Not read by admission or existing finance reports. No historical backfill.';

CREATE FUNCTION r4_staff_private.reject_sale_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
 RAISE EXCEPTION 'Staff free sales are append-only' USING ERRCODE = '55000';
END $$;
CREATE TRIGGER free_sales_append_only BEFORE UPDATE OR DELETE OR TRUNCATE
 ON r4_staff_private.free_sales FOR EACH STATEMENT
 EXECUTE FUNCTION r4_staff_private.reject_sale_mutation();

-- Internal finance source, not a grant or a UNION into the live finance reader.
-- The positive list-price snapshot is deliberately not part of realized income.
CREATE VIEW r4_staff_private.finance_source AS
 SELECT 'staff-free:' || sale_id::text AS source_id, sale_id, member_id,
        'INCOME'::text AS type, method AS source, amount_satang,
        (occurred_at AT TIME ZONE 'Asia/Bangkok')::date AS entry_date,
        occurred_at, recorded_at
 FROM r4_staff_private.free_sales;

REVOKE ALL ON r4_staff_private.free_sales, r4_staff_private.finance_source FROM PUBLIC;
REVOKE ALL ON FUNCTION r4_staff_private.reject_sale_mutation() FROM PUBLIC;
COMMIT;

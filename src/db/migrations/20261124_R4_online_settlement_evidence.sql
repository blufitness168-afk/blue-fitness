-- PREPARE ONLY. No cancellation writer, historical backfill or reader changes.
-- Requires the reviewed NORMAL/bank finalizer and the catalog + R4 observation hooks.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = pg_catalog;
LOCK TABLE public.package_payment_orders IN ACCESS EXCLUSIVE MODE;

CREATE SCHEMA r4_online_private;
REVOKE ALL ON SCHEMA r4_online_private FROM PUBLIC;

CREATE TABLE r4_online_private.settlement_before (
 order_id uuid PRIMARY KEY REFERENCES public.package_payment_orders(id),
 member_id integer NOT NULL REFERENCES public.members(id),
 verified_attempt_id uuid NOT NULL UNIQUE REFERENCES public.package_payment_attempts(id),
 transaction_id xid8 NOT NULL DEFAULT pg_current_xact_id(),
 expiry_before timestamptz,
 status_before text NOT NULL,
 points_before integer NOT NULL,
 captured_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE r4_online_private.settlement_effects (
 order_id uuid PRIMARY KEY REFERENCES r4_online_private.settlement_before(order_id),
 observation_id uuid NOT NULL UNIQUE REFERENCES public.entitlement_online_observations(order_id),
 expiry_after timestamptz NOT NULL,
 status_after text NOT NULL,
 points_after integer NOT NULL,
 award_delta integer NOT NULL,
 amount_satang integer NOT NULL,
 confirmed_at timestamptz NOT NULL,
 issued_coupons jsonb NOT NULL CHECK (jsonb_typeof(issued_coupons)='array'),
 promo_assignment_id bigint,
 checkin_fingerprint bytea NOT NULL CHECK (octet_length(checkin_fingerprint)=32),
 CHECK (observation_id=order_id)
);
COMMENT ON TABLE r4_online_private.settlement_before IS
 'Locked pre-mutation aggregate from the verified finalizer only. Not prior entitlement identity or cancellation authority.';
COMMENT ON TABLE r4_online_private.settlement_effects IS
 'Validated settlement effects. Coupon state is as issued, not evidence of current availability or non-use.';

CREATE FUNCTION r4_online_private.reject_mutation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'R4 online settlement evidence is append-only' USING ERRCODE='55000'; END $$;
CREATE TRIGGER settlement_before_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
 ON r4_online_private.settlement_before FOR EACH STATEMENT EXECUTE FUNCTION r4_online_private.reject_mutation();
CREATE TRIGGER settlement_effects_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
 ON r4_online_private.settlement_effects FOR EACH STATEMENT EXECUTE FUNCTION r4_online_private.reject_mutation();

-- Check-in timestamps can precede settlement even when admission waited for it.
-- Compare the recorded rows instead; a mismatch requires review, not reversal.
CREATE FUNCTION r4_online_private.checkin_fingerprint(p_member integer) RETURNS bytea
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog SET timezone='UTC' AS $$
 SELECT sha256(convert_to(coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id),'[]'::jsonb)::text,'UTF8'))
 FROM public.checkins c WHERE c.member_id=p_member;
$$;

CREATE FUNCTION r4_online_private.capture_effects() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE prior r4_online_private.settlement_before; m public.members;
 observed public.entitlement_online_observations; award public.package_payment_point_ledger;
 friends integer:=0; days integer:=0; issued jsonb; valid_count integer; promo_assignment bigint;
BEGIN
 IF NEW.status<>'PAID' THEN RETURN NEW; END IF;
 IF TG_OP='INSERT' THEN
  RAISE EXCEPTION 'R4 online PAID must transition through the verified finalizer' USING ERRCODE='55000';
 END IF;
 IF OLD.status='PAID' THEN RETURN NEW; END IF;
 SELECT * INTO prior FROM r4_online_private.settlement_before WHERE order_id=NEW.id;
 IF OLD.status<>'PENDING' OR prior.member_id IS DISTINCT FROM NEW.member_id
    OR prior.transaction_id IS DISTINCT FROM pg_current_xact_id()
    OR NOT EXISTS (SELECT FROM public.package_payment_attempts a WHERE a.id=prior.verified_attempt_id
         AND a.order_id=NEW.id AND a.state='VERIFIED' AND a.evidence=NEW.verification_snapshot) THEN
  RAISE EXCEPTION 'R4 online PAID lacks same-transaction verified pre-state' USING ERRCODE='55000';
 END IF;
 SELECT * INTO m FROM public.members WHERE id=NEW.member_id;
 SELECT * INTO award FROM public.package_payment_point_ledger WHERE order_id=NEW.id;
 SELECT * INTO observed FROM public.entitlement_online_observations WHERE order_id=NEW.id;
 IF m.expire_date IS DISTINCT FROM NEW.membership_expires_at OR m.updated_at IS DISTINCT FROM NEW.confirmed_at
    OR m.status::text IS DISTINCT FROM 'ACTIVE' OR m.points IS DISTINCT FROM prior.points_before+NEW.points_earned
    OR (award.member_id,award.delta,award.balance_after) IS DISTINCT FROM (NEW.member_id,NEW.points_earned,m.points)
    OR (observed.member_id,observed.confirmed_at,observed.membership_expires_at,observed.package_snapshot,
        observed.point_ledger_order_id,observed.points_delta,observed.points_balance_after)
       IS DISTINCT FROM (NEW.member_id,NEW.confirmed_at,NEW.membership_expires_at,NEW.package_snapshot,
        NEW.id,award.delta,award.balance_after)
    OR NOT EXISTS (SELECT FROM public.payment_transfer_refs r WHERE r.trans_ref=NEW.trans_ref
         AND r.source='PACKAGE_ORDER:'||NEW.id) THEN
  RAISE EXCEPTION 'R4 online settlement effects disagree with PAID' USING ERRCODE='55000';
 END IF;
 IF NEW.package_benefits_version=1 THEN
  friends := (NEW.package_snapshot->>'friendCoupons')::integer;
  days := (NEW.package_snapshot->>'bonusDays')::integer;
 END IF;
 -- Exact order source prefix, with an indexable predicate matching the existing partial index.
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'source',c.source,'type',c.type,'quota',c.total_quota,
         'bonusDays',c.bonus_days_value,'expiresAt',c.expire_date) ORDER BY c.source), '[]'::jsonb),
        count(*) FILTER (WHERE c.member_id=NEW.member_id AND c.status='AVAILABLE' AND c.used_count=0
         AND c.expire_date=NEW.membership_expires_at AND (
          (friends>0 AND c.source='PACKAGE_ORDER:'||NEW.id||':FRIEND_PASS' AND c.type='FRIEND_PASS'
            AND c.total_quota=friends AND c.bonus_days_value=0) OR
          (days>0 AND c.source='PACKAGE_ORDER:'||NEW.id||':EXTRA_DAYS' AND c.type='EXTRA_DAYS'
            AND c.total_quota=1 AND c.bonus_days_value=days)))
 INTO issued,valid_count FROM public.coupons c
 WHERE c.source LIKE 'PACKAGE_ORDER:%' AND c.source IN
       ('PACKAGE_ORDER:'||NEW.id||':FRIEND_PASS','PACKAGE_ORDER:'||NEW.id||':EXTRA_DAYS');
 IF valid_count IS DISTINCT FROM (friends>0)::integer+(days>0)::integer OR valid_count<>jsonb_array_length(issued) THEN
  RAISE EXCEPTION 'R4 online coupon issuance disagrees with PAID' USING ERRCODE='55000';
 END IF;
 SELECT r.assignment_id INTO promo_assignment FROM public.benefit_promo_reservations r WHERE r.order_id=NEW.id;
 INSERT INTO r4_online_private.settlement_effects
 (order_id,observation_id,expiry_after,status_after,points_after,award_delta,amount_satang,confirmed_at,issued_coupons,promo_assignment_id,checkin_fingerprint)
 VALUES(NEW.id,observed.order_id,m.expire_date,m.status::text,m.points,award.delta,NEW.amount_satang,NEW.confirmed_at,issued,promo_assignment,
        r4_online_private.checkin_fingerprint(NEW.member_id));
 RETURN NEW;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA r4_online_private FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA r4_online_private FROM PUBLIC;

DO $migration$
DECLARE
 signature constant regprocedure := 'public.finalize_package_payment(uuid,integer,text,uuid)'::regprocedure;
 before_anchor constant text := ' UPDATE members SET expire_date=expiry,status=CASE';
 after_anchor constant text := 'trans_ref=ref,verification_snapshot=a.evidence WHERE id=p_order RETURNING *;';
 pre_hook constant text := $hook$ INSERT INTO r4_online_private.settlement_before
 (order_id,member_id,verified_attempt_id,expiry_before,status_before,points_before)
 SELECT o.id,m.id,a.id,m.expire_date,m.status::text,m.points FROM public.members locked
 WHERE locked.id=m.id AND (locked.expire_date,locked.status,locked.points) IS NOT DISTINCT FROM (m.expire_date,m.status,m.points);
 IF NOT FOUND THEN RAISE EXCEPTION 'R4 locked online pre-state changed' USING ERRCODE='55000'; END IF;
$hook$;
 post_hook constant text := $hook$
 IF NOT EXISTS (SELECT FROM r4_online_private.settlement_effects WHERE order_id=o.id) THEN
  RAISE EXCEPTION 'R4 online settlement evidence hook did not run' USING ERRCODE='55000';
 END IF;$hook$;
 original text; updated text;
BEGIN
 -- Reject named default grants as well as PUBLIC; the evidence writer is not an API.
 IF EXISTS (
  SELECT FROM (
   SELECT n.nspowner AS owner,n.nspacl AS acl FROM pg_namespace n WHERE n.nspname='r4_online_private'
   UNION ALL SELECT c.relowner,c.relacl FROM pg_class c WHERE c.relnamespace='r4_online_private'::regnamespace
   UNION ALL SELECT p.proowner,p.proacl FROM pg_proc p WHERE p.pronamespace='r4_online_private'::regnamespace
  ) obj CROSS JOIN LATERAL aclexplode(obj.acl) g WHERE g.grantee<>obj.owner
 ) THEN RAISE EXCEPTION 'Unexpected grants on R4 online evidence objects' USING ERRCODE='0A000'; END IF;
 -- Fingerprints pin the reviewed function bodies (newline-normalized); reject unknown variants rather than guessing an anchor.
 IF NOT EXISTS (SELECT FROM pg_proc p WHERE p.oid=signature AND NOT p.prosecdef AND p.provolatile='v'
    AND p.proowner=current_user::regrole AND p.proconfig=ARRAY['search_path=public, pg_catalog']
    AND md5(replace(p.prosrc,E'\r\n',E'\n'))='bb83b0f4fac7703df0b9c9b2833d96a4')
    OR EXISTS (SELECT FROM aclexplode(coalesce((SELECT proacl FROM pg_proc WHERE oid=signature),
         acldefault('f',current_user::regrole))) WHERE grantee<>current_user::regrole AND privilege_type='EXECUTE') THEN
  RAISE EXCEPTION 'Unreviewed R4 online finalizer definition, owner, or ACL' USING ERRCODE='0A000';
 END IF;
 IF EXISTS (SELECT FROM (VALUES
    ('package_order_snapshot_guard','public.protect_package_order_snapshot()','eddc4f9a49127cadb81bda81326fbc3b',19,false),
    ('entitlement_online_paid_observation','public.entitlement_observe_online_paid()','be2be85da06c5f79ed96167c3399f17b',17,true),
    ('package_paid_benefits','public.issue_paid_package_benefits()','5e60c9e30bb72506f1221d82585a2144',17,true)
  ) AS expected(trigger_name,fn,body_hash,kind,status_only)
  WHERE NOT EXISTS (SELECT FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
    WHERE t.tgrelid='public.package_payment_orders'::regclass AND t.tgname=expected.trigger_name
    AND t.tgfoid=to_regprocedure(expected.fn) AND NOT p.prosecdef AND t.tgtype=expected.kind
    AND t.tgenabled IN ('O','A') AND t.tgqual IS NULL AND NOT t.tgdeferrable AND t.tgnargs=0
    AND t.tgattr::text=CASE WHEN expected.status_only THEN (SELECT attnum::text FROM pg_attribute
      WHERE attrelid=t.tgrelid AND attname='status' AND NOT attisdropped) ELSE '' END
    AND md5(replace(p.prosrc,E'\r\n',E'\n'))=expected.body_hash)) THEN
  RAISE EXCEPTION 'Unreviewed R4 online PAID trigger stack' USING ERRCODE='0A000';
 END IF;
 original:=replace(pg_get_functiondef(signature),E'\r\n',E'\n');
 IF length(original)-length(replace(original,before_anchor,''))<>length(before_anchor)
    OR length(original)-length(replace(original,after_anchor,''))<>length(after_anchor) THEN
  RAISE EXCEPTION 'Unexpected R4 online finalizer hook positions' USING ERRCODE='0A000';
 END IF;
 updated:=replace(replace(original,before_anchor,pre_hook||before_anchor),after_anchor,after_anchor||post_hook);
 EXECUTE updated;
 IF pg_get_functiondef(signature) IS DISTINCT FROM updated THEN
  RAISE EXCEPTION 'Unexpected R4 online finalizer rewrite' USING ERRCODE='0A000';
 END IF;
END $migration$;

-- PostgreSQL runs same-kind triggers by name: this follows the existing observation and issuance.
CREATE TRIGGER z_r4_online_settlement_effects AFTER INSERT OR UPDATE OF status
 ON public.package_payment_orders FOR EACH ROW EXECUTE FUNCTION r4_online_private.capture_effects();
COMMIT;

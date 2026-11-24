-- Member category registry (MEMBER/TRAINER/STAFF/OTHER) + OWNER-only special gym access (nullable expiry)
-- Additive tables + isolated admission branch before welcome/CLOSED fallback, preserving R4/R7 guards.
BEGIN;
SET LOCAL search_path = public, pg_catalog;
SET LOCAL lock_timeout = '5s';

SELECT 'public.package_catalog_daily_slot_valid(text)'::regprocedure;
SELECT 'public.package_catalog_slot_allows(text,time)'::regprocedure;
SELECT 'public.kiosk_checkin(text,text,uuid,text)'::regprocedure;
SELECT 'public.real_frontdesk_checkin(text,text,uuid,text)'::regprocedure;

CREATE TABLE public.member_categories (
  member_id integer PRIMARY KEY REFERENCES public.members(id) ON DELETE RESTRICT,
  category text NOT NULL CHECK (category IN ('MEMBER', 'TRAINER', 'STAFF', 'OTHER')),
  version integer NOT NULL CHECK (version BETWEEN 1 AND 2147483647),
  updated_by integer NOT NULL REFERENCES public.members(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE public.member_category_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id integer NOT NULL REFERENCES public.members(id),
  actor_role text NOT NULL CHECK (actor_role IN ('ADMIN', 'OWNER')),
  member_id integer NOT NULL REFERENCES public.members(id),
  request_key uuid NOT NULL,
  payload_hash text NOT NULL,
  before_category text NOT NULL,
  after_category text NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 240),
  before_version integer NOT NULL,
  after_version integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (actor_id, request_key)
);

CREATE TABLE public.owner_special_access (
  member_id integer PRIMARY KEY REFERENCES public.members(id) ON DELETE RESTRICT,
  active boolean NOT NULL DEFAULT true,
  expires_at timestamptz,
  daily_slot text NOT NULL CHECK (public.package_catalog_daily_slot_valid(daily_slot)),
  note text NOT NULL CHECK (length(btrim(note)) BETWEEN 1 AND 240),
  version integer NOT NULL CHECK (version BETWEEN 1 AND 2147483647),
  updated_by integer NOT NULL REFERENCES public.members(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE public.owner_special_access_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id integer NOT NULL REFERENCES public.members(id),
  member_id integer NOT NULL REFERENCES public.members(id),
  request_key uuid NOT NULL,
  payload_hash text NOT NULL,
  action text NOT NULL CHECK (action IN ('SET', 'REVOKE')),
  before_state jsonb,
  after_state jsonb,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 240),
  before_version integer NOT NULL,
  after_version integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (actor_id, request_key)
);

CREATE FUNCTION public.member_extension_audit_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'Member extension audit is append-only';
END $$;

CREATE TRIGGER member_category_audit_guard
  BEFORE UPDATE OR DELETE OR TRUNCATE ON public.member_category_audit
  FOR EACH STATEMENT EXECUTE FUNCTION public.member_extension_audit_immutable();

CREATE TRIGGER owner_special_access_audit_guard
  BEFORE UPDATE OR DELETE OR TRUNCATE ON public.owner_special_access_audit
  FOR EACH STATEMENT EXECUTE FUNCTION public.member_extension_audit_immutable();

CREATE FUNCTION public.member_category_read(p_session text, p_code text) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_catalog AS $$
DECLARE
  s public.auth_sessions%ROWTYPE;
  a public.members%ROWTYPE;
  m public.members%ROWTYPE;
  c public.member_categories%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public.auth_sessions WHERE token_hash = p_session FOR SHARE;
  SELECT * INTO a FROM public.members WHERE id = s.member_id FOR SHARE;
  IF s.id IS NULL OR s.mode IS DISTINCT FROM 'NORMAL' OR s.revoked_at IS NOT NULL
  OR s.expires_at IS NULL OR s.expires_at <= clock_timestamp()
  OR a.id IS NULL OR a.status = 'SUSPENDED' OR a.role NOT IN ('ADMIN', 'OWNER') THEN
    RAISE EXCEPTION 'Normal live staff session required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO m FROM public.members WHERE member_code = p_code;
  IF m.id IS NULL THEN
    RAISE EXCEPTION 'Member not found' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO c FROM public.member_categories WHERE member_id = m.id;
  IF NOT EXISTS (SELECT 1 FROM public.auth_sessions WHERE token_hash = p_session AND expires_at > clock_timestamp()) THEN
    RAISE EXCEPTION 'Session expired' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'category', COALESCE(c.category, 'MEMBER'),
    'version', COALESCE(c.version, 0)
  );
END $$;

CREATE FUNCTION public.member_category_update(p_session text, p_key uuid, p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_catalog AS $$
DECLARE
  s public.auth_sessions%ROWTYPE;
  a public.members%ROWTYPE;
  m public.members%ROWTYPE;
  target_id integer;
  prior public.member_category_audit%ROWTYPE;
  cur public.member_categories%ROWTYPE;
  cur_ver integer;
  cur_cat text;
  next_cat text;
  reason_txt text;
  digest text;
BEGIN
  IF p_key IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Invalid category request' USING ERRCODE = '22023';
  END IF;
  IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_payload) k)
     IS DISTINCT FROM ARRAY['category', 'expectedVersion', 'memberCode', 'reason']::text[]
  OR jsonb_typeof(p_payload->'memberCode') IS DISTINCT FROM 'string'
  OR length(p_payload->>'memberCode') NOT BETWEEN 1 AND 50
  OR jsonb_typeof(p_payload->'category') IS DISTINCT FROM 'string'
  OR p_payload->>'category' NOT IN ('MEMBER', 'TRAINER', 'STAFF', 'OTHER')
  OR jsonb_typeof(p_payload->'reason') IS DISTINCT FROM 'string'
  OR length(btrim(p_payload->>'reason')) NOT BETWEEN 1 AND 240
  OR jsonb_typeof(p_payload->'expectedVersion') IS DISTINCT FROM 'number'
  OR (p_payload->>'expectedVersion') !~ '^(0|[1-9][0-9]{0,9})$'
  OR (p_payload->>'expectedVersion')::numeric > 2147483646 THEN
    RAISE EXCEPTION 'Invalid category request' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO s FROM public.auth_sessions WHERE token_hash = p_session FOR SHARE;
  IF s.id IS NULL OR s.mode IS DISTINCT FROM 'NORMAL' OR s.revoked_at IS NOT NULL
  OR s.expires_at IS NULL OR s.expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'Normal live session required' USING ERRCODE = '42501';
  END IF;
  SELECT id INTO target_id FROM public.members WHERE member_code = p_payload->>'memberCode';
  PERFORM id FROM public.members WHERE id IN (s.member_id, target_id) ORDER BY id FOR UPDATE;
  SELECT * INTO a FROM public.members WHERE id = s.member_id;
  SELECT * INTO m FROM public.members WHERE id = target_id;
  IF a.id IS NULL OR a.status = 'SUSPENDED' OR NOT COALESCE(
    (a.role = 'ADMIN' AND m.role = 'MEMBER') OR (a.role = 'OWNER' AND m.id IS NOT NULL), false
  ) THEN
    RAISE EXCEPTION 'Target not allowed' USING ERRCODE = '42501';
  END IF;

  digest := encode(sha256(convert_to(p_payload::text, 'UTF8')), 'hex');
  SELECT * INTO prior FROM public.member_category_audit WHERE actor_id = a.id AND request_key = p_key;
  IF FOUND THEN
    IF prior.payload_hash <> digest THEN
      RAISE EXCEPTION 'Category request conflict' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    SELECT * INTO cur FROM public.member_categories WHERE member_id = m.id FOR UPDATE;
    cur_ver := COALESCE(cur.version, 0);
    cur_cat := COALESCE(cur.category, 'MEMBER');
    IF cur_ver <> (p_payload->>'expectedVersion')::integer THEN
      RAISE EXCEPTION 'Category version conflict' USING ERRCODE = 'P0001';
    END IF;
    next_cat := p_payload->>'category';
    reason_txt := btrim(p_payload->>'reason');
    INSERT INTO public.member_categories(member_id, category, version, updated_by, updated_at)
    VALUES (m.id, next_cat, cur_ver + 1, a.id, clock_timestamp())
    ON CONFLICT (member_id) DO UPDATE
      SET category = excluded.category,
          version = excluded.version,
          updated_by = excluded.updated_by,
          updated_at = excluded.updated_at;
    INSERT INTO public.member_category_audit(
      actor_id, actor_role, member_id, request_key, payload_hash,
      before_category, after_category, reason, before_version, after_version
    ) VALUES (
      a.id, a.role::text, m.id, p_key, digest,
      cur_cat, next_cat, reason_txt, cur_ver, cur_ver + 1
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.auth_sessions WHERE token_hash = p_session AND expires_at > clock_timestamp()) THEN
    RAISE EXCEPTION 'Session expired' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE FUNCTION public.owner_special_access_read(p_session text, p_code text) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_catalog AS $$
DECLARE
  s public.auth_sessions%ROWTYPE;
  a public.members%ROWTYPE;
  m public.members%ROWTYPE;
  sa public.owner_special_access%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public.auth_sessions WHERE token_hash = p_session FOR SHARE;
  SELECT * INTO a FROM public.members WHERE id = s.member_id FOR SHARE;
  IF s.id IS NULL OR s.mode IS DISTINCT FROM 'NORMAL' OR s.revoked_at IS NOT NULL
  OR s.expires_at IS NULL OR s.expires_at <= clock_timestamp()
  OR a.id IS NULL OR a.status = 'SUSPENDED' OR a.role NOT IN ('ADMIN', 'OWNER') THEN
    RAISE EXCEPTION 'Normal live staff session required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO m FROM public.members WHERE member_code = p_code;
  IF m.id IS NULL THEN
    RAISE EXCEPTION 'Member not found' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO sa FROM public.owner_special_access WHERE member_id = m.id;
  IF NOT EXISTS (SELECT 1 FROM public.auth_sessions WHERE token_hash = p_session AND expires_at > clock_timestamp()) THEN
    RAISE EXCEPTION 'Session expired' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'active', COALESCE(sa.active, false),
    'expiresAt', sa.expires_at,
    'dailySlot', sa.daily_slot,
    'note', sa.note,
    'version', COALESCE(sa.version, 0),
    'updatedAt', sa.updated_at
  );
END $$;

CREATE FUNCTION public.owner_special_access_write(p_session text, p_key uuid, p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_catalog AS $$
DECLARE
  s public.auth_sessions%ROWTYPE;
  a public.members%ROWTYPE;
  m public.members%ROWTYPE;
  target_id integer;
  prior public.owner_special_access_audit%ROWTYPE;
  cur public.owner_special_access%ROWTYPE;
  cur_ver integer;
  act text;
  slot_val text;
  exp_val timestamptz;
  note_val text;
  reason_txt text;
  digest text;
  before_json jsonb;
  after_json jsonb;
  t timestamptz;
BEGIN
  IF p_key IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Invalid special access request' USING ERRCODE = '22023';
  END IF;
  act := p_payload->>'action';
  IF act IS NULL OR act NOT IN ('SET', 'REVOKE')
  OR jsonb_typeof(p_payload->'memberCode') IS DISTINCT FROM 'string'
  OR length(p_payload->>'memberCode') NOT BETWEEN 1 AND 50
  OR jsonb_typeof(p_payload->'reason') IS DISTINCT FROM 'string'
  OR length(btrim(p_payload->>'reason')) NOT BETWEEN 1 AND 240
  OR jsonb_typeof(p_payload->'expectedVersion') IS DISTINCT FROM 'number'
  OR (p_payload->>'expectedVersion') !~ '^(0|[1-9][0-9]{0,9})$'
  OR (p_payload->>'expectedVersion')::numeric > 2147483646 THEN
    RAISE EXCEPTION 'Invalid special access request' USING ERRCODE = '22023';
  END IF;

  IF act = 'SET' THEN
    IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_payload) k)
       IS DISTINCT FROM ARRAY['action', 'dailySlot', 'expectedVersion', 'expiresAt', 'memberCode', 'note', 'reason']::text[]
    OR jsonb_typeof(p_payload->'dailySlot') IS DISTINCT FROM 'string'
    OR NOT public.package_catalog_daily_slot_valid(p_payload->>'dailySlot')
    OR jsonb_typeof(p_payload->'note') IS DISTINCT FROM 'string'
    OR length(btrim(p_payload->>'note')) NOT BETWEEN 1 AND 240
    OR jsonb_typeof(p_payload->'expiresAt') NOT IN ('null', 'string') THEN
      RAISE EXCEPTION 'Invalid special access request' USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(p_payload->'expiresAt') = 'string' THEN
      BEGIN
        exp_val := (p_payload->>'expiresAt')::timestamptz;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Invalid expiry timestamp' USING ERRCODE = '22023';
      END;
      IF exp_val IS NULL OR NOT isfinite(exp_val) THEN
        RAISE EXCEPTION 'Invalid expiry timestamp' USING ERRCODE = '22023';
      END IF;
    ELSE
      exp_val := NULL;
    END IF;
    slot_val := p_payload->>'dailySlot';
    note_val := btrim(p_payload->>'note');
  ELSE
    IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_payload) k)
       IS DISTINCT FROM ARRAY['action', 'expectedVersion', 'memberCode', 'reason']::text[] THEN
      RAISE EXCEPTION 'Invalid special access revoke request' USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT * INTO s FROM public.auth_sessions WHERE token_hash = p_session FOR SHARE;
  IF s.id IS NULL OR s.mode IS DISTINCT FROM 'NORMAL' OR s.revoked_at IS NOT NULL
  OR s.expires_at IS NULL OR s.expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'Normal live OWNER session required' USING ERRCODE = '42501';
  END IF;
  SELECT id INTO target_id FROM public.members WHERE member_code = p_payload->>'memberCode';
  PERFORM id FROM public.members WHERE id IN (s.member_id, target_id) ORDER BY id FOR UPDATE;
  SELECT * INTO a FROM public.members WHERE id = s.member_id;
  SELECT * INTO m FROM public.members WHERE id = target_id;
  IF a.id IS NULL OR a.status = 'SUSPENDED' OR a.role IS DISTINCT FROM 'OWNER' THEN
    RAISE EXCEPTION 'OWNER only' USING ERRCODE = '42501';
  END IF;
  IF m.id IS NULL THEN
    RAISE EXCEPTION 'Member not found' USING ERRCODE = 'P0001';
  END IF;

  digest := encode(sha256(convert_to(p_payload::text, 'UTF8')), 'hex');
  SELECT * INTO prior FROM public.owner_special_access_audit WHERE actor_id = a.id AND request_key = p_key;
  IF FOUND THEN
    IF prior.payload_hash <> digest THEN
      RAISE EXCEPTION 'Special access request conflict' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    SELECT * INTO cur FROM public.owner_special_access WHERE member_id = m.id FOR UPDATE;
    cur_ver := COALESCE(cur.version, 0);
    IF cur_ver <> (p_payload->>'expectedVersion')::integer THEN
      RAISE EXCEPTION 'Special access version conflict' USING ERRCODE = 'P0001';
    END IF;
    t := clock_timestamp();
    reason_txt := btrim(p_payload->>'reason');
    before_json := CASE WHEN cur.member_id IS NOT NULL THEN jsonb_build_object(
      'active', cur.active, 'expiresAt', cur.expires_at, 'dailySlot', cur.daily_slot, 'note', cur.note
    ) ELSE NULL END;

    IF act = 'SET' THEN
      INSERT INTO public.owner_special_access(member_id, active, expires_at, daily_slot, note, version, updated_by, updated_at)
      VALUES (m.id, true, exp_val, slot_val, note_val, cur_ver + 1, a.id, t)
      ON CONFLICT (member_id) DO UPDATE
        SET active = true,
            expires_at = excluded.expires_at,
            daily_slot = excluded.daily_slot,
            note = excluded.note,
            version = excluded.version,
            updated_by = excluded.updated_by,
            updated_at = excluded.updated_at
      RETURNING * INTO cur;
    ELSE
      IF cur.member_id IS NULL OR NOT cur.active THEN
        RAISE EXCEPTION 'No active special access to revoke' USING ERRCODE = 'P0001';
      END IF;
      UPDATE public.owner_special_access
        SET active = false, version = cur_ver + 1, updated_by = a.id, updated_at = t
        WHERE member_id = m.id
        RETURNING * INTO cur;
    END IF;

    after_json := jsonb_build_object(
      'active', cur.active, 'expiresAt', cur.expires_at, 'dailySlot', cur.daily_slot, 'note', cur.note
    );
    INSERT INTO public.owner_special_access_audit(
      actor_id, member_id, request_key, payload_hash, action,
      before_state, after_state, reason, before_version, after_version
    ) VALUES (
      a.id, m.id, p_key, digest, act,
      before_json, after_json, reason_txt, cur_ver, cur_ver + 1
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.auth_sessions WHERE token_hash = p_session AND expires_at > clock_timestamp()) THEN
    RAISE EXCEPTION 'Session expired' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object('ok', true);
END $$;

DO $patch_admission$
DECLARE
  signature text;
  ddl text;
  r record;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.kiosk_checkin(text,text,uuid,text)',
    'public.real_frontdesk_checkin(text,text,uuid,text)'
  ] LOOP
    ddl := replace(pg_get_functiondef(signature::regprocedure), chr(13), '');
    FOR r IN SELECT * FROM (VALUES
      ('staff_slot text;', 'staff_slot text; sa public.owner_special_access%ROWTYPE;'),
      ($old$ ELSIF local_time < time '07:00' OR local_time > time '22:00' THEN reason:='CLOSED';
  ELSE
   SELECT id INTO c FROM coupons$old$,
       $new$ ELSE
   SELECT * INTO sa FROM public.owner_special_access
    WHERE member_id=m.id AND active AND (expires_at IS NULL OR expires_at>t);
   IF sa.member_id IS NOT NULL THEN
    term_kind:='OWNER_SPECIAL'; term_id:=NULL; staff_slot:=sa.daily_slot;
    snapshot:=jsonb_build_object('name','สิทธิ์พิเศษ (OWNER)','timeSlot',sa.daily_slot,'expiresAt',sa.expires_at,'note',sa.note);
    IF public.package_catalog_slot_allows(staff_slot,local_time) THEN reason:='PAID_ENTRY'; used_slot:=staff_slot;
    ELSE reason:='OFF_PEAK'; END IF;
   ELSIF local_time < time '07:00' OR local_time > time '22:00' THEN reason:='CLOSED';
   ELSE
    SELECT id INTO c FROM coupons$new$),
      ($old$   END IF;
  END IF;
 END IF;
 IF reason IN ('PAID_ENTRY','FREE_ENTRY') THEN$old$,
       $new$   END IF;
   END IF;
  END IF;
 END IF;
 IF reason IN ('PAID_ENTRY','FREE_ENTRY') THEN$new$),
      ($old$WHEN term_kind='STAFF_TRANSFER' THEN 'STAFF_TRANSFER_ENTRY term=STAFF_TRANSFER:'||term_id::text
               ELSE reason||COALESCE(' coupon='||c::text,'') END$old$,
       $new$WHEN term_kind='STAFF_TRANSFER' THEN 'STAFF_TRANSFER_ENTRY term=STAFF_TRANSFER:'||term_id::text
               WHEN term_kind='OWNER_SPECIAL' THEN 'OWNER_SPECIAL_ENTRY'
               ELSE reason||COALESCE(' coupon='||c::text,'') END$new$),
      ($old$    'orderId',CASE WHEN term_kind IN ('STAFF_FREE','STAFF_TRANSFER') THEN NULL ELSE online_order END,
    'packageSource',CASE WHEN term_kind IN ('STAFF_FREE','STAFF_TRANSFER') THEN term_kind ELSE 'ONLINE_PAID' END,$old$,
       $new$    'orderId',CASE WHEN term_kind IN ('STAFF_FREE','STAFF_TRANSFER','OWNER_SPECIAL') THEN NULL ELSE online_order END,
    'packageSource',CASE WHEN term_kind IN ('STAFF_FREE','STAFF_TRANSFER','OWNER_SPECIAL') THEN term_kind ELSE 'ONLINE_PAID' END,$new$)
    ) v(anchor, replacement) LOOP
      IF length(ddl) - length(replace(ddl, r.anchor, '')) <> length(r.anchor) THEN
        RAISE EXCEPTION 'Unexpected admission anchor in %: %', signature, r.anchor;
      END IF;
      ddl := replace(ddl, r.anchor, r.replacement);
    END LOOP;
    EXECUTE ddl;
  END LOOP;
END $patch_admission$;

REVOKE ALL ON TABLE public.member_categories, public.member_category_audit,
  public.owner_special_access, public.owner_special_access_audit FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.member_category_audit_id_seq,
  public.owner_special_access_audit_id_seq FROM PUBLIC;
REVOKE ALL ON FUNCTION public.member_extension_audit_immutable(),
  public.member_category_read(text,text),
  public.member_category_update(text,uuid,jsonb),
  public.owner_special_access_read(text,text),
  public.owner_special_access_write(text,uuid,jsonb) FROM PUBLIC;

SELECT r4_staff_private.assert_writer_stack();
SELECT r4_online_private.assert_cancellation_stack();
COMMIT;

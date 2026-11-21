-- Combined R7 single-station kiosk AUTO IN/OUT migration (same-day Bangkok visit pairing).
-- Requires 20261202_R347_admission_compatibility.sql applied.
BEGIN;
SET LOCAL search_path = public, pg_catalog;
SET LOCAL lock_timeout = '5s';

SELECT 'public.r7_kiosk_scan(text,text,uuid,text,text)'::regprocedure;

-- Allow at most one open visit per member per Bangkok calendar day;
-- forgotten exits from earlier days remain NULL (unknown duration) without blocking new-day entry.
DROP INDEX IF EXISTS public.r7_one_open_visit;
CREATE UNIQUE INDEX r7_one_open_visit
  ON public.r7_visits (member_id, ((entered_at AT TIME ZONE 'Asia/Bangkok')::date))
  WHERE exited_at IS NULL;

ALTER TABLE public.r7_kiosk_scan_requests
  DROP CONSTRAINT IF EXISTS r7_kiosk_scan_requests_direction_check;
ALTER TABLE public.r7_kiosk_scan_requests
  ADD CONSTRAINT r7_kiosk_scan_requests_direction_check CHECK (direction IN ('IN', 'OUT', 'AUTO'));

DO $patch$
DECLARE
  signature text;
  definition text;
  anchor constant text := $old$ ELSIF EXISTS(SELECT FROM r7_visits WHERE member_id=m.id AND exited_at IS NULL) THEN reason:='ALREADY_IN';$old$;
  replacement constant text := $new$ ELSIF EXISTS(SELECT FROM r7_visits WHERE member_id=m.id AND exited_at IS NULL AND (entered_at AT TIME ZONE 'Asia/Bangkok')::date=(t AT TIME ZONE 'Asia/Bangkok')::date) THEN reason:='ALREADY_IN';$new$;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.kiosk_checkin(text,text,uuid,text)',
    'public.real_frontdesk_checkin(text,text,uuid,text)'
  ] LOOP
    definition := replace(pg_get_functiondef(signature::regprocedure), chr(13), '');
    IF length(definition) - length(replace(definition, anchor, '')) <> length(anchor) THEN
      RAISE EXCEPTION 'Unexpected admission anchor in %', signature;
    END IF;
    EXECUTE replace(definition, anchor, replacement);
  END LOOP;
END $patch$;

CREATE OR REPLACE FUNCTION public.r7_visit_action(p_session text, p_station text, p_key uuid, p_code text, p_direction text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_catalog AS $$
DECLARE
  s auth_sessions%ROWTYPE;
  staff members%ROWTYPE;
  m members%ROWTYPE;
  prior r7_visit_requests%ROWTYPE;
  v r7_visits%ROWTYPE;
  payload jsonb;
  result jsonb;
  t timestamptz;
BEGIN
  SELECT * INTO s FROM auth_sessions WHERE token_hash = p_session FOR SHARE;
  SELECT * INTO staff FROM members WHERE id = s.member_id FOR SHARE;
  IF s.id IS NULL OR s.mode IS DISTINCT FROM 'NORMAL' OR s.revoked_at IS NOT NULL OR s.expires_at IS NULL OR s.expires_at <= clock_timestamp()
  OR staff.id IS NULL OR staff.role NOT IN ('ADMIN', 'OWNER') OR staff.status = 'SUSPENDED' THEN
    RAISE EXCEPTION 'Normal staff session required' USING ERRCODE = '42501';
  END IF;
  IF p_key IS NULL OR p_code IS NULL OR p_code !~ '^BLU-[0-9]{1,12}$' OR p_direction IS NULL OR p_direction NOT IN ('IN', 'OUT')
  OR p_station IS NULL THEN
    RAISE EXCEPTION 'Invalid visit request' USING ERRCODE = '22023';
  END IF;
  payload := jsonb_build_object('code', p_code, 'direction', p_direction, 'station', p_station);
  PERFORM pg_advisory_xact_lock(hashtextextended('r7-request:' || staff.id || ':' || p_key, 0));
  SELECT * INTO prior FROM r7_visit_requests WHERE actor_id = staff.id AND request_key = p_key;
  IF FOUND THEN
    IF prior.payload <> payload THEN
      RAISE EXCEPTION 'Request key reused' USING ERRCODE = '22023';
    END IF;
    RETURN prior.result;
  END IF;
  SELECT * INTO m FROM members WHERE member_code = p_code FOR UPDATE;
  t := clock_timestamp();
  IF s.expires_at <= t THEN
    RAISE EXCEPTION 'Session expired' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v FROM r7_visits
   WHERE member_id = m.id AND exited_at IS NULL
     AND (entered_at AT TIME ZONE 'Asia/Bangkok')::date = (t AT TIME ZONE 'Asia/Bangkok')::date
   ORDER BY entered_at DESC LIMIT 1 FOR UPDATE;
  IF m.id IS NULL THEN
    result := jsonb_build_object('ok', false, 'reason', 'NOT_FOUND');
  ELSIF p_direction = 'OUT' THEN
    IF v.id IS NULL THEN
      result := jsonb_build_object('ok', false, 'reason', 'NO_OPEN_VISIT');
    ELSE
      UPDATE r7_visits SET exited_at = t, exit_actor = staff.id WHERE id = v.id;
      result := jsonb_build_object('ok', true, 'reason', 'EXIT', 'visitId', v.id, 'checkedAt', t);
    END IF;
  ELSIF v.id IS NOT NULL THEN
    result := jsonb_build_object('ok', false, 'reason', 'ALREADY_IN', 'visitId', v.id);
  ELSE
    -- Actor-scoped inner key avoids collisions with legacy station-scoped requests.
    result := real_frontdesk_checkin(p_session, p_station || ':R7:' || staff.id, p_key, p_code);
    IF coalesce((result->>'ok')::boolean, false) THEN
      IF result->>'visitId' IS NULL THEN
        RAISE EXCEPTION 'Unexpected legacy inner admission receipt' USING ERRCODE = '22023';
      END IF;
    END IF;
  END IF;
  INSERT INTO r7_visit_requests(actor_id, request_key, payload, result) VALUES(staff.id, p_key, payload, result);
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.r7_kiosk_scan(p_session text, p_station text, p_key uuid, p_code text, p_direction text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_catalog AS $$
DECLARE
  s auth_sessions%ROWTYPE;
  staff members%ROWTYPE;
  m members%ROWTYPE;
  prior r7_kiosk_scan_requests%ROWTYPE;
  old_card member_card_scan_requests%ROWTYPE;
  v r7_visits%ROWTYPE;
  result jsonb;
  t timestamptz;
  is_card boolean;
  member_info jsonb;
BEGIN
  IF p_key IS NULL OR p_station IS NULL OR length(p_station) NOT BETWEEN 1 AND 200
  OR p_code IS NULL OR p_code !~ '^(BLU-[0-9]{1,12}|CARD-[0-9]{1,95})$'
  OR p_direction IS NULL OR p_direction NOT IN ('IN', 'OUT', 'AUTO') THEN
    RAISE EXCEPTION 'Invalid kiosk scan' USING ERRCODE = '22023';
  END IF;
  is_card := p_code LIKE 'CARD-%';
  -- Match the existing card lookup/rebind lock order, including when delegating IN.
  IF is_card THEN
    PERFORM pg_advisory_xact_lock(724192, 2);
  END IF;
  SELECT * INTO s FROM auth_sessions WHERE token_hash = p_session FOR SHARE;
  SELECT * INTO staff FROM members WHERE id = s.member_id FOR SHARE;
  IF s.id IS NULL OR s.mode IS DISTINCT FROM 'KIOSK' OR s.device_id IS DISTINCT FROM p_station
  OR s.revoked_at IS NOT NULL OR s.expires_at IS NULL OR s.expires_at <= clock_timestamp()
  OR staff.id IS NULL OR staff.role NOT IN ('ADMIN', 'OWNER') OR staff.status = 'SUSPENDED' THEN
    RAISE EXCEPTION 'Kiosk required' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('kiosk-request:' || p_station || ':' || p_key::text, 0));
  SELECT * INTO prior FROM r7_kiosk_scan_requests WHERE station = p_station AND request_key = p_key;
  IF FOUND THEN
    IF (prior.code, prior.direction) IS DISTINCT FROM (p_code, p_direction) THEN
      RAISE EXCEPTION 'Kiosk request key reused' USING ERRCODE = '22023';
    END IF;
    result := prior.result;
  ELSE
    -- Preserve card replay before resolution, including after rebind or a prior NOT_FOUND.
    SELECT * INTO old_card FROM member_card_scan_requests
     WHERE actor_id = staff.id AND station = p_station AND channel = 'KIOSK' AND request_key = p_key;
    IF FOUND THEN
      IF p_direction <> 'IN' OR old_card.payload IS DISTINCT FROM jsonb_build_object('code', p_code, 'direction', NULL) THEN
        RAISE EXCEPTION 'Kiosk request key reused' USING ERRCODE = '22023';
      END IF;
      result := old_card.result;
    ELSIF EXISTS(SELECT FROM kiosk_requests WHERE station = p_station AND request_key = p_key
                 AND (is_card OR p_direction IN ('OUT', 'AUTO') OR member_code <> p_code)) THEN
      RAISE EXCEPTION 'Kiosk request key reused' USING ERRCODE = '22023';
    ELSIF p_direction = 'IN' THEN
      IF is_card THEN
        result := member_card_admit(p_session, p_station, p_key, p_code, NULL);
      ELSE
        result := kiosk_checkin(p_session, p_station, p_key, p_code);
      END IF;
    ELSIF p_direction = 'AUTO' THEN
      IF is_card THEN
        SELECT mbr.* INTO m FROM member_cards c JOIN members mbr ON mbr.id = c.member_id
         WHERE c.card_code = p_code FOR UPDATE OF mbr;
      ELSE
        SELECT * INTO m FROM members WHERE member_code = p_code FOR UPDATE;
      END IF;
      t := clock_timestamp();
      IF m.id IS NULL THEN
        result := jsonb_build_object('ok', false, 'reason', 'NOT_FOUND', 'member', NULL);
      ELSE
        member_info := jsonb_build_object('name', m.full_name, 'photo', m.avatar_url);
        SELECT * INTO v FROM r7_visits
         WHERE member_id = m.id AND exited_at IS NULL
           AND (entered_at AT TIME ZONE 'Asia/Bangkok')::date = (t AT TIME ZONE 'Asia/Bangkok')::date
         ORDER BY entered_at DESC LIMIT 1 FOR UPDATE;
        IF v.id IS NOT NULL THEN
          IF t < v.entered_at + interval '60 seconds' THEN
            result := jsonb_build_object('ok', false, 'reason', 'BOUNCE', 'visitId', v.id, 'checkedAt', t, 'member', member_info);
          ELSE
            -- OUT is not admission: an expired or suspended member may still close an open same-day visit.
            UPDATE r7_visits SET exited_at = t, exit_actor = staff.id WHERE id = v.id;
            result := jsonb_build_object('ok', true, 'reason', 'EXIT', 'visitId', v.id, 'checkedAt', t, 'member', member_info);
          END IF;
        ELSIF EXISTS(SELECT FROM r7_visits WHERE member_id = m.id AND exited_at > t - interval '10 seconds') THEN
          result := jsonb_build_object('ok', false, 'reason', 'BOUNCE', 'checkedAt', t, 'member', member_info);
        ELSIF is_card THEN
          result := member_card_admit(p_session, p_station, p_key, p_code, NULL);
        ELSE
          result := kiosk_checkin(p_session, p_station, p_key, p_code);
        END IF;
      END IF;
    ELSE
      IF is_card THEN
        SELECT mbr.* INTO m FROM member_cards c JOIN members mbr ON mbr.id = c.member_id
         WHERE c.card_code = p_code FOR UPDATE OF mbr;
      ELSE
        SELECT * INTO m FROM members WHERE member_code = p_code FOR UPDATE;
      END IF;
      SELECT * INTO v FROM r7_visits
       WHERE member_id = m.id AND exited_at IS NULL
         AND (entered_at AT TIME ZONE 'Asia/Bangkok')::date = (clock_timestamp() AT TIME ZONE 'Asia/Bangkok')::date
       ORDER BY entered_at DESC LIMIT 1 FOR UPDATE;
      t := clock_timestamp();
      member_info := CASE WHEN m.id IS NOT NULL THEN jsonb_build_object('name', m.full_name, 'photo', m.avatar_url) ELSE NULL END;
      IF m.id IS NULL THEN
        result := jsonb_build_object('ok', false, 'reason', 'NOT_FOUND', 'member', NULL);
      ELSIF v.id IS NULL THEN
        result := jsonb_build_object('ok', false, 'reason', 'NO_OPEN_VISIT', 'member', member_info);
      ELSIF t < v.entered_at + interval '3 seconds' THEN
        result := jsonb_build_object('ok', false, 'reason', 'BOUNCE', 'member', member_info);
      ELSE
        UPDATE r7_visits SET exited_at = t, exit_actor = staff.id WHERE id = v.id;
        result := jsonb_build_object('ok', true, 'reason', 'EXIT', 'visitId', v.id, 'checkedAt', t, 'member', member_info);
      END IF;
    END IF;
    INSERT INTO r7_kiosk_scan_requests(station, request_key, code, direction, actor_id, result)
     VALUES(p_station, p_key, p_code, p_direction, staff.id, result);
  END IF;
  IF s.expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'Session expired' USING ERRCODE = '42501';
  END IF;
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.r7_visit_action(text, text, uuid, text, text),
  public.r7_kiosk_scan(text, text, uuid, text, text) FROM PUBLIC;

SELECT r4_staff_private.assert_writer_stack();
SELECT r4_online_private.assert_cancellation_stack();
COMMIT;

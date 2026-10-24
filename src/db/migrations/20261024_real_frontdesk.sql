-- PREPARED ONLY: apply after 20261024_kiosk.sql. No session conversion.
-- Shared request/bounce tables preserve station-wide replay and bounce protection.
CREATE OR REPLACE FUNCTION real_frontdesk_checkin(p_session text,p_station text,p_key uuid,p_code text)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
DECLARE s auth_sessions%ROWTYPE; staff members%ROWTYPE; m members%ROWTYPE; prior kiosk_requests%ROWTYPE;
 slot text; reason text; c integer; visit integer; t timestamptz; local_time time; result jsonb;
BEGIN
 -- Hold the session until commit: entering/exiting/revoking cannot race this write.
 SELECT * INTO s FROM auth_sessions WHERE token_hash=p_session FOR SHARE;
 -- FOR SHARE (not KEY SHARE) blocks role/status updates until this transaction ends.
 SELECT * INTO staff FROM members WHERE id=s.member_id FOR SHARE;
 IF s.id IS NULL OR s.mode<>'NORMAL' OR s.revoked_at IS NOT NULL OR s.expires_at<=clock_timestamp()
 OR staff.id IS NULL OR staff.role NOT IN ('ADMIN','OWNER') OR staff.status='SUSPENDED' THEN
 RAISE EXCEPTION 'Normal admin session required' USING ERRCODE='42501'; END IF;
 -- Separate statements after locks intentionally get fresh READ COMMITTED snapshots.
 PERFORM pg_advisory_xact_lock(hashtextextended('kiosk-request:'||p_station||':'||p_key::text,0));
 SELECT * INTO prior FROM kiosk_requests WHERE station=p_station AND request_key=p_key;
 IF FOUND THEN
  IF prior.member_code<>p_code THEN RAISE EXCEPTION 'Request key reused'; END IF;
  RETURN prior.result;
 END IF;
 SELECT * INTO m FROM members WHERE member_code=p_code FOR UPDATE;
 t:=clock_timestamp(); local_time:=(t AT TIME ZONE 'Asia/Bangkok')::time;
 reason:='NO_ENTITLEMENT';
 IF m.id IS NULL THEN reason:='NOT_FOUND';
 ELSIF m.status='SUSPENDED' THEN reason:='SUSPENDED';
 ELSIF EXISTS(SELECT 1 FROM kiosk_member_bounce WHERE station=p_station AND member_id=m.id AND accepted_at>t-interval '3 seconds') THEN reason:='BOUNCE';
 ELSIF local_time < time '07:00' OR local_time > time '22:00' THEN reason:='CLOSED';
 ELSE
  SELECT package_snapshot->>'timeSlot' INTO slot FROM package_payment_orders
   WHERE member_id=m.id AND status='PAID' ORDER BY paid_at DESC NULLS LAST,created_at DESC,id DESC LIMIT 1;
  IF m.status='ACTIVE' AND m.expire_date>t AND slot IN ('07:00-14:00','07:00-22:00') THEN
   IF slot='07:00-14:00' AND local_time>time '14:00' THEN reason:='OFF_PEAK';
   ELSE reason:='PAID_ENTRY'; END IF;
  ELSE
   SELECT id INTO c FROM coupons WHERE member_id=m.id AND source='WELCOME_REGISTRATION' AND type='FREE_ENTRY'
    AND status='AVAILABLE' AND total_quota=1 AND used_count=0 AND created_at<=t
    AND created_at+interval '30 days'>t AND expire_date>t ORDER BY id LIMIT 1 FOR UPDATE;
   IF c IS NOT NULL THEN
    UPDATE coupons SET used_count=1,status='USED' WHERE id=c;
    reason:='FREE_ENTRY';
   END IF;
  END IF;
 END IF;
 IF reason IN ('PAID_ENTRY','FREE_ENTRY') THEN
  INSERT INTO checkins(member_id,scanner_type,scanner_device_id,points_awarded,notes)
   VALUES(m.id,'HARDWARE_USB',p_station,0,'FRONTDESK ENTRY_ONLY '||reason||COALESCE(' coupon='||c::text,'')) RETURNING id INTO visit;
  INSERT INTO kiosk_member_bounce VALUES(p_station,m.id,t)
   ON CONFLICT(station,member_id) DO UPDATE SET accepted_at=excluded.accepted_at;
 END IF;
 result:=jsonb_build_object('ok',visit IS NOT NULL,'reason',reason,'checkinId',visit,'checkedAt',t,
  'member',CASE WHEN m.id IS NOT NULL THEN jsonb_build_object('name',m.full_name,'photo',m.avatar_url) ELSE NULL END);
 INSERT INTO kiosk_requests(station,request_key,member_code,result) VALUES(p_station,p_key,p_code,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION real_frontdesk_checkin(text,text,uuid,text) FROM PUBLIC;

-- PREPARED ONLY. Do not auto-apply. Requires auth_sessions and package_payment_orders migrations.
-- No backfill: legacy payments and browser records are deliberately NOT imported.
-- Application DB credentials are trusted; do not expose them to browsers.
BEGIN;
CREATE TABLE finance_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 entry_date date NOT NULL CHECK(entry_date BETWEEN DATE '2000-01-01' AND DATE '2100-12-31'),
 type text NOT NULL CHECK(type IN ('INCOME','EXPENSE')),
 category text NOT NULL,
 amount_satang bigint NOT NULL CHECK(amount_satang BETWEEN 1 AND 1000000000),
 note text NOT NULL CHECK(length(btrim(note)) BETWEEN 1 AND 500),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 deleted_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((type='INCOME' AND category='รายได้อื่น (ไม่ใช่แพ็กเกจ)') OR
 (type='EXPENSE' AND category IN ('รายจ่ายประจำเดือน','อุปกรณ์','เงินเดือน','รายจ่ายอื่น')))
);
CREATE TABLE finance_action_requests (
 actor_id integer NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
 request_key uuid NOT NULL, action text NOT NULL, payload jsonb NOT NULL, result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(actor_id,request_key)
);
CREATE TABLE finance_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 actor_id integer NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
 request_key uuid NOT NULL, action text NOT NULL CHECK(action IN ('create','update','delete')),
 entry_id uuid NOT NULL REFERENCES finance_entries(id) ON DELETE RESTRICT,
 before_value jsonb, after_value jsonb NOT NULL, reason text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(actor_id,request_key)
);
CREATE INDEX finance_entries_date_idx ON finance_entries(entry_date) WHERE deleted_at IS NULL;
CREATE FUNCTION real_finance_action(p_session text,p_action text,p_key uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
DECLARE s auth_sessions%ROWTYPE; actor members%ROWTYPE; e finance_entries%ROWTYPE;
 prior finance_action_requests%ROWTYPE; old_value jsonb; result jsonb;
BEGIN
 SELECT * INTO s FROM auth_sessions WHERE token_hash=p_session FOR SHARE;
 -- Serialize each owner's requests; entry row locks below also protect edits by different owners.
 SELECT * INTO actor FROM members WHERE id=s.member_id FOR UPDATE;
 IF s.id IS NULL OR s.mode<>'NORMAL' OR s.revoked_at IS NOT NULL OR s.expires_at<=clock_timestamp()
 OR actor.id IS NULL OR actor.status='SUSPENDED' OR actor.role<>'OWNER' THEN
 RAISE EXCEPTION 'Owner session required' USING ERRCODE='42501'; END IF;
 IF p_action NOT IN ('read','create','update','delete') OR p_action IS NULL THEN
 RAISE EXCEPTION 'Invalid action' USING ERRCODE='22023'; END IF;
 IF p_action='read' THEN
 SELECT jsonb_build_object('records',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.date DESC,x.id) FROM (
 SELECT id::text,entry_date::text AS date,type,category,amount_satang::numeric/100 AS amount,note,
 'MANUAL'::text AS source,created_at AS "createdAt",version,NULL::text AS "memberCode",NULL::text AS "memberName"
 FROM finance_entries WHERE deleted_at IS NULL
 UNION ALL
 SELECT 'package:'||o.id::text,(o.paid_at AT TIME ZONE 'Asia/Bangkok')::date::text,'INCOME','แพ็กเกจ',
 o.amount_satang::numeric/100,COALESCE(o.package_snapshot->>'name','แพ็กเกจ')||' · '||o.id::text,
 'MEMBERSHIP',o.created_at,0,m.member_code,m.full_name
 FROM package_payment_orders o JOIN members m ON m.id=o.member_id WHERE o.status='PAID' AND o.paid_at IS NOT NULL
 ) x),'[]'::jsonb),'audit',COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id DESC) FROM (
 SELECT id,actor_id AS "actorId",action,entry_id AS "entryId",before_value AS before,after_value AS after,
 reason,created_at AS "createdAt" FROM finance_audit ORDER BY id DESC
 ) a),'[]'::jsonb)) INTO result;
 RETURN result;
 END IF;
 IF p_key IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN
 RAISE EXCEPTION 'Invalid request' USING ERRCODE='22023'; END IF;
 SELECT * INTO prior FROM finance_action_requests WHERE actor_id=actor.id AND request_key=p_key;
 IF FOUND THEN
 IF prior.action<>p_action OR prior.payload<>p_payload THEN RAISE EXCEPTION 'Request key reused' USING ERRCODE='22023'; END IF;
 RETURN prior.result;
 END IF;
 IF p_action<>'create' THEN
 SELECT * INTO e FROM finance_entries WHERE id=(p_payload->>'id')::uuid FOR UPDATE;
 IF e.id IS NULL OR e.deleted_at IS NOT NULL OR e.version IS DISTINCT FROM (p_payload->>'version')::integer THEN
 RAISE EXCEPTION 'Entry changed or unavailable' USING ERRCODE='P0001'; END IF;
 old_value:=to_jsonb(e);
 END IF;
 IF p_action='delete' THEN
 IF length(btrim(COALESCE(p_payload->>'reason',''))) NOT BETWEEN 1 AND 500 THEN
 RAISE EXCEPTION 'Reason required' USING ERRCODE='22023'; END IF;
 UPDATE finance_entries SET deleted_at=clock_timestamp(),version=version+1 WHERE id=e.id RETURNING * INTO e;
 ELSE
 IF jsonb_typeof(p_payload->'amountSatang') IS DISTINCT FROM 'number'
 OR (p_payload->>'amountSatang')::numeric<>trunc((p_payload->>'amountSatang')::numeric)
 OR p_payload->>'date' IS NULL OR p_payload->>'type' IS NULL OR p_payload->>'category' IS NULL OR p_payload->>'note' IS NULL THEN
 RAISE EXCEPTION 'Invalid entry' USING ERRCODE='22023'; END IF;
 IF p_action='create' THEN
 INSERT INTO finance_entries(entry_date,type,category,amount_satang,note)
 VALUES((p_payload->>'date')::date,p_payload->>'type',p_payload->>'category',(p_payload->>'amountSatang')::bigint,p_payload->>'note') RETURNING * INTO e;
 ELSE
 UPDATE finance_entries SET entry_date=(p_payload->>'date')::date,type=p_payload->>'type',category=p_payload->>'category',
 amount_satang=(p_payload->>'amountSatang')::bigint,note=p_payload->>'note',version=version+1 WHERE id=e.id RETURNING * INTO e;
 END IF;
 END IF;
 result:=jsonb_build_object('id',e.id,'version',e.version);
 INSERT INTO finance_audit(actor_id,request_key,action,entry_id,before_value,after_value,reason)
 VALUES(actor.id,p_key,p_action,e.id,old_value,to_jsonb(e),COALESCE(p_payload->>'reason',p_payload->>'note'));
 INSERT INTO finance_action_requests(actor_id,request_key,action,payload,result) VALUES(actor.id,p_key,p_action,p_payload,result);
 RETURN result;
END $$;
-- Invoker security: never SECURITY DEFINER; only trusted application DB role should call this function.
REVOKE ALL ON FUNCTION real_finance_action(text,text,uuid,jsonb) FROM PUBLIC;
COMMIT;

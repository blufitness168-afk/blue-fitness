-- Prepared only, after October finance (R5 categories optional). Does not replace any reader or writer.
BEGIN;
CREATE SCHEMA r5_finance_private;
REVOKE ALL ON SCHEMA r5_finance_private FROM PUBLIC;
CREATE TABLE r5_finance_private.import_batches (
  id uuid PRIMARY KEY,
  actor_id integer NOT NULL REFERENCES public.members(id) ON DELETE RESTRICT,
  rows jsonb NOT NULL,
  confirmed_non_lifecycle boolean NOT NULL CHECK (confirmed_non_lifecycle),
  receipt jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE r5_finance_private.import_rows (
  source_ref text PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES r5_finance_private.import_batches(id) ON DELETE RESTRICT,
  csv_line integer NOT NULL,
  entry_id uuid NOT NULL UNIQUE REFERENCES public.finance_entries(id) ON DELETE RESTRICT,
  audit_id bigint NOT NULL UNIQUE REFERENCES public.finance_audit(id) ON DELETE RESTRICT,
  UNIQUE (batch_id, csv_line)
);
REVOKE ALL ON r5_finance_private.import_batches, r5_finance_private.import_rows FROM PUBLIC;

CREATE FUNCTION public.r5_finance_import(p_session text, p_action text, p_key uuid, p_rows jsonb, p_attested boolean)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE
  s public.auth_sessions%ROWTYPE; actor public.members%ROWTYPE; e public.finance_entries%ROWTYPE;
  prior r5_finance_private.import_batches%ROWTYPE; r jsonb; issues jsonb := '[]';
  n integer := 1; d date; kind text; cat text; amount bigint; memo text; ref text;
  code text; matched boolean; has_staff boolean; has_refunds boolean; r5_categories boolean;
  today_bkk date; income bigint := 0; expense bigint := 0; receipt jsonb; aid bigint;
BEGIN
  SELECT * INTO s FROM public.auth_sessions WHERE token_hash=p_session FOR SHARE;
  SELECT * INTO actor FROM public.members WHERE id=s.member_id FOR SHARE;
  IF s.id IS NULL OR s.mode IS DISTINCT FROM 'NORMAL' OR s.revoked_at IS NOT NULL
     OR s.expires_at IS NULL OR s.expires_at<=clock_timestamp() OR actor.id IS NULL
     OR actor.status IS NULL OR actor.status='SUSPENDED' OR actor.role IS DISTINCT FROM 'OWNER' THEN
    RAISE EXCEPTION 'Owner session required' USING ERRCODE='42501';
  END IF;
  IF p_action IS NULL OR p_action NOT IN ('preview','commit') OR p_key IS NULL
     OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR (p_action='commit' AND p_attested IS DISTINCT FROM true) THEN
    RAISE EXCEPTION 'Invalid import request' USING ERRCODE='22023';
  END IF;
  IF jsonb_array_length(p_rows) NOT BETWEEN 1 AND 200 OR octet_length(p_rows::text)>524288 THEN
    RAISE EXCEPTION 'Import limit exceeded' USING ERRCODE='22023';
  END IF;
  IF p_action='commit' THEN
    IF current_setting('transaction_isolation') <> 'read committed' THEN
      RAISE EXCEPTION 'Import needs Read Committed' USING ERRCODE='0A000';
    END IF;
    -- Serialize imports and fence concurrent manual writes during the duplicate check and insert.
    LOCK TABLE public.finance_entries IN SHARE ROW EXCLUSIVE MODE NOWAIT;
  END IF;
  SELECT * INTO prior FROM r5_finance_private.import_batches WHERE id=p_key;
  IF FOUND THEN
    IF prior.actor_id<>actor.id OR prior.rows<>p_rows THEN
      RAISE EXCEPTION 'Import request key reused' USING ERRCODE='22023';
    END IF;
    RETURN jsonb_build_object('receipt',prior.receipt);
  END IF;

  has_staff := to_regclass('r4_staff_private.finance_source') IS NOT NULL;
  has_refunds := to_regclass('r4_online_private.finance_refunds') IS NOT NULL;
  IF p_action='commit' THEN
    -- Fence the reviewed lifecycle sources only for the short commit window. Do not wait on settlement writers.
    LOCK TABLE public.package_payment_orders IN SHARE MODE NOWAIT;
    IF has_staff THEN EXECUTE 'LOCK TABLE r4_staff_private.finance_source IN SHARE MODE NOWAIT'; END IF;
    IF has_refunds THEN EXECUTE 'LOCK TABLE r4_online_private.finance_refunds IN SHARE MODE NOWAIT'; END IF;
  END IF;
  SELECT EXISTS(SELECT FROM pg_constraint WHERE conrelid='public.finance_entries'::regclass
     AND conname='finance_entries_r5_category_check') INTO r5_categories;
  today_bkk := (clock_timestamp() AT TIME ZONE 'Asia/Bangkok')::date;

  FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    n := n+1; code := NULL;
    ref := r->>'ref'; kind := r->>'type'; cat := r->>'category'; memo := r->>'note';
    IF jsonb_typeof(r) IS DISTINCT FROM 'object' OR r->'line' IS DISTINCT FROM to_jsonb(n)
       OR (r - ARRAY['line','ref','date','type','category','amountSatang','note']) <> '{}'::jsonb THEN code := 'csv';
    ELSIF jsonb_typeof(r->'ref') IS DISTINCT FROM 'string' OR ref !~ '^[A-Z0-9][A-Z0-9._-]{0,79}$' THEN code := 'reference';
    ELSIF jsonb_typeof(r->'date') IS DISTINCT FROM 'string' OR (r->>'date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN code := 'date';
    ELSIF kind IS NULL OR cat IS NULL OR NOT ((kind='INCOME' AND cat='รายได้อื่น (ไม่ใช่แพ็กเกจ)') OR
          (kind='EXPENSE' AND cat IN ('รายจ่ายประจำเดือน','อุปกรณ์','เงินเดือน','รายจ่ายอื่น','คอมมิชชัน','ค่าเสื่อม'))) THEN code := 'category';
    ELSIF NOT r5_categories AND cat IN ('คอมมิชชัน','ค่าเสื่อม') THEN code := 'category_unavailable';
    ELSIF jsonb_typeof(r->'amountSatang') IS DISTINCT FROM 'number' OR (r->>'amountSatang') !~ '^[0-9]{1,10}$' THEN code := 'amount';
    ELSIF jsonb_typeof(r->'note') IS DISTINCT FROM 'string' OR char_length(memo) NOT BETWEEN 1 AND 500
       OR btrim(memo)<>memo OR memo ~ '[[:cntrl:]]' THEN code := 'note';
    ELSE
      amount := (r->>'amountSatang')::bigint;
      BEGIN
        d := (r->>'date')::date;
        IF d < DATE '2000-01-01' OR d > DATE '2100-12-31' OR d >= today_bkk THEN code := 'historical_date'; END IF;
      EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN code := 'date';
      END;
      IF amount NOT BETWEEN 1 AND 1000000000 THEN code := 'amount'; END IF;
      IF code IS NULL THEN
        IF EXISTS (SELECT FROM jsonb_array_elements(p_rows) q WHERE q->>'ref'=ref AND q->'line'<>to_jsonb(n))
           OR EXISTS (SELECT FROM r5_finance_private.import_rows ir WHERE ir.source_ref=ref) THEN code := 'duplicate_reference';
        ELSIF EXISTS (SELECT FROM jsonb_array_elements(p_rows) q WHERE q->'line'<>to_jsonb(n)
              AND (q - ARRAY['line','ref']) = (r - ARRAY['line','ref'])) THEN code := 'duplicate_content';
        ELSIF EXISTS (SELECT FROM public.finance_entries fe WHERE (fe.entry_date,fe.type,fe.category,fe.amount_satang,fe.note)=(d,kind,cat,amount,memo))
           OR EXISTS (SELECT FROM public.finance_audit a WHERE a.action='create'
             AND a.after_value @> jsonb_build_object('entry_date',to_char(d,'YYYY-MM-DD'),'type',kind,'category',cat,'amount_satang',amount,'note',memo)) THEN code := 'manual_match';
        ELSIF kind='INCOME' AND EXISTS (SELECT FROM public.package_payment_orders o
          WHERE o.status='PAID' AND o.amount_satang=amount AND
          (d IN ((o.paid_at AT TIME ZONE 'Asia/Bangkok')::date,(o.confirmed_at AT TIME ZONE 'Asia/Bangkok')::date)
           OR (o.paid_at IS NULL AND o.confirmed_at IS NULL))) THEN code := 'lifecycle_match'; END IF;
        IF code IS NULL AND has_staff THEN
          EXECUTE 'SELECT EXISTS (SELECT FROM r4_staff_private.finance_source WHERE entry_date=$1 AND type=$2 AND amount_satang=$3)'
            INTO matched USING d,kind,amount;
          IF matched THEN code := 'lifecycle_match'; END IF;
        END IF;
        IF code IS NULL AND has_refunds AND kind='EXPENSE' THEN
          EXECUTE 'SELECT EXISTS (SELECT FROM r4_online_private.finance_refunds WHERE entry_date=$1 AND amount_satang=$2)'
            INTO matched USING d,amount;
          IF matched THEN code := 'lifecycle_match'; END IF;
        END IF;
      END IF;
    END IF;
    IF code IS NOT NULL THEN issues:=issues||jsonb_build_array(jsonb_build_object('line',n,'code',code));
    ELSIF kind='INCOME' THEN income:=income+amount;
    ELSE expense:=expense+amount;
    END IF;
  END LOOP;

  IF jsonb_array_length(issues)>0 OR p_action='preview' THEN RETURN jsonb_build_object('issues',issues); END IF;
  receipt := jsonb_build_object('batchId',p_key,'count',n-1,'incomeSatang',income,'expenseSatang',expense);
  INSERT INTO r5_finance_private.import_batches(id,actor_id,rows,confirmed_non_lifecycle,receipt)
  VALUES(p_key,actor.id,p_rows,p_attested,receipt);
  FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    INSERT INTO public.finance_entries(entry_date,type,category,amount_satang,note)
    VALUES((r->>'date')::date,r->>'type',r->>'category',(r->>'amountSatang')::bigint,r->>'note') RETURNING * INTO e;
    INSERT INTO public.finance_audit(actor_id,request_key,action,entry_id,after_value,reason)
    VALUES(actor.id,gen_random_uuid(),'create',e.id,to_jsonb(e),'Historical CSV · '||p_key||' · '||(r->>'ref'))
    RETURNING id INTO aid;
    INSERT INTO r5_finance_private.import_rows(source_ref,batch_id,csv_line,entry_id,audit_id)
    VALUES(r->>'ref',p_key,(r->>'line')::integer,e.id,aid);
  END LOOP;
  RETURN jsonb_build_object('receipt',receipt);
END $$;
REVOKE ALL ON FUNCTION public.r5_finance_import(text,text,uuid,jsonb,boolean) FROM PUBLIC;
COMMIT;

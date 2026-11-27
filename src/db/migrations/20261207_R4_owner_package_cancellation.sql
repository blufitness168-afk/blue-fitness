-- PREPARE ONLY. Apply after 20261125_R4_online_cancellation.sql and its R4-first prerequisites.
-- Permit the OWNER account itself as a cancellation target; all evidence/refund guards remain unchanged.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL search_path=pg_catalog;

DO $migration$
DECLARE p oid; d text;
 old_anchor text; new_anchor text;
BEGIN
 p:=to_regprocedure('public.r3_override_current_order(integer,timestamptz)');
 old_anchor:=$old$m.role='MEMBER'$old$; new_anchor:=$new$m.role IN ('MEMBER','OWNER')$new$;
 IF p IS NULL OR NOT EXISTS(SELECT FROM pg_proc WHERE oid=p AND NOT prosecdef AND provolatile='s'
   AND prorettype='public.package_payment_orders'::regtype) THEN
  RAISE EXCEPTION 'Expected reviewed R3 current-order proof' USING ERRCODE='0A000'; END IF;
 d:=replace(pg_get_functiondef(p),chr(13),'');
 IF length(d)-length(replace(d,old_anchor,''))<>length(old_anchor) THEN
  RAISE EXCEPTION 'Unexpected R3 role proof guard' USING ERRCODE='0A000'; END IF;
 EXECUTE replace(d,old_anchor,new_anchor);

 p:=to_regprocedure('r4_online_private.cancel_online_order(text,uuid,uuid,integer,text,boolean)');
 old_anchor:=$old$m.role IS DISTINCT FROM 'MEMBER'$old$; new_anchor:=$new$m.role NOT IN ('MEMBER','OWNER')$new$;
 IF p IS NULL OR NOT EXISTS(SELECT FROM pg_proc WHERE oid=p AND NOT prosecdef AND provolatile='v'
   AND prorettype='jsonb'::regtype AND prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql')) THEN
  RAISE EXCEPTION 'Expected reviewed online cancellation writer' USING ERRCODE='0A000'; END IF;
 d:=replace(pg_get_functiondef(p),chr(13),'');
 IF length(d)-length(replace(d,old_anchor,''))<>length(old_anchor) THEN
  RAISE EXCEPTION 'Unexpected online cancellation target guard' USING ERRCODE='0A000'; END IF;
 EXECUTE replace(d,old_anchor,new_anchor);
END $migration$;
COMMIT;

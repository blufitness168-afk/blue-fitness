-- Incremental fix only: retain the installed finalizer and all later auth/ACL changes.
-- No historical orders/evidence/ledgers are rewritten. Apply in one transaction.
BEGIN;
DO $migration$
DECLARE signature regprocedure := to_regprocedure('public.finalize_package_payment(uuid,integer,text,uuid)');
 body text; original text;
 old_guard constant text := 'AND a.evidence->>''bankCode''=''004''';
 new_guard constant text := 'AND (o.receiver_snapshot->>''bankCode'') ~ ''^[0-9]{3}$''';
BEGIN
 IF signature IS NULL THEN RAISE EXCEPTION 'Payment finalizer prerequisite missing'; END IF;
 SELECT pg_get_functiondef(signature) INTO original;
 IF position(old_guard in original)=0 OR (length(original)-length(replace(original,old_guard,'')))/length(old_guard)<>1
 OR position('mode = ''NORMAL''' in original)=0
 OR position('search_path TO ''public'', ''pg_catalog''' in original)=0 THEN
   RAISE EXCEPTION 'Unexpected finalizer baseline; review before migration';
 END IF;
 -- Top-level evidence bankCode and identity bankCode must still equal the immutable
 -- order snapshot. This replaces only the obsolete KBank-only allow condition.
 body:=replace(original,old_guard,new_guard);
 EXECUTE body;
 IF pg_get_functiondef(signature) IS DISTINCT FROM body THEN RAISE EXCEPTION 'Unexpected finalizer rewrite'; END IF;
END $migration$;
COMMIT;

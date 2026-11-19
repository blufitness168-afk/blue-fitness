-- PREPARE ONLY: apply separately after review. No provider calls or data rewrite.
BEGIN;
ALTER TABLE members ADD COLUMN avatar_version integer NOT NULL DEFAULT 0 CHECK(avatar_version>=0);
CREATE FUNCTION staff_avatar_version() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.avatar_url IS DISTINCT FROM OLD.avatar_url OR NEW.avatar_changed IS DISTINCT FROM OLD.avatar_changed THEN
  NEW.avatar_version:=OLD.avatar_version+1;
 ELSE NEW.avatar_version:=OLD.avatar_version; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER staff_avatar_version BEFORE UPDATE ON members FOR EACH ROW EXECUTE FUNCTION staff_avatar_version();
CREATE TABLE staff_avatar_requests (
 actor_id integer NOT NULL REFERENCES members(id), request_key uuid NOT NULL,
 member_id integer NOT NULL REFERENCES members(id), payload jsonb NOT NULL,
 public_id text NOT NULL UNIQUE, lease uuid NOT NULL, lease_until timestamptz NOT NULL,
 attempts integer NOT NULL DEFAULT 1, completed boolean NOT NULL DEFAULT false,
 PRIMARY KEY(actor_id,request_key)
);
CREATE TABLE staff_avatar_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 actor_id integer NOT NULL REFERENCES members(id), actor_role text NOT NULL,
 member_id integer NOT NULL REFERENCES members(id), request_key uuid NOT NULL,
 reason text NOT NULL, content_hash text NOT NULL, public_id text NOT NULL,
 before_url text, after_url text NOT NULL, before_version integer NOT NULL, after_version integer NOT NULL,
 source text NOT NULL DEFAULT 'STAFF_UPLOAD' CHECK(source='STAFF_UPLOAD'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(actor_id,request_key)
);
CREATE FUNCTION staff_avatar_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN RAISE EXCEPTION 'Avatar audit is append-only'; END $$;
CREATE TRIGGER staff_avatar_audit_guard BEFORE UPDATE OR DELETE OR TRUNCATE ON staff_avatar_audit
 FOR EACH STATEMENT EXECUTE FUNCTION staff_avatar_immutable();
CREATE FUNCTION staff_avatar_target(p_session text,p_code text) RETURNS integer LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE s public.auth_sessions%ROWTYPE; a public.members%ROWTYPE; m public.members%ROWTYPE; target integer;
BEGIN
 SELECT * INTO s FROM public.auth_sessions WHERE token_hash=p_session FOR SHARE;
 IF s.id IS NULL OR s.mode IS DISTINCT FROM 'NORMAL' OR s.revoked_at IS NOT NULL OR s.expires_at IS NULL OR s.expires_at<=clock_timestamp() THEN
  RAISE EXCEPTION 'Live session required' USING ERRCODE='42501'; END IF;
 SELECT id INTO target FROM public.members WHERE member_code=p_code;
 PERFORM id FROM public.members WHERE id IN (s.member_id,target) ORDER BY id FOR UPDATE;
 SELECT * INTO a FROM public.members WHERE id=s.member_id;
 SELECT * INTO m FROM public.members WHERE id=target;
 IF a.id IS NULL OR a.status='SUSPENDED' OR NOT coalesce((a.role='ADMIN' AND m.role='MEMBER') OR (a.role='OWNER' AND m.role IN ('MEMBER','ADMIN')),false) THEN
  RAISE EXCEPTION 'Target denied' USING ERRCODE='42501'; END IF;
 IF s.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Expired' USING ERRCODE='42501'; END IF;
 RETURN target;
END $$;
CREATE FUNCTION staff_avatar_read(p_session text,p_code text) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE target integer; result jsonb;
BEGIN
 target:=public.staff_avatar_target(p_session,p_code);
 SELECT jsonb_build_object('avatarUrl',m.avatar_url,'version',m.avatar_version,'source',
 CASE WHEN EXISTS(SELECT 1 FROM public.staff_avatar_audit a WHERE a.member_id=m.id AND a.after_version=m.avatar_version AND a.after_url=m.avatar_url) THEN 'STAFF_UPLOAD' ELSE 'LEGACY' END)
 INTO result FROM public.members m WHERE id=target;
 RETURN result;
END $$;
CREATE FUNCTION staff_avatar_claim(p_session text,p_key uuid,p_payload jsonb,p_lease uuid) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE target integer; actor integer; r public.staff_avatar_requests%ROWTYPE;
BEGIN
 IF p_key IS NULL OR p_lease IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid' USING ERRCODE='22023'; END IF;
 IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_payload) k) IS DISTINCT FROM ARRAY['contentHash','expectedVersion','memberCode','mime','reason']::text[]
 OR jsonb_typeof(p_payload->'memberCode') IS DISTINCT FROM 'string' OR length(p_payload->>'memberCode') NOT BETWEEN 1 AND 50
 OR jsonb_typeof(p_payload->'reason') IS DISTINCT FROM 'string' OR length(btrim(p_payload->>'reason')) NOT BETWEEN 1 AND 240
 OR jsonb_typeof(p_payload->'contentHash') IS DISTINCT FROM 'string' OR p_payload->>'contentHash' !~ '^[a-f0-9]{64}$'
 OR jsonb_typeof(p_payload->'mime') IS DISTINCT FROM 'string' OR p_payload->>'mime' NOT IN ('image/jpeg','image/png','image/webp')
 OR jsonb_typeof(p_payload->'expectedVersion') IS DISTINCT FROM 'number' OR p_payload->>'expectedVersion' !~ '^(0|[1-9][0-9]{0,9})$'
 OR (p_payload->>'expectedVersion')::numeric>2147483646 THEN RAISE EXCEPTION 'Invalid' USING ERRCODE='22023'; END IF;
 -- Serialize actor keys before locking targets; the same key cannot acquire different targets.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_session||p_key::text,72131));
 target:=public.staff_avatar_target(p_session,p_payload->>'memberCode');
 SELECT member_id INTO actor FROM public.auth_sessions WHERE token_hash=p_session;
 INSERT INTO public.staff_avatar_requests(actor_id,request_key,member_id,payload,public_id,lease,lease_until)
 VALUES(actor,p_key,target,p_payload,'blue-fitness/staff-avatars/'||target||'/'||actor||'/'||p_key,p_lease,clock_timestamp()+interval '90 seconds') ON CONFLICT DO NOTHING;
 SELECT * INTO r FROM public.staff_avatar_requests WHERE actor_id=actor AND request_key=p_key FOR UPDATE;
 IF r.payload<>p_payload OR r.member_id<>target THEN RAISE EXCEPTION 'Key conflict' USING ERRCODE='P0001'; END IF;
 IF r.completed THEN RETURN jsonb_build_object('done',true); END IF;
 IF (SELECT avatar_version FROM public.members WHERE id=target)<>(p_payload->>'expectedVersion')::integer THEN RAISE EXCEPTION 'Stale' USING ERRCODE='P0001'; END IF;
 IF r.lease<>p_lease THEN
  IF r.lease_until>clock_timestamp() THEN RAISE EXCEPTION 'In progress' USING ERRCODE='P0001'; END IF;
  UPDATE public.staff_avatar_requests SET lease=p_lease,lease_until=clock_timestamp()+interval '90 seconds',attempts=attempts+1 WHERE actor_id=actor AND request_key=p_key RETURNING * INTO r;
 END IF;
 RETURN jsonb_build_object('done',false,'publicId',r.public_id,'recover',r.attempts>1);
END $$;
CREATE FUNCTION staff_avatar_finish(p_session text,p_code text,p_key uuid,p_lease uuid,p_url text) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE target integer; actor integer; r public.staff_avatar_requests%ROWTYPE; m public.members%ROWTYPE; role_value text;
BEGIN
 target:=public.staff_avatar_target(p_session,p_code);
 SELECT s.member_id,a.role::text INTO actor,role_value FROM public.auth_sessions s JOIN public.members a ON a.id=s.member_id WHERE s.token_hash=p_session;
 SELECT * INTO r FROM public.staff_avatar_requests WHERE actor_id=actor AND request_key=p_key FOR UPDATE;
 IF r.member_id IS DISTINCT FROM target THEN RAISE EXCEPTION 'Unknown request' USING ERRCODE='P0001'; END IF;
 IF r.completed THEN RETURN jsonb_build_object('ok',true); END IF;
 IF r.lease IS DISTINCT FROM p_lease OR p_url IS NULL OR p_url !~ ('^https://res[.]cloudinary[.]com/[a-z0-9_-]+/image/upload/v[0-9]+/'||r.public_id||'[.](jpg|png|webp)$') THEN RAISE EXCEPTION 'Invalid asset' USING ERRCODE='22023'; END IF;
 SELECT * INTO m FROM public.members WHERE id=target;
 IF m.avatar_version<>(r.payload->>'expectedVersion')::integer THEN RAISE EXCEPTION 'Stale' USING ERRCODE='P0001'; END IF;
 UPDATE public.members SET avatar_url=p_url,avatar_changed=true,updated_at=clock_timestamp() WHERE id=target;
 INSERT INTO public.staff_avatar_audit(actor_id,actor_role,member_id,request_key,reason,content_hash,public_id,before_url,after_url,before_version,after_version)
 VALUES(actor,role_value,target,p_key,btrim(r.payload->>'reason'),r.payload->>'contentHash',r.public_id,m.avatar_url,p_url,m.avatar_version,m.avatar_version+1);
 UPDATE public.staff_avatar_requests SET completed=true WHERE actor_id=actor AND request_key=p_key;
 IF NOT EXISTS(SELECT 1 FROM public.auth_sessions WHERE token_hash=p_session AND expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'Expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON staff_avatar_requests,staff_avatar_audit FROM PUBLIC;
REVOKE ALL ON SEQUENCE staff_avatar_audit_id_seq FROM PUBLIC;
REVOKE ALL ON FUNCTION staff_avatar_version(),staff_avatar_immutable(),staff_avatar_target(text,text),staff_avatar_read(text,text),staff_avatar_claim(text,uuid,jsonb,uuid),staff_avatar_finish(text,text,uuid,uuid,text) FROM PUBLIC;
COMMIT;

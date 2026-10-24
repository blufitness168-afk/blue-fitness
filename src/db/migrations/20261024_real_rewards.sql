-- PREPARED ONLY: review and apply manually after auth + kiosk migrations.
-- stock is remaining inventory (not total inventory). No historical balance backfill.
BEGIN;
ALTER TABLE redemptions ADD COLUMN request_key uuid;
ALTER TABLE redemptions ADD COLUMN reward_code uuid;
ALTER TABLE redemptions ADD COLUMN reward_title text;
ALTER TABLE redemptions ADD COLUMN completed_at timestamptz;
ALTER TABLE redemptions ADD COLUMN completed_by integer REFERENCES members(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX rewards_redemption_request_idx ON redemptions(member_id, request_key);
CREATE UNIQUE INDEX rewards_redemption_code_idx ON redemptions(reward_code);
CREATE INDEX rewards_redemption_member_idx ON redemptions(member_id, redeemed_at DESC);
CREATE TABLE reward_point_spend_ledger (
 redemption_id integer PRIMARY KEY REFERENCES redemptions(id) ON DELETE RESTRICT,
 member_id integer NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
 request_key uuid NOT NULL,
 delta integer NOT NULL CHECK(delta < 0),
 balance_after integer NOT NULL CHECK(balance_after >= 0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(member_id, request_key)
);
CREATE TABLE reward_action_requests (
 actor_id integer NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
 request_key uuid NOT NULL, action text NOT NULL, payload jsonb NOT NULL,
 result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(actor_id, request_key)
);

CREATE FUNCTION real_rewards_action(p_session text, p_action text, p_key uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
DECLARE s auth_sessions%ROWTYPE; actor members%ROWTYPE; target members%ROWTYPE;
 r rewards%ROWTYPE; d redemptions%ROWTYPE; prior reward_action_requests%ROWTYPE;
 result jsonb; balance integer; cost integer; quantity integer; title_value text; image_value text;
BEGIN
 SELECT * INTO s FROM auth_sessions WHERE token_hash=p_session FOR SHARE;
 -- Every rewards operation locks actor first, including reads, avoiding lock upgrades.
 SELECT * INTO actor FROM members WHERE id=s.member_id FOR UPDATE;
 IF s.id IS NULL OR s.mode <> 'NORMAL' OR s.revoked_at IS NOT NULL OR s.expires_at <= clock_timestamp()
 OR actor.id IS NULL OR actor.status='SUSPENDED' THEN
 RAISE EXCEPTION 'Unauthorized' USING ERRCODE='42501'; END IF;
 IF p_action NOT IN ('member','admin','redeem','deliver','save') THEN
 RAISE EXCEPTION 'Invalid action' USING ERRCODE='22023'; END IF;
 IF p_action IN ('admin','deliver','save') AND actor.role NOT IN ('ADMIN','OWNER') THEN
 RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 IF p_action IN ('member','admin') THEN
 SELECT jsonb_build_object('points',actor.points,'memberCode',actor.member_code,'fullName',actor.full_name,
 'rewards',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM
 (SELECT id,title,description,image_url AS "imageUrl",point_cost AS "pointCost",stock,is_active AS "isActive"
 FROM rewards WHERE p_action='admin' OR is_active) x),'[]'::jsonb),
 'redemptions',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id DESC) FROM
 (SELECT history.id,history.reward_id AS "rewardId",COALESCE(history.reward_title,catalog.title) AS "rewardTitle",
 history.reward_code AS "rewardCode",history.points_spent AS "pointsSpent",history.status,history.redeemed_at AS "redeemedAt",
 history.completed_at AS "completedAt",m.member_code AS "memberCode",m.full_name AS "memberName"
 FROM redemptions history JOIN rewards catalog ON catalog.id=history.reward_id JOIN members m ON m.id=history.member_id
 WHERE p_action='admin' OR history.member_id=actor.id) x),'[]'::jsonb)) INTO result;
 RETURN result;
 END IF;
 IF p_key IS NULL THEN RAISE EXCEPTION 'Request UUID required' USING ERRCODE='22023'; END IF;
 SELECT * INTO prior FROM reward_action_requests WHERE actor_id=actor.id AND request_key=p_key;
 IF FOUND THEN
 IF prior.action<>p_action OR prior.payload<>p_payload THEN
 RAISE EXCEPTION 'Request key reused' USING ERRCODE='22023'; END IF;
 RETURN prior.result;
 END IF;
 IF p_action='redeem' THEN
 SELECT * INTO r FROM rewards WHERE id=(p_payload->>'rewardId')::integer FOR UPDATE;
 IF r.id IS NULL OR NOT r.is_active OR r.stock<=0 OR r.point_cost<=0 THEN
 RAISE EXCEPTION 'Reward unavailable' USING ERRCODE='P0001'; END IF;
 IF actor.points<r.point_cost THEN RAISE EXCEPTION 'Insufficient points' USING ERRCODE='P0001'; END IF;
 UPDATE members SET points=points-r.point_cost,updated_at=clock_timestamp() WHERE id=actor.id RETURNING points INTO balance;
 UPDATE rewards SET stock=stock-1 WHERE id=r.id;
 INSERT INTO redemptions(member_id,reward_id,points_spent,status,request_key,reward_code,reward_title)
 VALUES(actor.id,r.id,r.point_cost,'PENDING',p_key,gen_random_uuid(),r.title) RETURNING * INTO d;
 INSERT INTO reward_point_spend_ledger(redemption_id,member_id,request_key,delta,balance_after)
 VALUES(d.id,actor.id,p_key,-r.point_cost,balance);
 result:=jsonb_build_object('id',d.id,'rewardCode',d.reward_code,'points',balance,'status',d.status);
 ELSIF p_action='deliver' THEN
 -- Lock recipient before redemption; suspended recipients cannot receive rewards.
 SELECT m.* INTO target FROM members m JOIN redemptions history ON history.member_id=m.id
 WHERE history.reward_code=(p_payload->>'rewardCode')::uuid FOR UPDATE OF m;
 IF target.id IS NULL OR target.status='SUSPENDED' THEN
 RAISE EXCEPTION 'Recipient unavailable' USING ERRCODE='P0001'; END IF;
 SELECT * INTO d FROM redemptions WHERE reward_code=(p_payload->>'rewardCode')::uuid FOR UPDATE;
 IF d.status='PENDING' THEN
 UPDATE redemptions SET status='COMPLETED',completed_at=clock_timestamp(),completed_by=actor.id
 WHERE id=d.id RETURNING * INTO d;
 ELSIF d.status<>'COMPLETED' THEN RAISE EXCEPTION 'Invalid redemption status' USING ERRCODE='P0001'; END IF;
 result:=jsonb_build_object('id',d.id,'status',d.status,'completedAt',d.completed_at);
 ELSE
 title_value:=btrim(p_payload->>'title'); cost:=(p_payload->>'pointCost')::integer;
 quantity:=(p_payload->>'stock')::integer; image_value:=NULLIF(p_payload->>'imageUrl','');
 IF title_value IS NULL OR length(title_value) NOT BETWEEN 1 AND 120 OR cost IS NULL OR cost NOT BETWEEN 1 AND 1000000
 OR quantity IS NULL OR quantity NOT BETWEEN 0 AND 1000000 OR jsonb_typeof(p_payload->'isActive') IS DISTINCT FROM 'boolean'
 OR (image_value IS NOT NULL AND image_value !~ '^https://[^[:space:]]+$') THEN
 RAISE EXCEPTION 'Invalid reward' USING ERRCODE='22023'; END IF;
 IF p_payload->>'id' IS NULL THEN
 INSERT INTO rewards(title,description,image_url,point_cost,stock,is_active)
 VALUES(title_value,p_payload->>'description',image_value,cost,quantity,(p_payload->>'isActive')::boolean) RETURNING * INTO r;
 ELSE
 SELECT * INTO r FROM rewards WHERE id=(p_payload->>'id')::integer FOR UPDATE;
 IF r.id IS NULL THEN RAISE EXCEPTION 'Reward not found' USING ERRCODE='P0001'; END IF;
 -- Compare entire editable snapshot; never overwrite stock consumed since the form opened.
 IF jsonb_build_object('id',r.id,'title',r.title,'description',r.description,'imageUrl',r.image_url,
 'pointCost',r.point_cost,'stock',r.stock,'isActive',r.is_active) IS DISTINCT FROM p_payload->'expected' THEN
 RAISE EXCEPTION 'Reward changed; reload first' USING ERRCODE='P0001'; END IF;
 UPDATE rewards SET title=title_value,description=p_payload->>'description',image_url=image_value,
 point_cost=cost,stock=quantity,is_active=(p_payload->>'isActive')::boolean WHERE id=r.id RETURNING * INTO r;
 END IF;
 result:=jsonb_build_object('id',r.id);
 END IF;
 INSERT INTO reward_action_requests(actor_id,request_key,action,payload,result) VALUES(actor.id,p_key,p_action,p_payload,result);
 RETURN result;
END $$;
-- Invoker function: deploy with the trusted runtime DB owner role, as with kiosk/payments.
-- A separate runtime role needs an explicit, deployment-specific EXECUTE grant.
REVOKE ALL ON FUNCTION real_rewards_action(text,text,uuid,jsonb) FROM PUBLIC;
COMMIT;

-- Narrow OAuth capabilities; a ChatGPT token is never a Supabase session JWT.
-- Private definer functions are intentional: they validate a hashed capability
-- or auth.uid()+live session, then expose only fixed aggregate/read/write verbs.
-- Public RPC wrappers are invokers. No service key, arbitrary SQL, user_id input,
-- raw record JSON, or general-purpose database permission is given to ChatGPT.
create schema if not exists yeoni_connector;
revoke all on schema yeoni_connector from public, anon, authenticated;
grant usage on schema yeoni_connector to anon, authenticated;

create table yeoni_connector.grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references auth.sessions(id) on delete cascade,
  client_id text not null,
  resource text not null,
  scopes text[] not null,
  areas text[] not null,
  code_hash text unique not null,
  challenge text not null,
  code_expires_at timestamptz not null default clock_timestamp()+interval '5 minutes',
  code_used_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default clock_timestamp()+interval '30 days',
  revoked_at timestamptz,
  window_at timestamptz not null default clock_timestamp(),
  window_calls integer not null default 0
);
create index grants_owner_idx on yeoni_connector.grants(user_id,created_at desc);
create index grants_session_idx on yeoni_connector.grants(session_id);
create table yeoni_connector.tokens (
  token_hash text primary key,
  grant_id uuid not null references yeoni_connector.grants(id) on delete cascade,
  kind text not null check(kind in ('access','refresh')),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index tokens_grant_idx on yeoni_connector.tokens(grant_id);
create table yeoni_connector.snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  grant_id uuid not null references yeoni_connector.grants(id) on delete cascade,
  area text not null,
  summary jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
create index snapshots_owner_idx on yeoni_connector.snapshots(user_id,created_at desc);
create index snapshots_grant_idx on yeoni_connector.snapshots(grant_id);
create table public.chatgpt_advice (
  user_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null,
  payload_hash text not null,
  title text not null check(length(title) between 1 and 120),
  body text not null check(length(body) between 1 and 6000),
  area text not null check(area in ('assistant','fitness','diet','language','budget')),
  summary jsonb not null,
  snapshot_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key(user_id,id)
);
create index chatgpt_advice_owner_created_idx on public.chatgpt_advice(user_id,created_at desc,id);
alter table public.chatgpt_advice enable row level security;
revoke all on public.chatgpt_advice from public, anon, authenticated;
grant select,delete on public.chatgpt_advice to authenticated;
grant all on public.chatgpt_advice to service_role;
create policy owner_read on public.chatgpt_advice for select to authenticated using((select auth.uid())=user_id);
create policy owner_delete on public.chatgpt_advice for delete to authenticated using((select auth.uid())=user_id);
alter table yeoni_connector.grants enable row level security;
alter table yeoni_connector.tokens enable row level security;
alter table yeoni_connector.snapshots enable row level security;
revoke all on all tables in schema yeoni_connector from public,anon,authenticated;

create function yeoni_connector.hash(p_value text) returns text language sql immutable security invoker set search_path='' as $$
  select encode(sha256(convert_to(p_value,'UTF8')),'hex');
$$;
create function yeoni_connector.secret(p_prefix text) returns text language sql volatile security invoker set search_path='' as $$
  select p_prefix||replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
$$;
create function yeoni_connector.live_session(p_session uuid,p_user uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from auth.sessions s join auth.users u on u.id=s.user_id
    where s.id=p_session and s.user_id=p_user and (s.not_after is null or s.not_after>now())
    and u.deleted_at is null and (u.banned_until is null or u.banned_until<now()) and not coalesce(u.is_anonymous,false));
$$;

create function yeoni_connector.authorize(p_resource text,p_client text,p_scopes text[],p_areas text[],p_challenge text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); session_id uuid:=(auth.jwt()->>'session_id')::uuid; code text; grant_id uuid;
begin
  if owner_id is null or not yeoni_connector.live_session(session_id,owner_id) then raise exception '로그인을 다시 확인해 주세요.' using errcode='42501'; end if;
  if p_client is distinct from 'https://chatgpt.com/oauth/client.json'
    or p_resource is null or p_resource not in ('https://ai-fitness-app-git-fix-app-wide-reliability-jace3695s-projects.vercel.app/mcp','http://127.0.0.1:3000/mcp')
    or coalesce(cardinality(p_scopes),0) not between 1 and 3
    or not p_scopes <@ array['yeoni:records:read','yeoni:advice:read','yeoni:advice:write']
    or array_position(p_scopes,null) is not null
    or coalesce(cardinality(p_areas),0) not between 1 and 5
    or not p_areas <@ array['assistant','fitness','diet','language','budget'] or array_position(p_areas,null) is not null
    or p_challenge is null or p_challenge !~ '^[A-Za-z0-9_-]{43}$' then raise exception '잘못된 연결 요청입니다.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('app-record-reset:'||owner_id::text,0));
  -- Keep bounded, temporary connection metadata. Advice lives separately.
  delete from yeoni_connector.grants where user_id=owner_id and expires_at<clock_timestamp();
  if (select count(*) from yeoni_connector.grants where user_id=owner_id)>100 then raise exception '연결 요청이 많습니다. 잠시 후 다시 시도해 주세요.'; end if;
  update yeoni_connector.grants set revoked_at=clock_timestamp() where user_id=owner_id and client_id=p_client and resource=p_resource and revoked_at is null;
  code:=yeoni_connector.secret('yc_');
  insert into yeoni_connector.grants(user_id,session_id,client_id,resource,scopes,areas,code_hash,challenge)
    values(owner_id,session_id,p_client,p_resource,p_scopes,p_areas,yeoni_connector.hash(code),p_challenge) returning id into grant_id;
  return jsonb_build_object('code',code,'connection_id',grant_id);
end;
$$;

create function yeoni_connector.exchange(p_kind text,p_credential text,p_client text,p_resource text,p_verifier text,p_redirect text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare g yeoni_connector.grants; t yeoni_connector.tokens; a text; r text; challenge text;
begin
  if p_kind is null or p_kind not in ('authorization_code','refresh_token') or length(coalesce(p_credential,'')) not between 30 and 200
    or p_client is distinct from 'https://chatgpt.com/oauth/client.json' then return jsonb_build_object('error','invalid_grant'); end if;
  if p_kind='authorization_code' then
    select * into g from yeoni_connector.grants where code_hash=yeoni_connector.hash(p_credential) for update;
  else
    select * into t from yeoni_connector.tokens where token_hash=yeoni_connector.hash(p_credential) and kind='refresh';
    if not found then return jsonb_build_object('error','invalid_grant'); end if;
    select * into g from yeoni_connector.grants where id=t.grant_id for update;
    -- Reread after the grant lock: concurrent refreshes cannot both succeed.
    select * into t from yeoni_connector.tokens where token_hash=t.token_hash;
  end if;
  if g.id is null or g.resource is distinct from p_resource or g.client_id is distinct from p_client or g.revoked_at is not null
    or g.expires_at<=clock_timestamp() or not yeoni_connector.live_session(g.session_id,g.user_id) then return jsonb_build_object('error','invalid_grant'); end if;
  if p_kind='authorization_code' then
    if p_redirect is distinct from 'https://chatgpt.com/connector_platform_oauth_redirect' or length(coalesce(p_verifier,'')) not between 43 and 128 or p_verifier !~ '^[A-Za-z0-9._~-]+$' then return jsonb_build_object('error','invalid_grant'); end if;
    challenge:=translate(rtrim(encode(sha256(convert_to(p_verifier,'UTF8')),'base64'),'='),'+/','-_');
    if challenge<>g.challenge or g.code_expires_at<=clock_timestamp() then return jsonb_build_object('error','invalid_grant'); end if;
    if g.code_used_at is not null then
      update yeoni_connector.grants set revoked_at=clock_timestamp() where id=g.id;
      return jsonb_build_object('error','invalid_grant');
    end if;
    update yeoni_connector.grants set code_used_at=clock_timestamp() where id=g.id;
  else
    if t.used_at is not null then
      update yeoni_connector.grants set revoked_at=clock_timestamp() where id=g.id;
      return jsonb_build_object('error','invalid_grant');
    end if;
    if t.expires_at<=clock_timestamp() then return jsonb_build_object('error','invalid_grant'); end if;
    update yeoni_connector.tokens set used_at=clock_timestamp() where token_hash=t.token_hash;
  end if;
  a:=yeoni_connector.secret('ya_'); r:=yeoni_connector.secret('yr_');
  insert into yeoni_connector.tokens(token_hash,grant_id,kind,expires_at) values
    (yeoni_connector.hash(a),g.id,'access',least(g.expires_at,clock_timestamp()+interval '1 hour')),
    (yeoni_connector.hash(r),g.id,'refresh',g.expires_at);
  return jsonb_build_object('access_token',a,'refresh_token',r,'token_type','Bearer','expires_in',least(3600,greatest(0,floor(extract(epoch from g.expires_at-clock_timestamp())))),'scope',array_to_string(g.scopes,' '));
end;
$$;

create function yeoni_connector.manage(p_revoke uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); result jsonb;
begin
  if owner_id is null or not yeoni_connector.live_session((auth.jwt()->>'session_id')::uuid,owner_id) then raise exception '로그인을 다시 확인해 주세요.' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('app-record-reset:'||owner_id::text,0));
  if p_revoke is not null then update yeoni_connector.grants set revoked_at=coalesce(revoked_at,clock_timestamp()) where user_id=owner_id and id=p_revoke; end if;
  select coalesce(jsonb_agg(to_jsonb(row)),'[]') into result from (select id,areas,scopes,created_at,expires_at,revoked_at,
    revoked_at is null and code_used_at is not null and expires_at>clock_timestamp() and yeoni_connector.live_session(session_id,user_id) as active
    from yeoni_connector.grants where user_id=owner_id order by created_at desc limit 20) row;
  return result;
end;
$$;
create function yeoni_connector.revoke(p_token text,p_client text) returns void language plpgsql security definer set search_path='' as $$
begin
  if p_client='https://chatgpt.com/oauth/client.json' and length(coalesce(p_token,'')) between 30 and 200 then
    update yeoni_connector.grants set revoked_at=coalesce(revoked_at,clock_timestamp()) where client_id=p_client
      and id in(select grant_id from yeoni_connector.tokens where token_hash=yeoni_connector.hash(p_token));
  end if;
end;
$$;

-- Safe parsing for JSON values retained by earlier localStorage-based apps.
create function yeoni_connector.parsed(p_value jsonb) returns jsonb language plpgsql immutable security invoker set search_path='' as $$
begin
  if jsonb_typeof(p_value)='string' then return (p_value#>>'{}')::jsonb; end if;
  return coalesce(p_value,'null');
exception when others then raise exception '저장된 기록의 형식을 확인하지 못했습니다.';
end;
$$;
create function yeoni_connector.entries(p_value jsonb) returns table(day text,value jsonb) language plpgsql immutable security invoker set search_path='' as $$
declare v jsonb:=yeoni_connector.parsed(p_value);
begin
  if v='null' then return; end if;
  if jsonb_typeof(v)<>'object' then raise exception '날짜별 기록을 확인하지 못했습니다.'; end if;
  return query select key,yeoni_connector.parsed(e.value) from jsonb_each(v) e;
end;
$$;
create function yeoni_connector.array_size(p_value jsonb) returns integer language plpgsql immutable security invoker set search_path='' as $$
declare v jsonb:=yeoni_connector.parsed(p_value);
begin
  if v='null' then return 0; end if;
  if jsonb_typeof(v)<>'array' then raise exception '학습 기록을 확인하지 못했습니다.'; end if;
  return jsonb_array_length(v);
end;
$$;
create function yeoni_connector.valid_day(p_day text) returns date language plpgsql immutable security invoker set search_path='' as $$
begin
  if p_day !~ '^\d{4}-\d{2}-\d{2}$' then return null; end if;
  return p_day::date;
exception when datetime_field_overflow or invalid_datetime_format then return null;
end;
$$;
create function yeoni_connector.summary(p_owner uuid,p_area text,p_start date,p_end date) returns jsonb language plpgsql security invoker set search_path='' as $$
declare s jsonb; m jsonb; n jsonb:=jsonb_build_array('서버에 저장된 기록의 집계입니다. 기록하지 않은 날의 상태는 알 수 없습니다.','원본 메모·이름·사진·대화 내용은 포함하지 않습니다.');
begin
  if p_area='assistant' then
    select jsonb_build_object('미완료 할 일',count(*) filter(where status not in ('completed','cancelled')),
      '기간 내 완료',count(*) filter(where status='completed' and (completed_at at time zone 'Asia/Seoul')::date between p_start and p_end),
      '기한이 지난 미완료',count(*) filter(where status not in ('completed','cancelled') and (due_at at time zone 'Asia/Seoul')::date<p_end)) into m
      from public.assistant_items where user_id=p_owner;
    n:=n||jsonb_build_array('미완료 수는 조회 시점 전체이며, 완료 수에만 선택 기간을 적용합니다.');
  elsif p_area in ('fitness','diet') then
    select state into s from public.user_app_state where user_id=p_owner;
    if p_area='fitness' then
      select jsonb_build_object('운동 기록일',count(*),'운동 수행일',count(*) filter(where value->>'workoutStatus' in ('completed','partial') or value->>'workoutDone'='true' or value='true'::jsonb),
        '운동 중단일',count(*) filter(where value->>'workoutStatus'='stopped'),
        '불편·통증 신호 기록일',count(*) filter(where value->>'workoutPain'='true' or value->>'workoutBackStatus' in ('pain','worse') or yeoni_connector.array_size(value->'workoutNeurologicalSymptoms')>0)) into m
        from yeoni_connector.entries(s->'ai-fitness-workout-completed-days') where yeoni_connector.valid_day(day) between p_start and p_end;
    else
      select jsonb_build_object('식단 기록일',count(*)) into m from yeoni_connector.entries(s->'ai-fitness-diet-completed-days') where yeoni_connector.valid_day(day) between p_start and p_end;
      select m||jsonb_build_object('물 섭취 기록일',count(*),'기록일 평균 물 섭취 mL',coalesce(round(avg((value#>>'{}')::numeric),1),0)) into m
        from yeoni_connector.entries(s->'ai-fitness-water-intake') where yeoni_connector.valid_day(day) between p_start and p_end;
      n:=n||jsonb_build_array('식단 기록일은 식사의 영양 균형이나 목표 달성을 의미하지 않습니다.');
    end if;
  elsif p_area='language' then
    select state into s from public.language_user_state where user_id=p_owner;
    with activity as (
      select day from yeoni_connector.entries(s->'dailyLearningHistory') where coalesce((value->>'completedCount')::numeric,0)>0 or yeoni_connector.array_size(value->'completedIds')>0
      union select jsonb_array_elements_text(coalesce(yeoni_connector.parsed(s->'japaneseCurriculumProgressV1')->'activityDates','[]'))
    ) select jsonb_build_object('학습 활동일',count(*)) into m from activity where yeoni_connector.valid_day(day) between p_start and p_end;
    m:=m||jsonb_build_object('현재 복습 목록 항목',yeoni_connector.array_size(s->'wrongKana')+yeoni_connector.array_size(s->'wrongKanaChars')+yeoni_connector.array_size(s->'wrongWords')+yeoni_connector.array_size(s->'wrongSentences')+yeoni_connector.array_size(s->'japaneseCurriculumReviewV1'));
    n:=n||jsonb_build_array('복습 목록에는 중복이 있을 수 있으며 숙달 수준이나 서로 다른 문제 수를 뜻하지 않습니다.');
  elsif p_area='budget' then
    select jsonb_build_object('지출 기록 건수',count(*),'지출 합계 원',coalesce(sum(amount),0)) into m from public.budget_transactions where user_id=p_owner and date between p_start and p_end;
    select m||jsonb_build_object('수입 기록 건수',count(*),'수입 합계 원',coalesce(sum(amount),0)) into m from public.budget_income where user_id=p_owner and date between p_start and p_end;
    select m||jsonb_build_object('저축 기록 건수',count(*),'저축 합계 원',coalesce(sum(amount),0)) into m from public.budget_savings where user_id=p_owner and date between p_start and p_end;
    n:=n||jsonb_build_array('선택 기간의 원화 기록 합계입니다. 미기록 수입·지출을 실제 0원으로 확정하지 않습니다.');
  else raise exception '지원하지 않는 기록 영역입니다.';
  end if;
  return jsonb_build_object('area',p_area,'start_date',p_start,'end_date',p_end,'metrics',m,'notes',n);
end;
$$;

create function yeoni_connector.tool(p_token text,p_resource text,p_tool text,p_args jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare g yeoni_connector.grants; token_exp timestamptz; chosen_area text; start_day date; end_day date; days integer; data jsonb;
  snap yeoni_connector.snapshots; saved public.chatgpt_advice; request_id uuid; payload_hash text; needed text; owner_id uuid;
begin
  if length(coalesce(p_token,'')) not between 30 and 200 then return jsonb_build_object('error','invalid_token'); end if;
  select x.* into g from yeoni_connector.grants x join yeoni_connector.tokens t on t.grant_id=x.id
    where t.token_hash=yeoni_connector.hash(p_token) and t.kind='access';
  if g.id is null then return jsonb_build_object('error','invalid_token'); end if;
  select expires_at into token_exp from yeoni_connector.tokens where token_hash=yeoni_connector.hash(p_token) and kind='access';
  owner_id:=g.user_id;
  perform pg_advisory_xact_lock(hashtextextended('app-record-reset:'||owner_id::text,0));
  select * into g from yeoni_connector.grants where id=g.id for update;
  if g.id is null or g.resource is distinct from p_resource or g.revoked_at is not null or g.code_used_at is null
    or token_exp is null or token_exp<=clock_timestamp() or g.expires_at<=clock_timestamp() or not yeoni_connector.live_session(g.session_id,g.user_id) then return jsonb_build_object('error','invalid_token'); end if;
  needed:=case p_tool when 'read_record_summary' then 'yeoni:records:read' when 'save_advice' then 'yeoni:advice:write' when 'list_saved_advice' then 'yeoni:advice:read' when 'check' then null else 'unsupported' end;
  if needed='unsupported' then return jsonb_build_object('error','unsupported_tool'); end if;
  if needed is not null and not needed=any(g.scopes) then return jsonb_build_object('error','insufficient_scope'); end if;
  if p_tool='check' then return jsonb_build_object('scopes',g.scopes,'areas',g.areas); end if;
  if jsonb_typeof(p_args) is distinct from 'object' or octet_length(p_args::text)>30000 then raise exception '요청 내용을 확인해 주세요.'; end if;
  if g.window_at<clock_timestamp()-interval '1 minute' then
    update yeoni_connector.grants set window_at=clock_timestamp(),window_calls=1 where id=g.id;
  elsif g.window_calls>=60 then return jsonb_build_object('error','rate_limited');
  else update yeoni_connector.grants set window_calls=window_calls+1 where id=g.id; end if;
  if p_tool='read_record_summary' then
    if (p_args-array['area','days'])<>'{}'::jsonb then raise exception '지원하지 않는 조회 조건입니다.'; end if;
    chosen_area:=p_args->>'area'; days:=coalesce((p_args->>'days')::integer,28);
    if chosen_area is null or not chosen_area=any(g.areas) then return jsonb_build_object('error','insufficient_scope'); end if;
    if days not in (7,28) then raise exception '조회 기간은 7일 또는 28일입니다.'; end if;
    end_day:=(clock_timestamp() at time zone 'Asia/Seoul')::date; start_day:=end_day-(days-1);
    data:=yeoni_connector.summary(g.user_id,chosen_area,start_day,end_day);
    delete from yeoni_connector.snapshots where user_id=g.user_id and created_at<clock_timestamp()-interval '1 day';
    if (select count(*) from yeoni_connector.snapshots where user_id=g.user_id)>=100 then raise exception '오늘의 분석 요청이 많습니다. 내일 다시 시도해 주세요.'; end if;
    insert into yeoni_connector.snapshots(user_id,grant_id,area,summary) values(g.user_id,g.id,chosen_area,data) returning * into snap;
    return jsonb_build_object('snapshot_id',snap.id,'snapshot_at',snap.created_at,'summary',data);
  elsif p_tool='save_advice' then
    if not (p_args ?& array['request_id','snapshot_id','title','body']) or (p_args-array['request_id','snapshot_id','title','body'])<>'{}'::jsonb
      or jsonb_typeof(p_args->'title')<>'string' or length(btrim(p_args->>'title')) not between 1 and 120
      or jsonb_typeof(p_args->'body')<>'string' or length(btrim(p_args->>'body')) not between 1 and 6000 then raise exception '조언의 제목과 내용을 확인해 주세요.'; end if;
    request_id:=(p_args->>'request_id')::uuid;
    if request_id is null then raise exception '저장 요청 번호가 필요합니다.'; end if;
    payload_hash:=yeoni_connector.hash(p_args::text);
    select * into saved from public.chatgpt_advice a where a.user_id=g.user_id and a.id=request_id;
    if found then
      if saved.payload_hash<>payload_hash then raise exception '이미 다른 내용에 사용한 저장 요청입니다.'; end if;
      if not saved.area=any(g.areas) then return jsonb_build_object('error','insufficient_scope'); end if;
      return to_jsonb(saved)-array['user_id','payload_hash'];
    end if;
    select * into snap from yeoni_connector.snapshots where id=(p_args->>'snapshot_id')::uuid and user_id=g.user_id and grant_id=g.id;
    if not found or snap.created_at<clock_timestamp()-interval '1 day' then raise exception '기록 요약이 만료되었거나 없습니다. 다시 조회하고 분석해 주세요.'; end if;
    if not snap.area=any(g.areas) then return jsonb_build_object('error','insufficient_scope'); end if;
    data:=yeoni_connector.summary(g.user_id,snap.area,(snap.summary->>'start_date')::date,(snap.summary->>'end_date')::date);
    if data is distinct from snap.summary then raise exception '분석 중 기록이 바뀌었습니다. 최신 요약으로 다시 분석해 주세요.'; end if;
    if (select count(*) from public.chatgpt_advice where user_id=g.user_id and created_at>clock_timestamp()-interval '1 day')>=50 then raise exception '오늘 저장한 조언이 많습니다. 내일 다시 시도해 주세요.'; end if;
    insert into public.chatgpt_advice(user_id,id,payload_hash,title,body,area,summary,snapshot_at)
      values(g.user_id,request_id,payload_hash,btrim(p_args->>'title'),btrim(p_args->>'body'),snap.area,snap.summary,snap.created_at) returning * into saved;
    return to_jsonb(saved)-array['user_id','payload_hash'];
  else
    if (p_args-array['area'])<>'{}'::jsonb then raise exception '지원하지 않는 조회 조건입니다.'; end if;
    chosen_area:=p_args->>'area';
    if chosen_area is not null and not chosen_area=any(g.areas) then return jsonb_build_object('error','insufficient_scope'); end if;
    select coalesce(jsonb_agg(to_jsonb(a)-array['user_id','payload_hash']),'[]') into data from
      (select * from public.chatgpt_advice where user_id=g.user_id and chatgpt_advice.area=any(g.areas) and (chosen_area is null or chatgpt_advice.area=chosen_area) order by created_at desc,id limit 20) a;
    return jsonb_build_object('advice',data,'limit',20);
  end if;
end;
$$;

-- A reset removes derived advice/snapshots in its area and revokes connections
-- that could retain pre-reset context. No existing raw records or RLS is changed.
create function yeoni_connector.on_record_reset() returns trigger language plpgsql security definer set search_path='' as $$
declare reset_areas text[]:=array[]::text[]; a text;
begin
  if tg_table_name='language_user_state' then
    if (new.state->'languageRecordResetV1') is distinct from (old.state->'languageRecordResetV1') then reset_areas:=array['language']; end if;
  else
    foreach a in array array['assistant','fitness','diet','budget'] loop
      if (new.state->('ai-fitness-record-reset-'||a)) is distinct from (old.state->('ai-fitness-record-reset-'||a)) then reset_areas:=array_append(reset_areas,a); end if;
    end loop;
  end if;
  if cardinality(reset_areas)>0 then
    if 'assistant'=any(reset_areas) then reset_areas:=array['assistant','fitness','diet','language','budget']; end if;
    update yeoni_connector.grants set revoked_at=coalesce(revoked_at,clock_timestamp()) where user_id=new.user_id and grants.areas&&reset_areas;
    delete from public.chatgpt_advice where user_id=new.user_id and area=any(reset_areas);
    delete from yeoni_connector.snapshots where user_id=new.user_id and area=any(reset_areas);
  end if;
  return new;
end;
$$;
create trigger chatgpt_reset_fitness after update of state on public.user_app_state for each row execute function yeoni_connector.on_record_reset();
create trigger chatgpt_reset_language after update of state on public.language_user_state for each row execute function yeoni_connector.on_record_reset();

revoke all on all functions in schema yeoni_connector from public,anon,authenticated;
grant execute on function yeoni_connector.authorize(text,text,text[],text[],text),yeoni_connector.manage(uuid) to authenticated;
grant execute on function yeoni_connector.exchange(text,text,text,text,text,text),yeoni_connector.revoke(text,text),yeoni_connector.tool(text,text,text,jsonb) to anon,authenticated;
create function public.chatgpt_authorize(p_resource text,p_client text,p_scopes text[],p_areas text[],p_challenge text) returns jsonb language sql security invoker set search_path='' as $$ select yeoni_connector.authorize(p_resource,p_client,p_scopes,p_areas,p_challenge); $$;
create function public.chatgpt_exchange(p_kind text,p_credential text,p_client text,p_resource text,p_verifier text default null,p_redirect text default null) returns jsonb language sql security invoker set search_path='' as $$ select yeoni_connector.exchange(p_kind,p_credential,p_client,p_resource,p_verifier,p_redirect); $$;
create function public.chatgpt_connections(p_revoke uuid default null) returns jsonb language sql security invoker set search_path='' as $$ select yeoni_connector.manage(p_revoke); $$;
create function public.chatgpt_revoke(p_token text,p_client text) returns void language sql security invoker set search_path='' as $$ select yeoni_connector.revoke(p_token,p_client); $$;
create function public.chatgpt_tool(p_token text,p_resource text,p_tool text,p_args jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$ select yeoni_connector.tool(p_token,p_resource,p_tool,p_args); $$;
revoke all on function public.chatgpt_authorize(text,text,text[],text[],text),public.chatgpt_connections(uuid),public.chatgpt_exchange(text,text,text,text,text,text),public.chatgpt_revoke(text,text),public.chatgpt_tool(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.chatgpt_authorize(text,text,text[],text[],text),public.chatgpt_connections(uuid) to authenticated;
grant execute on function public.chatgpt_exchange(text,text,text,text,text,text),public.chatgpt_revoke(text,text),public.chatgpt_tool(text,text,text,jsonb) to anon,authenticated;

-- Additive, owner-only category editing. Installation never rewrites a record.
create table public.budget_category_rules (
  user_id uuid not null references auth.users(id) on delete cascade,
  merchant_key text not null check (length(merchant_key) between 1 and 200),
  category text not null,
  revision uuid not null,
  primary key (user_id, merchant_key)
);
create table public.budget_category_changes (
  user_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null,
  payload_hash text not null,
  entry_count integer not null check (entry_count between 1 and 100),
  category text not null,
  before_rules jsonb not null default '{}',
  after_rules jsonb not null default '{}',
  created_at timestamptz not null default clock_timestamp(),
  undone_at timestamptz,
  primary key (user_id,id)
);
create unique index if not exists budget_transactions_owner_id_idx on public.budget_transactions(user_id,id);
create table public.budget_category_change_items (
  user_id uuid not null,
  change_id uuid not null,
  transaction_id uuid not null,
  before_category text,
  after_hash text not null,
  primary key (user_id,change_id,transaction_id),
  foreign key (user_id,change_id) references public.budget_category_changes(user_id,id) on delete cascade,
  foreign key (user_id,transaction_id) references public.budget_transactions(user_id,id) on delete cascade
);
create index budget_category_items_transaction_idx on public.budget_category_change_items(user_id,transaction_id);
create index budget_category_changes_created_idx on public.budget_category_changes(user_id,created_at desc,id);
alter table public.budget_category_rules enable row level security;
alter table public.budget_category_changes enable row level security;
alter table public.budget_category_change_items enable row level security;
create policy category_rules_owner on public.budget_category_rules for all to authenticated
  using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy category_changes_owner on public.budget_category_changes for all to authenticated
  using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy category_items_owner on public.budget_category_change_items for all to authenticated
  using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
revoke all on public.budget_category_rules,public.budget_category_changes,public.budget_category_change_items from anon,authenticated;
grant select,insert,update,delete on public.budget_category_rules,public.budget_category_changes,public.budget_category_change_items to authenticated;
grant all on public.budget_category_rules,public.budget_category_changes,public.budget_category_change_items to service_role;

create function public.change_budget_categories(p_request_id uuid,p_rows jsonb,p_category text,p_remember boolean)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  owner_id uuid := auth.uid();
  receipt public.budget_category_changes;
  entry jsonb;
  transaction_row public.budget_transactions;
  previous_category text;
  merchant text;
  rule_before jsonb;
  rule_after jsonb;
  v_before_rules jsonb := '{}';
  v_after_rules jsonb := '{}';
  request_hash text;
begin
  if owner_id is null then raise exception '로그인이 필요합니다.' using errcode='42501'; end if;
  if p_request_id is null or p_rows is null or jsonb_typeof(p_rows)<>'array'
    or jsonb_array_length(p_rows) not between 1 and 100 or octet_length(p_rows::text)>200000 or p_remember is null
    or p_category is null or p_category not in ('식비','카페','교통','쇼핑','생활용품','배달','문화','의료','구독','통신비','공과금','보험','월세','대출','관리비','취미','기타') then
    raise exception '선택한 내역과 분류를 확인해 주세요.';
  end if;
  if (select count(distinct value->>'id') from jsonb_array_elements(p_rows))<>jsonb_array_length(p_rows) then
    raise exception '내역 선택이 중복되거나 비어 있습니다.';
  end if;
  -- The same owner lock as record reset. A reset cannot interleave this operation.
  perform pg_advisory_xact_lock(hashtextextended('app-record-reset:'||owner_id::text,0));
  request_hash := md5(jsonb_build_array(p_rows,p_category,p_remember)::text);
  select * into receipt from public.budget_category_changes where user_id=owner_id and id=p_request_id;
  if found then
    if receipt.payload_hash<>request_hash then raise exception '이미 사용한 변경 요청입니다. 결과를 먼저 확인해 주세요.'; end if;
    return jsonb_build_object('count',receipt.entry_count,'reused',true,'undone',receipt.undone_at is not null);
  end if;
  insert into public.budget_category_changes(user_id,id,payload_hash,entry_count,category)
    values(owner_id,p_request_id,request_hash,jsonb_array_length(p_rows),p_category);
  for entry in select value from jsonb_array_elements(p_rows) order by value->>'id' loop
    select * into transaction_row from public.budget_transactions
      where user_id=owner_id and id=(entry->>'id')::uuid for update;
    if not found or to_jsonb(transaction_row) is distinct from entry->'expected' then
      raise exception '기록이 다른 곳에서 변경되었거나 삭제되었습니다. 새로 불러온 뒤 다시 선택해 주세요.';
    end if;
    previous_category := transaction_row.category;
    update public.budget_transactions set category=p_category where user_id=owner_id and id=transaction_row.id
      returning * into transaction_row;
    insert into public.budget_category_change_items(user_id,change_id,transaction_id,before_category,after_hash)
      values(owner_id,p_request_id,transaction_row.id,previous_category,md5(to_jsonb(transaction_row)::text));
    if p_remember then
      merchant := lower(regexp_replace(btrim(coalesce(transaction_row.place,'')),' +',' ','g'));
      if length(merchant) not between 1 and 200 then raise exception '분류를 기억하려면 200자 이내의 장소 이름이 필요해요.'; end if;
      if not (v_after_rules ? merchant) then
        select to_jsonb(r) into rule_before from public.budget_category_rules r where user_id=owner_id and merchant_key=merchant for update;
        v_before_rules := v_before_rules || jsonb_build_object(merchant,rule_before);
        insert into public.budget_category_rules(user_id,merchant_key,category,revision) values(owner_id,merchant,p_category,p_request_id)
          on conflict (user_id,merchant_key) do update set category=excluded.category,revision=excluded.revision
          returning to_jsonb(budget_category_rules.*) into rule_after;
        v_after_rules := v_after_rules || jsonb_build_object(merchant,rule_after);
      end if;
    end if;
  end loop;
  update public.budget_category_changes set before_rules=v_before_rules,after_rules=v_after_rules
    where user_id=owner_id and id=p_request_id;
  return jsonb_build_object('count',jsonb_array_length(p_rows),'reused',false,'undone',false);
end;
$$;
revoke all on function public.change_budget_categories(uuid,jsonb,text,boolean) from public,anon;
grant execute on function public.change_budget_categories(uuid,jsonb,text,boolean) to authenticated;

create function public.undo_budget_category_change(p_change_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  owner_id uuid := auth.uid();
  receipt public.budget_category_changes;
  item public.budget_category_change_items;
  transaction_row public.budget_transactions;
  merchant text;
  current_rule jsonb;
  before_rule jsonb;
begin
  if owner_id is null then raise exception '로그인이 필요합니다.' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('app-record-reset:'||owner_id::text,0));
  select * into receipt from public.budget_category_changes where user_id=owner_id and id=p_change_id for update;
  if not found then raise exception '변경 이력을 찾을 수 없습니다.'; end if;
  if receipt.undone_at is not null then return jsonb_build_object('count',receipt.entry_count,'reused',true); end if;
  if (select count(*) from public.budget_category_change_items where user_id=owner_id and change_id=p_change_id)<>receipt.entry_count then
    raise exception '변경했던 내역 중 삭제된 기록이 있어 되돌릴 수 없습니다.';
  end if;
  for item in select * from public.budget_category_change_items where user_id=owner_id and change_id=p_change_id order by transaction_id loop
    select * into transaction_row from public.budget_transactions where user_id=owner_id and id=item.transaction_id for update;
    if not found or md5(to_jsonb(transaction_row)::text)<>item.after_hash then
      raise exception '이후에 바뀐 기록이 있어 되돌리지 않았습니다. 최신 내용을 확인해 주세요.';
    end if;
    update public.budget_transactions set category=item.before_category where user_id=owner_id and id=item.transaction_id;
  end loop;
  for merchant in select jsonb_object_keys(receipt.after_rules) loop
    select to_jsonb(r) into current_rule from public.budget_category_rules r where user_id=owner_id and merchant_key=merchant for update;
    if current_rule is distinct from receipt.after_rules->merchant then
      raise exception '기억한 분류가 이후에 바뀌어 되돌리지 않았습니다.';
    end if;
    before_rule := receipt.before_rules->merchant;
    if before_rule='null'::jsonb then
      delete from public.budget_category_rules where user_id=owner_id and merchant_key=merchant;
    else
      update public.budget_category_rules set category=before_rule->>'category',revision=(before_rule->>'revision')::uuid
        where user_id=owner_id and merchant_key=merchant;
    end if;
  end loop;
  update public.budget_category_changes set undone_at=clock_timestamp() where user_id=owner_id and id=p_change_id;
  return jsonb_build_object('count',receipt.entry_count,'reused',false);
end;
$$;
revoke all on function public.undo_budget_category_change(uuid) from public,anon;
grant execute on function public.undo_budget_category_change(uuid) to authenticated;

comment on table public.budget_category_changes is '사용자 자신의 분류 변경과 분류 설정 이력. 금액·메모·삭제 기록 원문을 복제하지 않음. 위변조 방지 감사 로그가 아님.';

-- Full budget reset clears category history; merchant rules are retained as settings.
create or replace function public.reset_my_app_records(p_app text, p_request_id uuid, p_confirmation text)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  current_state jsonb;
  next_state jsonb;
  marker_key text;
  marker text;
  record_keys text[];
begin
  if owner_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_app is null or p_app not in ('fitness','diet','language','growth','assistant','budget')
    or p_request_id is null or p_confirmation is distinct from '초기화' then
    raise exception 'Invalid reset confirmation' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('app-record-reset:' || owner_id::text, 0));
  marker_key := case when p_app = 'language' then 'languageRecordResetV1' else 'ai-fitness-record-reset-' || p_app end;
  if p_app = 'language' then
    insert into public.language_user_state(user_id, state, updated_at) values(owner_id, '{}'::jsonb, clock_timestamp()) on conflict (user_id) do nothing;
    select state into current_state from public.language_user_state where user_id = owner_id for update;
  else
    insert into public.user_app_state(user_id, state, updated_at) values(owner_id, '{}'::jsonb, clock_timestamp()) on conflict (user_id) do nothing;
    select state into current_state from public.user_app_state where user_id = owner_id for update;
  end if;
  if current_state is null then raise exception 'State is not accessible' using errcode = '42501'; end if;
  -- A retry after a lost response must not delete records created since that reset.
  marker := current_state ->> marker_key;
  if split_part(coalesce(marker, ''), '|', 2) = p_request_id::text then
    return jsonb_build_object('app', p_app, 'user_id', owner_id, 'marker', marker);
  end if;

  case p_app
  when 'fitness' then
    record_keys := array['ai-fitness-workout-completed-days','ai-fitness-switchon-set-completions','ai-fitness-switchon-ab-slide-checks','ai-fitness-pullup-progress','ai-fitness-weight-records','ai-fitness-inbody-records','ai-fitness-daily-notes','ai-fitness-recovery-mode-days','ai-fitness-daily-condition','ai-fitness-sleep-status','ai-fitness-alcohol-status','ai-fitness-workout-condition','ai-fitness-workout-plan-decision-history'];
    delete from public.fitness_ai_review_history where user_id = owner_id;
    if exists(select 1 from public.fitness_ai_review_history where user_id = owner_id) then raise exception 'Reset incomplete'; end if;
  when 'diet' then
    record_keys := array['ai-fitness-diet-completed-days','ai-fitness-diet-meal-log','ai-fitness-protein-total','ai-fitness-fasting-start-time','ai-fitness-fasting-completed','ai-fitness-water-intake','ai-fitness-dinner-carb-choice','ai-fitness-lunch-carb-choice','ai-fitness-lunch-protein-choice','ai-fitness-social-meal-mode','ai-fitness-diet-symptoms','ai-fitness-diet-dinner-completed-time'];
  when 'language' then
    record_keys := array['dailyRoutineProgress','dailyLearningHistory','japaneseCurriculumProgressV1','japaneseCurriculumReviewV1','savedWords','savedSentences','wrongKana','wrongKanaChars','wrongWords','wrongSentences','grammarProgress','reviewCompletedItemsByDate'];
  when 'growth' then
    record_keys := array[]::text[];
    delete from public.growth_sessions where user_id = owner_id;
    delete from public.growth_ai_reviews where user_id = owner_id;
    if exists(select 1 from public.growth_sessions where user_id = owner_id) or exists(select 1 from public.growth_ai_reviews where user_id = owner_id) then raise exception 'Reset incomplete'; end if;
  when 'assistant' then
    record_keys := array[]::text[];
    delete from public.assistant_chat_messages where user_id = owner_id;
    delete from public.assistant_items where user_id = owner_id;
    delete from public.assistant_projects where user_id = owner_id;
    delete from public.assistant_memories where user_id = owner_id;
    if exists(select 1 from public.assistant_chat_messages where user_id = owner_id) or exists(select 1 from public.assistant_items where user_id = owner_id) or exists(select 1 from public.assistant_projects where user_id = owner_id) or exists(select 1 from public.assistant_memories where user_id = owner_id) then raise exception 'Reset incomplete'; end if;
  when 'budget' then
    record_keys := array[]::text[];
    delete from public.budget_category_changes where user_id = owner_id;
    delete from public.budget_transactions where user_id = owner_id;
    delete from public.budget_income where user_id = owner_id;
    delete from public.budget_savings where user_id = owner_id;
    if exists(select 1 from public.budget_transactions where user_id = owner_id) or exists(select 1 from public.budget_income where user_id = owner_id) or exists(select 1 from public.budget_savings where user_id = owner_id) then raise exception 'Reset incomplete'; end if;
  end case;
  marker := to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' || p_request_id::text;
  next_state := (current_state - record_keys) || jsonb_build_object(marker_key, marker);
  if p_app = 'language' then
    update public.language_user_state set state = next_state, updated_at = clock_timestamp() where user_id = owner_id;
  else
    update public.user_app_state set state = next_state, updated_at = clock_timestamp() where user_id = owner_id;
  end if;
  if not found then raise exception 'State reset failed' using errcode = '42501'; end if;
  return jsonb_build_object('app', p_app, 'user_id', owner_id, 'marker', marker);
end;
$$;
revoke all on function public.reset_my_app_records(text, uuid, text) from public, anon;
grant execute on function public.reset_my_app_records(text, uuid, text) to authenticated;

-- No existing records are changed on installation. Only explicit task-command
-- confirmations write a task and its owner-visible receipt in one transaction.
create table public.assistant_task_command_history (
  user_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null,
  operation text not null check(operation in ('create','update')),
  item_id uuid not null,
  payload_hash text not null,
  before_record jsonb,
  after_record jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  undone_at timestamptz,
  primary key(user_id,id)
);
create index assistant_task_command_history_created_idx on public.assistant_task_command_history(user_id,created_at desc,id);
alter table public.assistant_task_command_history enable row level security;
create policy assistant_task_command_history_owner on public.assistant_task_command_history for all to authenticated
  using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
revoke all on public.assistant_task_command_history from public,anon,authenticated;
grant select,insert,update,delete on public.assistant_task_command_history to authenticated;
grant all on public.assistant_task_command_history to service_role;

create function public.apply_assistant_task_command(
  p_request_id uuid,p_operation text,p_item_id uuid,p_expected jsonb,p_values jsonb,p_reset_marker text,p_expires_at timestamptz
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  owner_id uuid := auth.uid();
  receipt public.assistant_task_command_history;
  item public.assistant_items;
  previous jsonb;
  request_hash text;
  current_reset text;
  project uuid;
begin
  if owner_id is null then raise exception '로그인이 필요합니다.' using errcode='42501'; end if;
  if p_request_id is null or p_operation is null or p_operation not in ('create','update') or p_values is null
    or jsonb_typeof(p_values)<>'object' or octet_length(p_values::text)>4000
    or coalesce(octet_length(p_expected::text),0)>20000 or length(coalesce(p_reset_marker,''))>120 then
    raise exception '확인할 변경 내용을 다시 불러와 주세요.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('app-record-reset:'||owner_id::text,0));
  request_hash := md5(jsonb_build_array(p_operation,p_item_id,p_expected,p_values,p_reset_marker,p_expires_at)::text);
  select * into receipt from public.assistant_task_command_history where user_id=owner_id and id=p_request_id;
  if found then
    if receipt.payload_hash<>request_hash then raise exception '이미 사용한 요청입니다. 실행 이력을 확인해 주세요.'; end if;
    return to_jsonb(receipt);
  end if;
  if p_expires_at is null or p_expires_at<clock_timestamp() or p_expires_at>clock_timestamp()+interval '20 minutes' then
    raise exception '확인 시간이 지났습니다. 명령을 다시 입력해 주세요.';
  end if;
  select state->>'ai-fitness-record-reset-assistant' into current_reset from public.user_app_state where user_id=owner_id;
  if current_reset is distinct from p_reset_marker then raise exception '연이 기록이 초기화되었습니다. 명령을 다시 입력해 주세요.'; end if;
  if not (p_values ?& array['title','due_at','priority','recurrence_rule','project_id'])
    or (p_values-array['title','due_at','priority','recurrence_rule','project_id'])<>'{}'::jsonb
    or jsonb_typeof(p_values->'title')<>'string' or length(btrim(p_values->>'title')) not between 1 and 200
    or jsonb_typeof(p_values->'priority')<>'number' or (p_values->>'priority') !~ '^[1-5]$'
    or jsonb_typeof(p_values->'recurrence_rule')<>'string' or p_values->>'recurrence_rule' not in ('none','daily','weekly','monthly')
    or jsonb_typeof(p_values->'due_at') not in ('string','null') or jsonb_typeof(p_values->'project_id') not in ('string','null') then
    raise exception '제목·마감일·우선순위·반복 설정을 확인해 주세요.';
  end if;
  project := (p_values->>'project_id')::uuid;
  if project is not null then
    perform 1 from public.assistant_projects where user_id=owner_id and id=project and status<>'archived' for share;
    if not found then raise exception '연결할 프로젝트를 찾지 못했습니다.'; end if;
  end if;
  if p_operation='create' then
    if p_item_id is not null or p_expected is not null and p_expected<>'null'::jsonb then raise exception '추가 요청을 다시 확인해 주세요.'; end if;
    insert into public.assistant_items(id,user_id,title,kind,status,priority,due_at,project_id,recurrence_rule,source)
      values(p_request_id,owner_id,btrim(p_values->>'title'),'task','open',(p_values->>'priority')::integer,
        (p_values->>'due_at')::timestamptz,project,p_values->>'recurrence_rule','assistant_chat') returning * into item;
  else
    select * into item from public.assistant_items where user_id=owner_id and id=p_item_id for update;
    if not found or to_jsonb(item) is distinct from p_expected then
      raise exception '다른 곳에서 변경되었거나 삭제된 할 일입니다. 명령을 다시 입력해 주세요.';
    end if;
    if item.status in ('completed','cancelled') or item.title is distinct from p_values->>'title' or item.project_id is distinct from project then
      raise exception '수정 대상이 달라졌습니다. 명령을 다시 입력해 주세요.';
    end if;
    previous := to_jsonb(item);
    update public.assistant_items set due_at=(p_values->>'due_at')::timestamptz,priority=(p_values->>'priority')::integer,
      recurrence_rule=p_values->>'recurrence_rule',updated_at=clock_timestamp()
      where user_id=owner_id and id=item.id returning * into item;
  end if;
  if not found then raise exception '할 일을 저장하지 못했습니다.'; end if;
  insert into public.assistant_task_command_history(user_id,id,operation,item_id,payload_hash,before_record,after_record)
    values(owner_id,p_request_id,p_operation,item.id,request_hash,previous,to_jsonb(item)) returning * into receipt;
  return to_jsonb(receipt);
end;
$$;
revoke all on function public.apply_assistant_task_command(uuid,text,uuid,jsonb,jsonb,text,timestamptz) from public,anon;
grant execute on function public.apply_assistant_task_command(uuid,text,uuid,jsonb,jsonb,text,timestamptz) to authenticated;

create function public.undo_assistant_task_command(p_request_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  owner_id uuid := auth.uid();
  receipt public.assistant_task_command_history;
  item public.assistant_items;
begin
  if owner_id is null then raise exception '로그인이 필요합니다.' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('app-record-reset:'||owner_id::text,0));
  select * into receipt from public.assistant_task_command_history where user_id=owner_id and id=p_request_id for update;
  if not found then raise exception '실행 이력을 찾을 수 없습니다.'; end if;
  if receipt.undone_at is not null then return to_jsonb(receipt); end if;
  select * into item from public.assistant_items where user_id=owner_id and id=receipt.item_id for update;
  if not found or to_jsonb(item) is distinct from receipt.after_record then
    raise exception '이후에 변경되었거나 삭제된 할 일이 있어 되돌리지 않았습니다. 최신 내용을 확인해 주세요.';
  end if;
  if receipt.operation='create' then
    if exists(select 1 from public.assistant_items where user_id=owner_id and recurrence_parent_id=item.id) then
      raise exception '다음 반복 일정이 있어 추가를 되돌리지 않았습니다.';
    end if;
    delete from public.assistant_items where user_id=owner_id and id=item.id;
  else
    update public.assistant_items set due_at=(receipt.before_record->>'due_at')::timestamptz,
      priority=(receipt.before_record->>'priority')::integer,recurrence_rule=receipt.before_record->>'recurrence_rule',updated_at=clock_timestamp()
      where user_id=owner_id and id=item.id;
  end if;
  if not found then raise exception '되돌리기를 저장하지 못했습니다.'; end if;
  update public.assistant_task_command_history set undone_at=clock_timestamp() where user_id=owner_id and id=p_request_id returning * into receipt;
  return to_jsonb(receipt);
end;
$$;
revoke all on function public.undo_assistant_task_command(uuid) from public,anon;
grant execute on function public.undo_assistant_task_command(uuid) to authenticated;

-- Assistant reset also removes command snapshots; the existing reset lock and
-- idempotent reset marker are preserved for all six apps.
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
    delete from public.assistant_task_command_history where user_id = owner_id;
    delete from public.assistant_chat_messages where user_id = owner_id;
    delete from public.assistant_items where user_id = owner_id;
    delete from public.assistant_projects where user_id = owner_id;
    delete from public.assistant_memories where user_id = owner_id;
    if exists(select 1 from public.assistant_task_command_history where user_id = owner_id) or exists(select 1 from public.assistant_chat_messages where user_id = owner_id) or exists(select 1 from public.assistant_items where user_id = owner_id) or exists(select 1 from public.assistant_projects where user_id = owner_id) or exists(select 1 from public.assistant_memories where user_id = owner_id) then raise exception 'Reset incomplete'; end if;
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

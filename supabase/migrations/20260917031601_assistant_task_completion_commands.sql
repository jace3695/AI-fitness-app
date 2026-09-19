-- Completion writes the task, its next occurrence and the receipt atomically.
alter table public.assistant_task_command_history drop constraint assistant_task_command_history_operation_check;
alter table public.assistant_task_command_history add constraint assistant_task_command_history_operation_check check (operation in ('create','update','complete'));
alter table public.assistant_task_command_history add column spawned_record jsonb;

create function public.apply_assistant_task_completion(
  p_request_id uuid,p_item_id uuid,p_expected jsonb,p_reset_marker text,p_expires_at timestamptz
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  owner_id uuid := auth.uid(); receipt public.assistant_task_command_history;
  item public.assistant_items; spawned public.assistant_items;
  previous jsonb; request_hash text; current_reset text; base_day date; next_day date;
begin
  if owner_id is null then raise exception '로그인이 필요합니다.' using errcode='42501'; end if;
  if p_request_id is null or p_item_id is null or p_expected is null or jsonb_typeof(p_expected)<>'object'
    or octet_length(p_expected::text)>20000 or length(coalesce(p_reset_marker,''))>120 then
    raise exception '완료할 할 일을 다시 확인해 주세요.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('app-record-reset:'||owner_id::text,0));
  request_hash := md5(jsonb_build_array('complete',p_item_id,p_expected,p_reset_marker,p_expires_at)::text);
  select * into receipt from public.assistant_task_command_history where user_id=owner_id and id=p_request_id;
  if found then
    if receipt.payload_hash<>request_hash then raise exception '이미 사용한 요청입니다. 실행 이력을 확인해 주세요.'; end if;
    return to_jsonb(receipt);
  end if;
  if p_expires_at is null or p_expires_at<=clock_timestamp() or p_expires_at>clock_timestamp()+interval '20 minutes' then
    raise exception '확인 시간이 지났습니다. 명령을 다시 입력해 주세요.';
  end if;
  select state->>'ai-fitness-record-reset-assistant' into current_reset from public.user_app_state where user_id=owner_id;
  if current_reset is distinct from p_reset_marker then raise exception '연이 기록이 초기화되었습니다. 명령을 다시 입력해 주세요.'; end if;
  select * into item from public.assistant_items where user_id=owner_id and id=p_item_id for update;
  if not found or to_jsonb(item) is distinct from p_expected then
    raise exception '다른 곳에서 변경되었거나 삭제된 할 일입니다. 명령을 다시 입력해 주세요.';
  end if;
  if item.status not in ('open','in_progress','waiting') then raise exception '미완료 할 일만 완료할 수 있습니다.'; end if;
  if exists(select 1 from public.assistant_items where user_id=owner_id and recurrence_parent_id=item.id) then
    raise exception '이미 다음 반복 일정이 있습니다. 할 일 화면에서 확인해 주세요.';
  end if;
  previous := to_jsonb(item);
  update public.assistant_items set status='completed',completed_at=clock_timestamp(),updated_at=clock_timestamp()
    where user_id=owner_id and id=p_item_id returning * into item;
  if not found then raise exception '완료를 저장하지 못했습니다.'; end if;
  if item.recurrence_rule<>'none' then
    base_day := coalesce((item.due_at at time zone 'Asia/Seoul')::date,(clock_timestamp() at time zone 'Asia/Seoul')::date);
    next_day := case item.recurrence_rule when 'daily' then base_day+1 when 'weekly' then base_day+7
      when 'monthly' then (base_day+interval '1 month')::date else null end;
    if next_day is null then raise exception '반복 주기를 확인해 주세요.'; end if;
    insert into public.assistant_items(user_id,title,kind,status,priority,project_id,due_at,recurrence_rule,source,recurrence_parent_id)
      values(owner_id,item.title,item.kind,case when item.kind='waiting' then 'waiting' else 'open' end,item.priority,item.project_id,
        (next_day+time '23:59') at time zone 'Asia/Seoul',item.recurrence_rule,'recurrence',item.id) returning * into spawned;
  end if;
  insert into public.assistant_task_command_history(user_id,id,operation,item_id,payload_hash,before_record,after_record,spawned_record)
    values(owner_id,p_request_id,'complete',item.id,request_hash,previous,to_jsonb(item),case when spawned.id is null then null else to_jsonb(spawned) end)
    returning * into receipt;
  return to_jsonb(receipt);
end;
$$;
revoke all on function public.apply_assistant_task_completion(uuid,uuid,jsonb,text,timestamptz) from public,anon;
grant execute on function public.apply_assistant_task_completion(uuid,uuid,jsonb,text,timestamptz) to authenticated;

create or replace function public.undo_assistant_task_command(p_request_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  owner_id uuid := auth.uid();
  receipt public.assistant_task_command_history;
  item public.assistant_items;
  spawned public.assistant_items;
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
  if receipt.operation='complete' then
    if receipt.spawned_record is not null then
      select * into spawned from public.assistant_items where user_id=owner_id and id=(receipt.spawned_record->>'id')::uuid for update;
      if not found or to_jsonb(spawned) is distinct from receipt.spawned_record
        or exists(select 1 from public.assistant_items where user_id=owner_id and recurrence_parent_id=spawned.id) then
        raise exception '다음 반복 일정이 변경되었거나 삭제되어 되돌리지 않았습니다. 새 기록을 보호합니다.';
      end if;
    end if;
    if exists(select 1 from public.assistant_items where user_id=owner_id and recurrence_parent_id=item.id
      and id is distinct from spawned.id) then
      raise exception '새 반복 일정이 있어 되돌리지 않았습니다.';
    end if;
    if spawned.id is not null then delete from public.assistant_items where user_id=owner_id and id=spawned.id; end if;
    update public.assistant_items set status=receipt.before_record->>'status',
      completed_at=(receipt.before_record->>'completed_at')::timestamptz,
      updated_at=(receipt.before_record->>'updated_at')::timestamptz
      where user_id=owner_id and id=item.id;
  elsif receipt.operation='create' then
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


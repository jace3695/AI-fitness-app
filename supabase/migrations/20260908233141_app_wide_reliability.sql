-- Additive changes. Existing records are not rewritten or deduplicated.
create table if not exists public.budget_save_batches (
  user_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null,
  payload_hash text not null,
  entry_count integer not null check (entry_count between 1 and 100),
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);
alter table public.budget_save_batches enable row level security;
create policy "Owners read budget save receipts" on public.budget_save_batches
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Owners create budget save receipts" on public.budget_save_batches
  for insert to authenticated with check ((select auth.uid()) = user_id);
revoke all on public.budget_save_batches from anon, authenticated;
grant select, insert on public.budget_save_batches to authenticated;

create or replace function public.save_budget_batch(p_batch_id uuid, p_items jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  receipt public.budget_save_batches;
  item jsonb;
  amount_value bigint;
  item_count integer;
  inserted_count integer;
begin
  if owner_id is null then raise exception '로그인이 필요합니다.'; end if;
  if p_batch_id is null or p_items is null or jsonb_typeof(p_items) <> 'array'
    or jsonb_array_length(p_items) not between 1 and 100 or octet_length(p_items::text) > 100000
    then raise exception '저장할 내역을 확인해 주세요.'; end if;
  item_count := jsonb_array_length(p_items);
  insert into public.budget_save_batches(user_id, id, payload_hash, entry_count)
    values(owner_id, p_batch_id, md5(p_items::text), item_count)
    on conflict (user_id, id) do nothing;
  get diagnostics inserted_count = row_count;
  if inserted_count = 0 then
    select * into strict receipt from public.budget_save_batches where user_id = owner_id and id = p_batch_id;
    if receipt.payload_hash <> md5(p_items::text) then raise exception '저장 요청이 변경되었습니다. 기존 결과를 먼저 확인해 주세요.'; end if;
    return jsonb_build_object('count', receipt.entry_count, 'reused', true);
  end if;
  for item in select value from jsonb_array_elements(p_items) loop
    if nullif(btrim(item->>'place'), '') is null or coalesce(item->>'date','') !~ '^\d{4}-\d{2}-\d{2}$'
      or jsonb_typeof(item->'amount') is distinct from 'number'
      then raise exception '날짜, 이름, 금액을 확인해 주세요.'; end if;
    if (item->>'amount')::numeric <> trunc((item->>'amount')::numeric) then raise exception '금액은 정수로 입력해 주세요.'; end if;
    amount_value := (item->>'amount')::bigint;
    if amount_value <= 0 then raise exception '금액은 0원보다 커야 합니다.'; end if;
    if item->>'type' = 'income' then
      insert into public.budget_income(user_id,date,amount,name,memo)
        values(owner_id,(item->>'date')::date,amount_value,btrim(item->>'place'),coalesce(btrim(item->>'memo'),''));
    elsif item->>'type' = 'saving' then
      insert into public.budget_savings(user_id,date,amount,goal_name,memo)
        values(owner_id,(item->>'date')::date,amount_value,btrim(item->>'place'),coalesce(btrim(item->>'memo'),''));
    elsif coalesce(item->>'type','expense') = 'expense' then
      insert into public.budget_transactions(user_id,date,amount,place,category,payment,transaction_type,memo)
        values(owner_id,(item->>'date')::date,amount_value,btrim(item->>'place'),coalesce(nullif(item->>'category',''),'기타'),
          coalesce(nullif(item->>'payment',''),'체크카드'),coalesce(nullif(item->>'transaction_type',''),'일반 지출'),coalesce(btrim(item->>'memo'),''));
    else raise exception '지원하지 않는 내역 종류입니다.';
    end if;
  end loop;
  return jsonb_build_object('count', item_count, 'reused', false);
end;
$$;
revoke all on function public.save_budget_batch(uuid,jsonb) from public, anon;
grant execute on function public.save_budget_batch(uuid,jsonb) to authenticated;

alter table public.assistant_items add column if not exists recurrence_parent_id uuid;
create unique index if not exists assistant_items_owner_id_idx on public.assistant_items(user_id,id);
alter table public.assistant_items add constraint assistant_items_recurrence_owner_fkey
  foreign key (user_id,recurrence_parent_id) references public.assistant_items(user_id,id)
  on delete set null (recurrence_parent_id);
create unique index if not exists assistant_items_recurrence_parent_idx on public.assistant_items(recurrence_parent_id);

create or replace function public.set_assistant_item_completion(p_item_id uuid, p_completed boolean, p_expected_updated_at timestamptz)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  item public.assistant_items;
  base_day date;
  next_day date;
begin
  if owner_id is null then raise exception '로그인이 필요합니다.'; end if;
  if p_completed is null then raise exception '완료 상태가 필요합니다.'; end if;
  select * into item from public.assistant_items where id = p_item_id and user_id = owner_id for update;
  if not found then raise exception '할 일을 찾을 수 없습니다.'; end if;
  if (item.status = 'completed') = p_completed then return to_jsonb(item); end if;
  if p_expected_updated_at is null or item.updated_at is distinct from p_expected_updated_at then
    raise exception '다른 곳에서 변경된 할 일입니다. 다시 불러온 뒤 확인해 주세요.';
  end if;
  update public.assistant_items set status = case when p_completed then 'completed' when item.kind='waiting' then 'waiting' else 'open' end,
    completed_at = case when p_completed then now() else null end, updated_at=now()
    where id = item.id and user_id = owner_id returning * into item;
  if p_completed and item.recurrence_rule <> 'none' then
    base_day := coalesce((item.due_at at time zone 'Asia/Seoul')::date,(now() at time zone 'Asia/Seoul')::date);
    next_day := case item.recurrence_rule when 'daily' then base_day+1 when 'weekly' then base_day+7
      when 'monthly' then (base_day+interval '1 month')::date else null end;
    if next_day is null then raise exception '반복 주기를 확인해 주세요.'; end if;
    insert into public.assistant_items(user_id,title,kind,status,priority,project_id,due_at,recurrence_rule,source,recurrence_parent_id)
      values(owner_id,item.title,item.kind,case when item.kind='waiting' then 'waiting' else 'open' end,item.priority,item.project_id,
        (next_day + time '23:59') at time zone 'Asia/Seoul',item.recurrence_rule,'recurrence',item.id)
      on conflict (recurrence_parent_id) do nothing;
  end if;
  return to_jsonb(item);
end;
$$;
revoke all on function public.set_assistant_item_completion(uuid,boolean,timestamptz) from public, anon;
grant execute on function public.set_assistant_item_completion(uuid,boolean,timestamptz) to authenticated;

create or replace function public.decide_growth_review(p_review_id uuid, p_selection jsonb, p_expected_routines jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  review public.growth_ai_reviews;
  routine public.growth_routines;
  suggestion jsonb;
  target_id uuid;
  next_minutes integer;
  choice_count integer;
  chosen_count integer := 0;
  changed_ids uuid[] := '{}';
begin
  if owner_id is null then raise exception '로그인이 필요합니다.'; end if;
  if p_selection is null or jsonb_typeof(p_selection) <> 'array' or jsonb_array_length(p_selection)>6 then raise exception '선택한 제안을 확인해 주세요.'; end if;
  choice_count := jsonb_array_length(p_selection);
  if (select count(distinct value) from jsonb_array_elements_text(p_selection)) <> choice_count then raise exception '중복된 선택입니다.'; end if;
  select * into review from public.growth_ai_reviews where id=p_review_id and user_id=owner_id for update;
  if not found then raise exception '코칭을 찾을 수 없습니다.'; end if;
  if review.decision is not null then
    if review.decision_selection @> p_selection and p_selection @> review.decision_selection then return to_jsonb(review); end if;
    raise exception '이미 결정한 코칭입니다. 다시 불러와 주세요.';
  end if;
  -- Lock routines in stable order, including overlapping selections from another review.
  perform 1 from public.growth_routines where user_id=owner_id and id in
    (select (value->>'routineId')::uuid from jsonb_array_elements(review.suggestions) where p_selection ? (value->>'id'))
    order by id for update;
  for suggestion in select value from jsonb_array_elements(review.suggestions) where p_selection ? (value->>'id') loop
    target_id := (suggestion->>'routineId')::uuid;
    next_minutes := (suggestion->>'recommendedMinutes')::integer;
    if target_id is null or next_minutes is null or next_minutes not between 5 and 240 or target_id = any(changed_ids) then
      raise exception '적용할 루틴과 시간을 확인해 주세요.';
    end if;
    select * into routine from public.growth_routines where id=target_id and user_id=owner_id and enabled;
    if not found then raise exception '사용할 수 없는 루틴입니다. 다시 불러와 주세요.'; end if;
    if p_expected_routines->>target_id::text is null or routine.updated_at is distinct from (p_expected_routines->>target_id::text)::timestamptz then
      raise exception '루틴이 변경되었습니다. 최신 내용을 확인한 뒤 적용해 주세요.';
    end if;
    update public.growth_routines set target_minutes=next_minutes,updated_at=now() where id=target_id and user_id=owner_id;
    chosen_count := chosen_count+1;
    changed_ids := array_append(changed_ids,target_id);
  end loop;
  if chosen_count <> choice_count then raise exception '선택한 제안을 찾을 수 없습니다.'; end if;
  update public.growth_ai_reviews set decision=case when choice_count=0 then 'kept'
      when choice_count=jsonb_array_length(review.suggestions) then 'applied' else 'partial' end,
    decision_selection=p_selection, decided_at=now()
    where id=review.id and user_id=owner_id returning * into review;
  return to_jsonb(review);
end;
$$;
revoke all on function public.decide_growth_review(uuid,jsonb,jsonb) from public, anon;
grant execute on function public.decide_growth_review(uuid,jsonb,jsonb) to authenticated;

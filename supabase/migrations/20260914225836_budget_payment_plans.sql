-- User-entered monthly reminders. No automatic payment, transaction, or AI call.
create table public.budget_payment_plans (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200 and btrim(name) <> ''),
  merchant_key text generated always as (lower(regexp_replace(btrim(name), ' +', ' ', 'g'))) stored,
  amount bigint not null check (amount between 1 and 9007199254740991),
  due_day integer not null check (due_day between 1 and 31),
  start_month date not null check (start_month between date '0001-01-01' and date '9999-12-01' and extract(day from start_month) = 1),
  is_subscription boolean not null,
  last_used_on date check (last_used_on between date '0001-01-01' and date '9999-12-31'),
  enabled boolean not null,
  revision uuid not null,
  request_hash text not null,
  updated_at timestamptz not null default now(),
  unique (user_id, merchant_key)
);
alter table public.budget_payment_plans enable row level security;
revoke all on public.budget_payment_plans from anon, authenticated;
grant select, insert, update, delete on public.budget_payment_plans to authenticated;
grant all on public.budget_payment_plans to service_role;
create policy budget_payment_plans_owner on public.budget_payment_plans for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Small retry receipts survive plan deletion; never resurrect an old creation.
-- They contain request hashes and IDs, not copies of merchant/usage values.
create table public.budget_payment_plan_requests (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  payload_hash text not null,
  result jsonb not null,
  primary key (user_id, request_id)
);
alter table public.budget_payment_plan_requests enable row level security;
revoke all on public.budget_payment_plan_requests from anon, authenticated;
grant select, insert, delete on public.budget_payment_plan_requests to authenticated;
grant all on public.budget_payment_plan_requests to service_role;
create policy budget_payment_plan_requests_owner on public.budget_payment_plan_requests for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create function public.save_budget_payment_plan(p_owner uuid, p_id uuid, p_request_id uuid, p_expected jsonb, p_value jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  actor uuid := auth.uid();
  current_row public.budget_payment_plans%rowtype;
  requested public.budget_payment_plans%rowtype;
  payload_hash text;
  receipt public.budget_payment_plan_requests%rowtype;
  response jsonb;
begin
  if actor is null then raise exception '로그인이 필요해요.'; end if;
  if actor is distinct from p_owner then raise exception '로그인 계정이 바뀌었어요. 다시 확인해 주세요.'; end if;
  if p_id is null or p_request_id is null or octet_length(coalesce(p_expected::text,'') || coalesce(p_value::text,'')) > 10000 then
    raise exception '예정일 설정을 확인해 주세요.';
  end if;
  if p_expected is not null and (jsonb_typeof(p_expected) <> 'object' or p_expected->>'user_id' is distinct from actor::text or p_expected->>'id' is distinct from p_id::text) then
    raise exception '변경 전 설정의 계정을 확인해 주세요.';
  end if;
  if p_value is null and p_expected is null then raise exception '삭제할 설정을 확인해 주세요.'; end if;
  payload_hash := md5(jsonb_build_object('id',p_id,'expected',p_expected,'value',p_value)::text);
  -- Serialize this owner's plan changes and the per-owner maximum.
  perform pg_advisory_xact_lock(hashtextextended('budget-payment-plans:' || actor::text,0));
  select * into receipt from public.budget_payment_plan_requests where user_id=actor and request_id=p_request_id;
  if found then
    if receipt.payload_hash <> payload_hash then raise exception '같은 요청의 내용이 달라졌어요.'; end if;
    return receipt.result;
  end if;
  response := jsonb_build_object('id',p_id,'revision',p_request_id,'deleted',p_value is null);
  select * into current_row from public.budget_payment_plans where user_id=actor and id=p_id for update;
  if p_value is null and current_row.id is null then
    insert into public.budget_payment_plan_requests values(actor,p_request_id,payload_hash,response);
    return response;
  end if;
  if (p_expected is null and current_row.id is not null)
    or (p_expected is not null and (current_row.id is null or to_jsonb(current_row) <> p_expected)) then
    raise exception '예정일 설정이 다른 곳에서 바뀌었거나 삭제됐어요. 다시 불러온 뒤 확인해 주세요.';
  end if;
  if p_value is null then
    delete from public.budget_payment_plans where user_id=actor and id=p_id;
    insert into public.budget_payment_plan_requests values(actor,p_request_id,payload_hash,response);
    return response;
  end if;
  if jsonb_typeof(p_value) <> 'object' or
    p_value - array['name','amount','due_day','start_month','is_subscription','last_used_on','enabled'] <> '{}'::jsonb or
    not (p_value ?& array['name','amount','due_day','start_month','is_subscription','last_used_on','enabled']) or
    jsonb_typeof(p_value->'name') <> 'string' or jsonb_typeof(p_value->'amount') <> 'number' or
    jsonb_typeof(p_value->'due_day') <> 'number' or jsonb_typeof(p_value->'start_month') <> 'string' or
    jsonb_typeof(p_value->'is_subscription') <> 'boolean' or jsonb_typeof(p_value->'enabled') <> 'boolean' or
    jsonb_typeof(p_value->'last_used_on') not in ('string','null') then raise exception '예정일 설정 형식이 올바르지 않아요.'; end if;
  if (p_value->>'amount') !~ '^[0-9]+$' or (p_value->>'due_day') !~ '^[0-9]+$' or
    (p_value->>'start_month') !~ '^[0-9]{4}-(0[1-9]|1[0-2])-01$' or
    ((p_value->>'last_used_on') is not null and (p_value->>'last_used_on') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') then
    raise exception '금액·결제일·사용일을 확인해 주세요.';
  end if;
  requested := jsonb_populate_record(null::public.budget_payment_plans,p_value);
  if requested.last_used_on > current_date + 1 then raise exception '마지막 사용일은 미래 날짜로 저장할 수 없어요.'; end if;
  if not requested.is_subscription and requested.last_used_on is not null then raise exception '구독 항목의 사용일만 기록할 수 있어요.'; end if;
  if current_row.id is null then
    if (select count(*) from public.budget_payment_plans where user_id=actor) >= 100 then raise exception '예정일은 최대 100개까지 관리할 수 있어요.'; end if;
    insert into public.budget_payment_plans(id,user_id,name,amount,due_day,start_month,is_subscription,last_used_on,enabled,revision,request_hash)
    values(p_id,actor,requested.name,requested.amount,requested.due_day,requested.start_month,requested.is_subscription,requested.last_used_on,requested.enabled,p_request_id,payload_hash);
  else
    update public.budget_payment_plans set name=requested.name,amount=requested.amount,due_day=requested.due_day,
      start_month=requested.start_month,is_subscription=requested.is_subscription,last_used_on=requested.last_used_on,
      enabled=requested.enabled,revision=p_request_id,request_hash=payload_hash,updated_at=clock_timestamp()
    where user_id=actor and id=p_id;
  end if;
  insert into public.budget_payment_plan_requests values(actor,p_request_id,payload_hash,response);
  return response;
end;
$$;
revoke all on function public.save_budget_payment_plan(uuid,uuid,uuid,jsonb,jsonb) from public,anon;
grant execute on function public.save_budget_payment_plan(uuid,uuid,uuid,jsonb,jsonb) to authenticated;

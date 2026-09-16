-- Extend existing owner-only history without rewriting any transaction.
alter table public.budget_category_changes
  alter column category drop not null,
  add column field_name text,
  add column field_value jsonb,
  add constraint budget_change_kind check (
    (field_name is null and field_value is null and category is not null)
    or (field_name is not null and field_name in ('amount','date','payment','place','memo') and field_value is not null and category is null)
  );
alter table public.budget_category_change_items add column before_value jsonb;

create function public.change_budget_expense_fields(p_request_id uuid,p_rows jsonb,p_field text,p_value jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  owner_id uuid := auth.uid();
  receipt public.budget_category_changes;
  entry jsonb;
  transaction_row public.budget_transactions;
  old_value jsonb;
  request_hash text;
  value_text text;
  date_value date;
begin
  if owner_id is null then raise exception '로그인이 필요합니다.' using errcode='42501'; end if;
  if p_request_id is null or p_rows is null or jsonb_typeof(p_rows)<>'array'
    or jsonb_array_length(p_rows) not between 1 and 100 or octet_length(p_rows::text)>200000
    or p_field is null or p_field not in ('amount','date','payment','place','memo') or p_value is null then
    raise exception '선택한 내역과 수정할 항목을 확인해 주세요.';
  end if;
  value_text := p_value #>> '{}';
  if p_field='amount' then
    if jsonb_typeof(p_value)<>'number' then raise exception '금액은 숫자로 입력해 주세요.'; end if;
    if value_text::numeric<>trunc(value_text::numeric) or value_text::numeric not between 1 and 9007199254740991 then
      raise exception '각 내역의 새 금액을 0보다 큰 안전한 정수로 입력해 주세요.';
    end if;
  else
    if jsonb_typeof(p_value)<>'string' then raise exception '수정할 값을 문자로 입력해 주세요.'; end if;
    if p_field='date' then
      if value_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception '날짜를 확인해 주세요.'; end if;
      date_value := value_text::date;
      if date_value not between date '0001-01-01' and date '9999-12-31' or to_char(date_value,'YYYY-MM-DD')<>value_text then raise exception '실제로 있는 날짜를 입력해 주세요.'; end if;
    elsif p_field='place' then
      if length(btrim(value_text)) not between 1 and 200 or value_text<>btrim(value_text) then raise exception '장소는 1~200자로 입력해 주세요.'; end if;
    elsif p_field='memo' then
      if length(value_text)>1000 then raise exception '메모는 1,000자 이내로 입력해 주세요.'; end if;
    elsif p_field='payment' then
      if value_text not in ('현금','계좌이체','체크카드','휴대폰 소액결제','충전카드') then raise exception '결제수단을 선택해 주세요.'; end if;
    end if;
  end if;
  if (select count(distinct value->>'id') from jsonb_array_elements(p_rows))<>jsonb_array_length(p_rows) then
    raise exception '내역 선택이 중복되거나 비어 있습니다.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('app-record-reset:'||owner_id::text,0));
  request_hash := md5(jsonb_build_array('expense-field-v1',p_rows,p_field,p_value)::text);
  select * into receipt from public.budget_category_changes where user_id=owner_id and id=p_request_id;
  if found then
    if receipt.payload_hash<>request_hash then raise exception '이미 사용한 변경 요청입니다. 결과를 먼저 확인해 주세요.'; end if;
    return jsonb_build_object('count',receipt.entry_count,'reused',true,'undone',receipt.undone_at is not null);
  end if;
  insert into public.budget_category_changes(user_id,id,payload_hash,entry_count,field_name,field_value)
    values(owner_id,p_request_id,request_hash,jsonb_array_length(p_rows),p_field,p_value);
  for entry in select value from jsonb_array_elements(p_rows) order by value->>'id' loop
    select * into transaction_row from public.budget_transactions
      where user_id=owner_id and id=(entry->>'id')::uuid for update;
    if not found or to_jsonb(transaction_row) is distinct from entry->'expected' then
      raise exception '기록이 다른 곳에서 변경되었거나 삭제되었습니다. 새로 불러온 뒤 다시 선택해 주세요.';
    end if;
    old_value := to_jsonb(transaction_row)->p_field;
    update public.budget_transactions set
      amount=case when p_field='amount' then value_text::bigint else amount end,
      date=case when p_field='date' then date_value else date end,
      payment=case when p_field='payment' then value_text else payment end,
      place=case when p_field='place' then value_text else place end,
      memo=case when p_field='memo' then value_text else memo end
      where user_id=owner_id and id=transaction_row.id returning * into transaction_row;
    insert into public.budget_category_change_items(user_id,change_id,transaction_id,before_value,after_hash)
      values(owner_id,p_request_id,transaction_row.id,old_value,md5(to_jsonb(transaction_row)::text));
  end loop;
  return jsonb_build_object('count',jsonb_array_length(p_rows),'reused',false,'undone',false);
end;
$$;
revoke all on function public.change_budget_expense_fields(uuid,jsonb,text,jsonb) from public,anon;
grant execute on function public.change_budget_expense_fields(uuid,jsonb,text,jsonb) to authenticated;

comment on table public.budget_category_changes is '사용자 자신의 지출 분류·항목 수정 이력. 수정한 항목의 값만 기록하며 삭제한 거래의 상세는 함께 제거. 위변조 방지 감사 로그가 아님.';

-- Preserve existing category undo, including category-memory conflict checks.
create or replace function public.undo_budget_category_change(p_change_id uuid)
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
    if receipt.field_name is not null and item.before_value is null then raise exception '변경 전 값을 확인하지 못했어요.'; end if;
    update public.budget_transactions set
      category=case when receipt.field_name is null then item.before_category else category end,
      amount=case when receipt.field_name='amount' then (item.before_value #>> '{}')::bigint else amount end,
      date=case when receipt.field_name='date' then (item.before_value #>> '{}')::date else date end,
      payment=case when receipt.field_name='payment' then item.before_value #>> '{}' else payment end,
      place=case when receipt.field_name='place' then item.before_value #>> '{}' else place end,
      memo=case when receipt.field_name='memo' then item.before_value #>> '{}' else memo end
      where user_id=owner_id and id=item.transaction_id;
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


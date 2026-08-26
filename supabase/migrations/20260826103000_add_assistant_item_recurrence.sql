alter table public.assistant_items
  add column if not exists recurrence_rule text not null default 'none';

alter table public.assistant_items
  drop constraint if exists assistant_items_recurrence_rule_check;

alter table public.assistant_items
  add constraint assistant_items_recurrence_rule_check
  check (recurrence_rule in ('none', 'daily', 'weekly', 'monthly'));

comment on column public.assistant_items.recurrence_rule is
  '할 일 반복 주기: none, daily, weekly, monthly';

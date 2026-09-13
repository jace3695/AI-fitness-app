-- Disposable CI fixture, not a production migration or a hosted schema dump.
-- Only contracts exercised by the isolated browser scenarios are provisioned.
create table public.user_app_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.user_app_state enable row level security;
revoke all on public.user_app_state from anon, authenticated;
grant select, insert, update, delete on public.user_app_state to authenticated;
grant all on public.user_app_state to service_role;
create policy owner_select on public.user_app_state for select to authenticated
  using ((select auth.uid()) = user_id);
create policy owner_insert on public.user_app_state for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy owner_update on public.user_app_state for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy owner_delete on public.user_app_state for delete to authenticated
  using ((select auth.uid()) = user_id);

create table public.language_user_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.language_user_state enable row level security;
revoke all on public.language_user_state from anon, authenticated;
grant select, insert, update, delete on public.language_user_state to authenticated;
grant all on public.language_user_state to service_role;
create policy language_owner_select on public.language_user_state for select to authenticated
  using ((select auth.uid()) = user_id);
create policy language_owner_insert on public.language_user_state for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy language_owner_update on public.language_user_state for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy language_owner_delete on public.language_user_state for delete to authenticated
  using ((select auth.uid()) = user_id);

create table public.budget_user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  currency text not null default 'KRW',
  notifications_enabled boolean not null default true,
  budget_alert_enabled boolean not null default true,
  simple_pin_enabled boolean not null default false,
  simple_pin_hash text
);
alter table public.budget_user_settings enable row level security;
revoke all on public.budget_user_settings from anon, authenticated;
grant select on public.budget_user_settings to authenticated;
grant all on public.budget_user_settings to service_role;
create policy owner_select on public.budget_user_settings for select to authenticated
  using ((select auth.uid()) = user_id);

-- Root usage notifier's read dependency. No provider call, quota RPC or costs.
create table public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('google', 'openai')),
  model text not null,
  feature text not null,
  usage_kind text not null default 'tokens' check (usage_kind in ('tokens', 'characters')),
  input_units bigint not null default 0 check (input_units >= 0),
  output_units bigint not null default 0 check (output_units >= 0),
  cost_krw numeric(12,4) not null check (cost_krw >= 0),
  is_reservation boolean not null default true,
  created_at timestamptz not null default now(),
  finalized_at timestamptz
);
create index ai_usage_events_user_created_idx on public.ai_usage_events (user_id, created_at desc);
alter table public.ai_usage_events enable row level security;
revoke all on public.ai_usage_events from anon, authenticated;
grant select on public.ai_usage_events to authenticated;
grant all on public.ai_usage_events to service_role;
create policy owner_select on public.ai_usage_events for select to authenticated
  using ((select auth.uid()) = user_id);

-- Minimal real budget contract for delete-and-undo verification. Every row is
-- owned by a disposable Auth user and is removed by the user FK cascade.
create table public.budget_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null
);
alter table public.budget_profiles enable row level security;
revoke all on public.budget_profiles from anon, authenticated;
grant select, insert, update, delete on public.budget_profiles to authenticated;
grant all on public.budget_profiles to service_role;
create policy budget_profiles_owner_all on public.budget_profiles for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create table public.budget_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  amount bigint not null,
  place text not null,
  category text not null,
  payment text,
  transaction_type text,
  memo text,
  created_at timestamptz not null default now()
);
alter table public.budget_transactions enable row level security;
revoke all on public.budget_transactions from anon, authenticated;
grant select, insert, update, delete on public.budget_transactions to authenticated;
grant all on public.budget_transactions to service_role;
create policy budget_transactions_owner_all on public.budget_transactions for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create table public.budget_income (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  amount bigint not null,
  name text not null,
  memo text,
  created_at timestamptz not null default now()
);
alter table public.budget_income enable row level security;
revoke all on public.budget_income from anon, authenticated;
grant select, insert, update, delete on public.budget_income to authenticated;
grant all on public.budget_income to service_role;
create policy budget_income_owner_all on public.budget_income for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create table public.budget_savings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  amount bigint not null,
  goal_name text not null,
  memo text,
  created_at timestamptz not null default now()
);
alter table public.budget_savings enable row level security;
revoke all on public.budget_savings from anon, authenticated;
grant select, insert, update, delete on public.budget_savings to authenticated;
grant all on public.budget_savings to service_role;
create policy budget_savings_owner_all on public.budget_savings for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create table public.budget_monthly_budgets (
  user_id uuid not null references auth.users(id) on delete cascade,
  budget_month date not null,
  total_amount bigint not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, budget_month)
);
alter table public.budget_monthly_budgets enable row level security;
revoke all on public.budget_monthly_budgets from anon, authenticated;
grant select, insert, update, delete on public.budget_monthly_budgets to authenticated;
grant all on public.budget_monthly_budgets to service_role;
create policy budget_monthly_owner_all on public.budget_monthly_budgets for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create table public.budget_category_budgets (
  user_id uuid not null references auth.users(id) on delete cascade,
  budget_month date not null,
  category text not null,
  amount bigint not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, budget_month, category)
);
alter table public.budget_category_budgets enable row level security;
revoke all on public.budget_category_budgets from anon, authenticated;
grant select, insert, update, delete on public.budget_category_budgets to authenticated;
grant all on public.budget_category_budgets to service_role;
create policy budget_category_owner_all on public.budget_category_budgets for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create table public.budget_recurring_expense_preferences (
  user_id uuid not null references auth.users(id) on delete cascade,
  signature text not null,
  name text not null,
  category text not null,
  status text not null,
  average_amount bigint not null default 0,
  last_detected_on date,
  updated_at timestamptz not null default now(),
  primary key (user_id, signature)
);
alter table public.budget_recurring_expense_preferences enable row level security;
revoke all on public.budget_recurring_expense_preferences from anon, authenticated;
grant select, insert, update, delete on public.budget_recurring_expense_preferences to authenticated;
grant all on public.budget_recurring_expense_preferences to service_role;
create policy budget_recurring_owner_all on public.budget_recurring_expense_preferences for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Read contracts used by the authenticated AI Yeoni briefing. The scenario
-- does not call an AI provider or write personal-assistant/growth records.
create table public.assistant_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  status text not null default 'active',
  priority integer not null default 3,
  due_date date,
  created_at timestamptz not null default now()
);
create table public.assistant_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  kind text not null default 'task',
  status text not null default 'open',
  priority integer not null default 3,
  project_id uuid references public.assistant_projects(id) on delete set null,
  due_at timestamptz,
  recurrence_rule text not null default 'none',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.assistant_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  topic text not null,
  content text not null,
  created_at timestamptz not null default now()
);
create table public.assistant_chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null,
  content text not null,
  action_label text,
  action_href text,
  created_at timestamptz not null default now()
);

alter table public.assistant_projects enable row level security;
alter table public.assistant_items enable row level security;
alter table public.assistant_memories enable row level security;
alter table public.assistant_chat_messages enable row level security;
revoke all on public.assistant_projects, public.assistant_items, public.assistant_memories, public.assistant_chat_messages from anon, authenticated;
grant select on public.assistant_projects, public.assistant_items, public.assistant_memories, public.assistant_chat_messages to authenticated;
grant all on public.assistant_projects, public.assistant_items, public.assistant_memories, public.assistant_chat_messages to service_role;
create policy assistant_projects_owner_select on public.assistant_projects for select to authenticated using ((select auth.uid()) = user_id);
create policy assistant_items_owner_select on public.assistant_items for select to authenticated using ((select auth.uid()) = user_id);
create policy assistant_memories_owner_select on public.assistant_memories for select to authenticated using ((select auth.uid()) = user_id);
create policy assistant_chat_owner_select on public.assistant_chat_messages for select to authenticated using ((select auth.uid()) = user_id);

create table public.growth_routines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null,
  title text not null,
  target_minutes integer not null default 15,
  preferred_days smallint[] not null default array[1, 2, 3, 4, 5, 6, 7]::smallint[] check (
    cardinality(preferred_days) between 1 and 7
    and preferred_days <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]
    and array_position(preferred_days, null) is null
    and cardinality(preferred_days) = (
      (1 = any(preferred_days))::integer
      + (2 = any(preferred_days))::integer
      + (3 = any(preferred_days))::integer
      + (4 = any(preferred_days))::integer
      + (5 = any(preferred_days))::integer
      + (6 = any(preferred_days))::integer
      + (7 = any(preferred_days))::integer
    )
  ),
  target_sessions_per_week smallint not null default 7 check (
    target_sessions_per_week between 1 and 7
    and target_sessions_per_week <= cardinality(preferred_days)
  ),
  enabled boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.growth_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  routine_id uuid references public.growth_routines(id) on delete set null,
  session_date date not null,
  status text not null,
  planned_minutes integer not null default 0,
  actual_minutes integer not null default 0,
  memo text not null default '',
  source text not null default 'manual',
  metrics jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.growth_routines enable row level security;
alter table public.growth_sessions enable row level security;
revoke all on public.growth_routines, public.growth_sessions from anon, authenticated;
grant select, insert, delete on public.growth_routines, public.growth_sessions to authenticated;
grant update (category, title, target_minutes, preferred_days, target_sessions_per_week, enabled, sort_order, updated_at) on public.growth_routines to authenticated;
grant update (routine_id, session_date, status, planned_minutes, actual_minutes, memo, metrics, started_at, ended_at, updated_at) on public.growth_sessions to authenticated;
grant all on public.growth_routines, public.growth_sessions to service_role;
create policy growth_routines_owner_select on public.growth_routines for select to authenticated using ((select auth.uid()) = user_id);
create policy growth_routines_owner_insert on public.growth_routines for insert to authenticated with check ((select auth.uid()) = user_id);
create policy growth_routines_owner_update on public.growth_routines for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy growth_routines_owner_delete on public.growth_routines for delete to authenticated using ((select auth.uid()) = user_id);
create policy growth_sessions_owner_select on public.growth_sessions for select to authenticated using ((select auth.uid()) = user_id);
create policy growth_sessions_owner_insert on public.growth_sessions for insert to authenticated with check (
  (select auth.uid()) = user_id
  and (routine_id is null or exists (select 1 from public.growth_routines where id = routine_id and user_id = (select auth.uid())))
);
create policy growth_sessions_owner_update on public.growth_sessions for update to authenticated using ((select auth.uid()) = user_id) with check (
  (select auth.uid()) = user_id
  and (routine_id is null or exists (select 1 from public.growth_routines where id = routine_id and user_id = (select auth.uid())))
);
create policy growth_sessions_owner_delete on public.growth_sessions for delete to authenticated using ((select auth.uid()) = user_id);

-- Disposable CI fixture, not a production migration or a hosted schema dump.
-- Only the sync contract and the real PIN-status dependency are provisioned.
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

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

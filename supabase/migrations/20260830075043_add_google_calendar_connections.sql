create table if not exists public.google_calendar_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  google_email text,
  calendar_id text not null default 'primary',
  access_token_ciphertext text not null,
  refresh_token_ciphertext text not null,
  token_expires_at timestamptz not null,
  scope text,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint google_calendar_connections_calendar_id_check check (calendar_id = 'primary'),
  constraint google_calendar_connections_email_length_check check (google_email is null or length(google_email) <= 320)
);

alter table public.google_calendar_connections enable row level security;

revoke all on table public.google_calendar_connections from anon, authenticated;
grant select, insert, update, delete on table public.google_calendar_connections to authenticated;

drop policy if exists "Users can read their Google Calendar connection" on public.google_calendar_connections;
drop policy if exists "Users can create their Google Calendar connection" on public.google_calendar_connections;
drop policy if exists "Users can update their Google Calendar connection" on public.google_calendar_connections;
drop policy if exists "Users can delete their Google Calendar connection" on public.google_calendar_connections;

create policy "Users can read their Google Calendar connection"
  on public.google_calendar_connections
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can create their Google Calendar connection"
  on public.google_calendar_connections
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update their Google Calendar connection"
  on public.google_calendar_connections
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete their Google Calendar connection"
  on public.google_calendar_connections
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

comment on table public.google_calendar_connections is
  'User-owned Google Calendar OAuth tokens encrypted by the application server.';

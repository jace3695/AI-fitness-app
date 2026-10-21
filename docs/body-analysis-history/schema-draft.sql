-- REVIEW DRAFT ONLY. Not applied; CLI migration generation is blocked.
-- Immutable user-confirmed local-rule analysis text. No images, raw records or AI calls.
create table public.body_analysis_history (
  user_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null,
  snapshot jsonb not null check (coalesce(
    jsonb_typeof(snapshot) = 'object' and jsonb_typeof(snapshot->'version') = 'number' and snapshot->>'version' = '1'
    and snapshot->>'source' = 'local-rules'
    and jsonb_typeof(snapshot->'text') = 'string'
    and length(btrim(snapshot->>'text')) between 1 and 12000
    and jsonb_typeof(snapshot->'date') = 'string'
    and (snapshot->>'date') ~ '^\d{4}-\d{2}-\d{2}$'
    and to_char((snapshot->>'date')::date, 'YYYY-MM-DD') = snapshot->>'date'
    and snapshot - array['version','source','date','text'] = '{}'::jsonb
    and octet_length(snapshot::text) <= 60000, false)),
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);
create index body_analysis_owner_created on public.body_analysis_history(user_id, created_at desc, id desc);
alter table public.body_analysis_history enable row level security;
revoke all on public.body_analysis_history from public, anon, authenticated;
grant select, delete on public.body_analysis_history to authenticated;
grant insert (id, user_id, snapshot) on public.body_analysis_history to authenticated;
create policy body_analysis_select on public.body_analysis_history for select to authenticated using ((select auth.uid()) = user_id);
create policy body_analysis_insert on public.body_analysis_history for insert to authenticated with check ((select auth.uid()) = user_id);
create policy body_analysis_delete on public.body_analysis_history for delete to authenticated using ((select auth.uid()) = user_id);

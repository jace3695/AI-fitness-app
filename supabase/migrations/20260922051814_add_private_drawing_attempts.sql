-- Drawings and self checks commit together, including compressed paper photos.
-- Immutable lesson/example snapshots keep older artwork readable after pack updates.
create table public.growth_drawing_attempts (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  revision integer not null default 1 check (revision > 0),
  status text not null check (status in ('draft', 'completed')),
  document jsonb not null check (coalesce((
    jsonb_typeof(document) = 'object'
    and document->>'schemaVersion' = '1'
    and jsonb_typeof(document->'lesson') = 'object'
    and jsonb_typeof(document->'example') = 'object'
    and jsonb_typeof(document->'strokes') = 'array'
    and octet_length(document::text) <= 3000000
  ), false)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index growth_drawing_attempts_owner_updated on public.growth_drawing_attempts (user_id, updated_at desc, id);
alter table public.growth_drawing_attempts enable row level security;
revoke all on public.growth_drawing_attempts from public, anon, authenticated;
grant select, delete on public.growth_drawing_attempts to authenticated;
grant insert (id, user_id, status, document) on public.growth_drawing_attempts to authenticated;
grant update (status, document, revision) on public.growth_drawing_attempts to authenticated;
create policy drawing_owner_select on public.growth_drawing_attempts for select to authenticated using ((select auth.uid()) = user_id);
create policy drawing_owner_insert on public.growth_drawing_attempts for insert to authenticated with check ((select auth.uid()) = user_id);
create policy drawing_owner_update on public.growth_drawing_attempts for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy drawing_owner_delete on public.growth_drawing_attempts for delete to authenticated using ((select auth.uid()) = user_id);
create function public.growth_drawing_touch() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.id <> old.id or new.user_id <> old.user_id or new.created_at <> old.created_at then
    raise exception 'drawing identity is immutable';
  end if;
  if new.revision <> old.revision + 1 then
    raise exception 'drawing revision must increase by one';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.growth_drawing_touch() from public, anon, authenticated;
create trigger drawing_touch before update on public.growth_drawing_attempts for each row execute function public.growth_drawing_touch();

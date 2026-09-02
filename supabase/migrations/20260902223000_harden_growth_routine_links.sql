drop policy if exists "Users can insert own growth sessions" on public.growth_sessions;
create policy "Users can insert own growth sessions" on public.growth_sessions
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and (
      routine_id is null
      or exists (
        select 1 from public.growth_routines
        where growth_routines.id = growth_sessions.routine_id
          and growth_routines.user_id = (select auth.uid())
      )
    )
  );

drop policy if exists "Users can update own growth sessions" on public.growth_sessions;
create policy "Users can update own growth sessions" on public.growth_sessions
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and (
      routine_id is null
      or exists (
        select 1 from public.growth_routines
        where growth_routines.id = growth_sessions.routine_id
          and growth_routines.user_id = (select auth.uid())
      )
    )
  );

drop policy if exists "Users can insert own growth resources" on public.growth_resources;
create policy "Users can insert own growth resources" on public.growth_resources
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and split_part(storage_path, '/', 1) = (select auth.uid())::text
    and (
      routine_id is null
      or exists (
        select 1 from public.growth_routines
        where growth_routines.id = growth_resources.routine_id
          and growth_routines.user_id = (select auth.uid())
      )
    )
  );

drop policy if exists "Users can update own growth resources" on public.growth_resources;
create policy "Users can update own growth resources" on public.growth_resources
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and split_part(storage_path, '/', 1) = (select auth.uid())::text
    and (
      routine_id is null
      or exists (
        select 1 from public.growth_routines
        where growth_routines.id = growth_resources.routine_id
          and growth_routines.user_id = (select auth.uid())
      )
    )
  );

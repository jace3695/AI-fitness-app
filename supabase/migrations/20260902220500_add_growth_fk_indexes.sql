create index if not exists growth_sessions_routine_fk_idx
  on public.growth_sessions (routine_id)
  where routine_id is not null;

create index if not exists growth_resources_routine_fk_idx
  on public.growth_resources (routine_id)
  where routine_id is not null;

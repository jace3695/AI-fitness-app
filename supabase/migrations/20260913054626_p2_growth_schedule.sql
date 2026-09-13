alter table public.growth_routines
  add column if not exists preferred_days smallint[] not null
    default array[1, 2, 3, 4, 5, 6, 7]::smallint[],
  add column if not exists target_sessions_per_week smallint not null default 7;

alter table public.growth_routines
  drop constraint if exists growth_routines_preferred_days_check,
  add constraint growth_routines_preferred_days_check check (
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
  drop constraint if exists growth_routines_weekly_target_check,
  add constraint growth_routines_weekly_target_check check (
    target_sessions_per_week between 1 and 7
    and target_sessions_per_week <= cardinality(preferred_days)
  );

grant update (preferred_days, target_sessions_per_week)
  on table public.growth_routines to authenticated;

comment on column public.growth_routines.preferred_days is
  'ISO weekday numbers (Monday=1 through Sunday=7) when the routine is planned.';
comment on column public.growth_routines.target_sessions_per_week is
  'Distinct completed days targeted each Monday-through-Sunday week.';

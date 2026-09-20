create table public.workout_actual_times (
  user_id uuid not null references auth.users(id) on delete cascade,
  recorded_on date not null,
  starts_at text not null check (starts_at ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  ends_at text not null check (ends_at ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  revision uuid not null,
  primary key(user_id, recorded_on),
  check (recorded_on >= date '1900-01-01'),
  check (starts_at < ends_at),
  check (recorded_on + ends_at::time <= timezone('Asia/Seoul', now()))
);
alter table public.workout_actual_times enable row level security;
revoke all on public.workout_actual_times from anon, authenticated;
grant select, delete on public.workout_actual_times to authenticated;
grant insert(user_id,recorded_on,starts_at,ends_at,revision) on public.workout_actual_times to authenticated;
grant update(starts_at,ends_at,revision) on public.workout_actual_times to authenticated;
grant all on public.workout_actual_times to service_role;
create policy workout_times_select on public.workout_actual_times for select to authenticated using ((select auth.uid())=user_id);
create policy workout_times_insert on public.workout_actual_times for insert to authenticated with check ((select auth.uid())=user_id);
create policy workout_times_update on public.workout_actual_times for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy workout_times_delete on public.workout_actual_times for delete to authenticated using ((select auth.uid())=user_id);

create function public.clear_workout_actual_times_on_reset()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if old.state->>'ai-fitness-record-reset-fitness' is distinct from new.state->>'ai-fitness-record-reset-fitness' then
    delete from public.workout_actual_times where user_id=new.user_id;
  end if;
  return new;
end;
$$;
revoke all on function public.clear_workout_actual_times_on_reset() from public, anon;
create trigger workout_actual_times_fitness_reset after update of state on public.user_app_state
for each row execute function public.clear_workout_actual_times_on_reset();

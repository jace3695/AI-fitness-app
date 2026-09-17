-- Explicit reusable amounts, independent of daily records. No backfill or plan changes.
create table public.diet_meal_favorites (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (name = btrim(name) and char_length(name) between 1 and 60),
  slot text not null check (slot in ('lunch', 'dinner')),
  food_protein numeric check (food_protein >= 0 and food_protein <= 300),
  rice_grams integer not null check (rice_grams between 0 and 1000),
  rice_name text not null check (rice_name = btrim(rice_name) and char_length(rice_name) between 1 and 60),
  supplement_protein integer not null check (supplement_protein between 0 and 300),
  created_at timestamptz not null default now(),
  constraint dinner_favorite_no_supplement check (slot = 'lunch' or supplement_protein = 0),
  unique (user_id, slot, name)
);
alter table public.diet_meal_favorites enable row level security;
revoke all on public.diet_meal_favorites from anon, authenticated;
grant select, delete on public.diet_meal_favorites to authenticated;
grant insert (id, user_id, name, slot, food_protein, rice_grams, rice_name, supplement_protein) on public.diet_meal_favorites to authenticated;
grant all on public.diet_meal_favorites to service_role;
create policy diet_favorites_select on public.diet_meal_favorites for select to authenticated using ((select auth.uid()) = user_id);
create policy diet_favorites_insert on public.diet_meal_favorites for insert to authenticated with check ((select auth.uid()) = user_id);
create policy diet_favorites_delete on public.diet_meal_favorites for delete to authenticated using ((select auth.uid()) = user_id);
comment on table public.diet_meal_favorites is 'User-confirmed reusable meal amounts; never a daily intake or completed meal record.';

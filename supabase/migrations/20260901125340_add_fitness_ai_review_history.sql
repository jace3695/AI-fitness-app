create table if not exists public.fitness_ai_review_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  analysis_type text not null check (
    analysis_type in ('latest', 'weekly', 'monthly', 'longTerm', 'plan', 'program')
  ),
  analysis_label text not null check (char_length(analysis_label) between 1 and 100),
  source text not null check (source in ('cloud', 'economy', 'local', 'recovered')),
  result_summary jsonb not null default '{}'::jsonb check (
    jsonb_typeof(result_summary) = 'object'
    and octet_length(result_summary::text) <= 20000
  ),
  baseline_7d jsonb not null default '{}'::jsonb check (
    jsonb_typeof(baseline_7d) = 'object'
    and octet_length(baseline_7d::text) <= 2000
  ),
  baseline_28d jsonb not null default '{}'::jsonb check (
    jsonb_typeof(baseline_28d) = 'object'
    and octet_length(baseline_28d::text) <= 2000
  ),
  decision text check (decision in ('applied', 'partial', 'kept')),
  decision_selection jsonb not null default '{}'::jsonb check (
    jsonb_typeof(decision_selection) = 'object'
    and octet_length(decision_selection::text) <= 4000
  ),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  constraint fitness_ai_review_history_decision_time_check check (
    (decision is null and decided_at is null)
    or (decision is not null and decided_at is not null)
  )
);

create index if not exists fitness_ai_review_history_user_created_idx
  on public.fitness_ai_review_history (user_id, created_at desc);

alter table public.fitness_ai_review_history enable row level security;

drop policy if exists "Users can read own fitness AI reviews" on public.fitness_ai_review_history;
create policy "Users can read own fitness AI reviews"
  on public.fitness_ai_review_history
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert own fitness AI reviews" on public.fitness_ai_review_history;
create policy "Users can insert own fitness AI reviews"
  on public.fitness_ai_review_history
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update own fitness AI review decisions" on public.fitness_ai_review_history;
create policy "Users can update own fitness AI review decisions"
  on public.fitness_ai_review_history
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all privileges on table public.fitness_ai_review_history from anon, authenticated;
grant select, insert on table public.fitness_ai_review_history to authenticated;
grant update (baseline_7d, baseline_28d, decision, decision_selection, decided_at)
  on table public.fitness_ai_review_history to authenticated;
grant all privileges on table public.fitness_ai_review_history to service_role;

comment on table public.fitness_ai_review_history is
  '사용자별 운동 AI 분석 요약과 계획 선택 및 선택 전 기준 지표. 원본 운동 기록은 저장하지 않는다.';

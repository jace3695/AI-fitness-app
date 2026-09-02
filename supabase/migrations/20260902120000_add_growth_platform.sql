create table if not exists public.growth_routines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in ('development', 'typing', 'handwriting', 'custom')),
  title text not null check (char_length(title) between 1 and 60),
  target_minutes integer not null default 15 check (target_minutes between 5 and 240),
  enabled boolean not null default true,
  sort_order integer not null default 0 check (sort_order between 0 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists growth_routines_user_sort_idx
  on public.growth_routines (user_id, enabled desc, sort_order, created_at);

create table if not exists public.growth_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  routine_id uuid references public.growth_routines(id) on delete set null,
  session_date date not null default current_date,
  status text not null check (status in ('completed', 'partial', 'stopped')),
  planned_minutes integer not null default 0 check (planned_minutes between 0 and 240),
  actual_minutes integer not null default 0 check (actual_minutes between 0 and 1440),
  memo text not null default '' check (char_length(memo) <= 500),
  source text not null default 'manual' check (source in ('manual', 'typing', 'handwriting', 'assistant')),
  metrics jsonb not null default '{}'::jsonb check (
    jsonb_typeof(metrics) = 'object'
    and octet_length(metrics::text) <= 4000
  ),
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint growth_sessions_time_order_check check (
    started_at is null or ended_at is null or ended_at >= started_at
  )
);

create index if not exists growth_sessions_user_date_idx
  on public.growth_sessions (user_id, session_date desc, created_at desc);
create index if not exists growth_sessions_user_routine_idx
  on public.growth_sessions (user_id, routine_id, session_date desc);

create table if not exists public.growth_resources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  routine_id uuid references public.growth_routines(id) on delete set null,
  title text not null check (char_length(title) between 1 and 120),
  category text not null default 'reference' check (category in ('development', 'typing', 'handwriting', 'custom', 'reference')),
  storage_path text not null unique check (char_length(storage_path) between 3 and 500),
  mime_type text not null check (char_length(mime_type) between 1 and 120),
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  classification text not null default 'reference' check (classification in ('direct', 'partial', 'reference', 'duplicate', 'deferred')),
  notes text not null default '' check (char_length(notes) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists growth_resources_user_created_idx
  on public.growth_resources (user_id, created_at desc);
create index if not exists growth_resources_user_routine_idx
  on public.growth_resources (user_id, routine_id, created_at desc);

create table if not exists public.growth_ai_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  summary jsonb not null default '{}'::jsonb check (
    jsonb_typeof(summary) = 'object'
    and octet_length(summary::text) <= 8000
  ),
  suggestions jsonb not null default '[]'::jsonb check (
    jsonb_typeof(suggestions) = 'array'
    and jsonb_array_length(suggestions) <= 6
    and octet_length(suggestions::text) <= 8000
  ),
  source text not null check (source in ('cloud', 'economy', 'local', 'recovered')),
  decision text check (decision in ('applied', 'partial', 'kept')),
  decision_selection jsonb not null default '[]'::jsonb check (
    jsonb_typeof(decision_selection) = 'array'
    and jsonb_array_length(decision_selection) <= 6
    and octet_length(decision_selection::text) <= 2000
  ),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  constraint growth_ai_reviews_period_check check (period_end >= period_start),
  constraint growth_ai_reviews_decision_time_check check (
    (decision is null and decided_at is null)
    or (decision is not null and decided_at is not null)
  )
);

create index if not exists growth_ai_reviews_user_created_idx
  on public.growth_ai_reviews (user_id, created_at desc);

alter table public.growth_routines enable row level security;
alter table public.growth_sessions enable row level security;
alter table public.growth_resources enable row level security;
alter table public.growth_ai_reviews enable row level security;

drop policy if exists "Users can read own growth routines" on public.growth_routines;
create policy "Users can read own growth routines" on public.growth_routines
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users can insert own growth routines" on public.growth_routines;
create policy "Users can insert own growth routines" on public.growth_routines
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Users can update own growth routines" on public.growth_routines;
create policy "Users can update own growth routines" on public.growth_routines
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
drop policy if exists "Users can delete own growth routines" on public.growth_routines;
create policy "Users can delete own growth routines" on public.growth_routines
  for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Users can read own growth sessions" on public.growth_sessions;
create policy "Users can read own growth sessions" on public.growth_sessions
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users can insert own growth sessions" on public.growth_sessions;
create policy "Users can insert own growth sessions" on public.growth_sessions
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Users can update own growth sessions" on public.growth_sessions;
create policy "Users can update own growth sessions" on public.growth_sessions
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
drop policy if exists "Users can delete own growth sessions" on public.growth_sessions;
create policy "Users can delete own growth sessions" on public.growth_sessions
  for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Users can read own growth resources" on public.growth_resources;
create policy "Users can read own growth resources" on public.growth_resources
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users can insert own growth resources" on public.growth_resources;
create policy "Users can insert own growth resources" on public.growth_resources
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Users can update own growth resources" on public.growth_resources;
create policy "Users can update own growth resources" on public.growth_resources
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
drop policy if exists "Users can delete own growth resources" on public.growth_resources;
create policy "Users can delete own growth resources" on public.growth_resources
  for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Users can read own growth AI reviews" on public.growth_ai_reviews;
create policy "Users can read own growth AI reviews" on public.growth_ai_reviews
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users can insert own growth AI reviews" on public.growth_ai_reviews;
create policy "Users can insert own growth AI reviews" on public.growth_ai_reviews
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Users can update own growth AI decisions" on public.growth_ai_reviews;
create policy "Users can update own growth AI decisions" on public.growth_ai_reviews
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all privileges on table public.growth_routines, public.growth_sessions, public.growth_resources, public.growth_ai_reviews from anon, authenticated;
grant select, insert, delete on table public.growth_routines, public.growth_sessions, public.growth_resources to authenticated;
grant update (category, title, target_minutes, enabled, sort_order, updated_at) on table public.growth_routines to authenticated;
grant update (routine_id, session_date, status, planned_minutes, actual_minutes, memo, metrics, started_at, ended_at, updated_at) on table public.growth_sessions to authenticated;
grant update (routine_id, title, category, classification, notes, updated_at) on table public.growth_resources to authenticated;
grant select on table public.growth_ai_reviews to authenticated;
grant insert (user_id, period_start, period_end, summary, suggestions, source) on table public.growth_ai_reviews to authenticated;
grant update (decision, decision_selection, decided_at) on table public.growth_ai_reviews to authenticated;
grant all privileges on table public.growth_routines, public.growth_sessions, public.growth_resources, public.growth_ai_reviews to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'growth-resources',
  'growth-resources',
  false,
  10485760,
  array[
    'application/pdf',
    'text/plain',
    'text/markdown',
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users can read own growth files" on storage.objects;
create policy "Users can read own growth files" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'growth-resources'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
drop policy if exists "Users can upload own growth files" on storage.objects;
create policy "Users can upload own growth files" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'growth-resources'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
drop policy if exists "Users can update own growth files" on storage.objects;
create policy "Users can update own growth files" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'growth-resources'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'growth-resources'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
drop policy if exists "Users can delete own growth files" on storage.objects;
create policy "Users can delete own growth files" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'growth-resources'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

comment on table public.growth_routines is '계정별 자기계발 루틴. 기존 기기 로컬 루틴을 최초 동기화할 수 있다.';
comment on table public.growth_sessions is '자기계발 실행·중단·완료 기록과 제한된 연습 지표.';
comment on table public.growth_resources is '비공개 Storage 파일의 분류·검색·루틴 연결 메타데이터.';
comment on table public.growth_ai_reviews is '비용 보호된 주간 AI 코칭 요약과 사용자의 명시적 적용 결정.';

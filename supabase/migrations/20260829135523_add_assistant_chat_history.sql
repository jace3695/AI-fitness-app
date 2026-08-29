create table if not exists public.assistant_chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) between 1 and 4000),
  action_label text,
  action_href text,
  created_at timestamptz not null default now()
);

create index if not exists assistant_chat_messages_user_created_idx
  on public.assistant_chat_messages (user_id, created_at desc);

alter table public.assistant_chat_messages enable row level security;

drop policy if exists "Users can read own assistant chat" on public.assistant_chat_messages;
create policy "Users can read own assistant chat"
  on public.assistant_chat_messages for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert own assistant chat" on public.assistant_chat_messages;
create policy "Users can insert own assistant chat"
  on public.assistant_chat_messages for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete own assistant chat" on public.assistant_chat_messages;
create policy "Users can delete own assistant chat"
  on public.assistant_chat_messages for delete
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all privileges on table public.assistant_chat_messages from anon;
revoke truncate, references, trigger, update on table public.assistant_chat_messages from authenticated;
grant select, insert, delete on table public.assistant_chat_messages to authenticated;
grant all privileges on table public.assistant_chat_messages to service_role;

comment on table public.assistant_chat_messages is
  '사용자별 연이 대화 기록. RLS로 본인의 대화만 조회·추가·삭제할 수 있다.';

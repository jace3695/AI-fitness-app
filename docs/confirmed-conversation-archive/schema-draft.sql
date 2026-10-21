-- REVIEW DRAFT ONLY: not a generated/applied service migration.
-- No existing table, data, policy, or service setting is changed.
create table public.confirmed_conversation_archive (
  user_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null,
  kind text not null check (kind in ('body-dialogue','japanese-practice')),
  snapshot jsonb,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id,id),
  check ((snapshot is null) = (deleted_at is not null)),
  check (snapshot is null or coalesce(
    jsonb_typeof(snapshot)='object' and snapshot->'version'='1'::jsonb
    and snapshot->>'kind'=kind and octet_length(snapshot::text)<=160000
    and (
      (kind='body-dialogue'
        and snapshot ?& array['version','kind','date','question','answer']
        and snapshot-array['version','kind','date','question','answer']='{}'::jsonb
        and jsonb_typeof(snapshot->'date')='string'
        and snapshot->>'date' ~ '^\d{4}-\d{2}-\d{2}$'
        and to_char((snapshot->>'date')::date,'YYYY-MM-DD')=snapshot->>'date'
        and jsonb_typeof(snapshot->'question')='string' and length(btrim(snapshot->>'question')) between 1 and 1000
        and jsonb_typeof(snapshot->'answer')='string' and length(btrim(snapshot->>'answer')) between 1 and 16000)
      or (kind='japanese-practice'
        and snapshot ?& array['version','kind','turn'] and snapshot-array['version','kind','turn']='{}'::jsonb
        and jsonb_typeof(snapshot->'turn')='object'
        and (snapshot->'turn') ?& array['id','text','situation','review','practiced']
        and (snapshot->'turn')-array['id','text','situation','review','practiced','reply']='{}'::jsonb
        and jsonb_typeof(snapshot#>'{turn,id}')='string' and length(snapshot#>>'{turn,id}') between 1 and 100
        and jsonb_typeof(snapshot#>'{turn,text}')='string' and length(btrim(snapshot#>>'{turn,text}')) between 1 and 1000
        and snapshot#>>'{turn,situation}' in ('카페','여행','일상','업무','친구')
        and jsonb_typeof(snapshot#>'{turn,review}')='boolean'
        and jsonb_typeof(snapshot#>'{turn,practiced}')='number'
        and snapshot#>>'{turn,practiced}' ~ '^\d+$'
        and (snapshot#>>'{turn,practiced}')::numeric between 0 and 9007199254740991
        and (not (snapshot->'turn') ? 'reply' or (
          jsonb_typeof(snapshot#>'{turn,reply}')='object'
          and (snapshot#>'{turn,reply}') ?& array['source','reply','replyReading','correction','explanation']
          and (snapshot#>'{turn,reply}')-array['source','reply','replyReading','correction','explanation']='{}'::jsonb
          and snapshot#>>'{turn,reply,source}'='ai'
          and jsonb_typeof(snapshot#>'{turn,reply,reply}')='string' and length(btrim(snapshot#>>'{turn,reply,reply}')) between 1 and 4000
          and jsonb_typeof(snapshot#>'{turn,reply,replyReading}')='string' and length(snapshot#>>'{turn,reply,replyReading}')<=4000
          and jsonb_typeof(snapshot#>'{turn,reply,correction}')='string' and length(snapshot#>>'{turn,reply,correction}')<=4000
          and jsonb_typeof(snapshot#>'{turn,reply,explanation}')='string' and length(snapshot#>>'{turn,reply,explanation}')<=4000
        )))
    ),false))
);
create index confirmed_archive_owner_kind_created on public.confirmed_conversation_archive(user_id,kind,created_at desc,id desc) where snapshot is not null;
create function public.enforce_confirmed_archive_immutable() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if TG_OP='INSERT' then
    if NEW.snapshot is null or NEW.deleted_at is not null then raise exception 'Content required'; end if;
  else
    if OLD.snapshot is null or NEW.snapshot is not null
      or NEW.user_id is distinct from OLD.user_id or NEW.id is distinct from OLD.id
      or NEW.kind is distinct from OLD.kind or NEW.created_at is distinct from OLD.created_at
    then raise exception 'Only content erasure is allowed'; end if;
    NEW.deleted_at=clock_timestamp();
  end if;
  return NEW;
end $$;
revoke all on function public.enforce_confirmed_archive_immutable() from public,anon,authenticated;
create trigger confirmed_archive_immutable before insert or update on public.confirmed_conversation_archive for each row execute function public.enforce_confirmed_archive_immutable();
alter table public.confirmed_conversation_archive enable row level security;
revoke all on public.confirmed_conversation_archive from public,anon,authenticated;
grant select on public.confirmed_conversation_archive to authenticated;
grant insert(user_id,id,kind,snapshot) on public.confirmed_conversation_archive to authenticated;
grant update(snapshot) on public.confirmed_conversation_archive to authenticated;
create policy confirmed_archive_select on public.confirmed_conversation_archive for select to authenticated using ((select auth.uid())=user_id);
create policy confirmed_archive_insert on public.confirmed_conversation_archive for insert to authenticated with check ((select auth.uid())=user_id);
create policy confirmed_archive_erase on public.confirmed_conversation_archive for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);

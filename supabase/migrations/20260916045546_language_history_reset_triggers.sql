-- Auth account deletion already cascades through the ledger's auth.users FK.
-- Do not run owner-facing invoker triggers during that Auth-admin cascade:
-- that internal role intentionally has no access to app history tables.
drop trigger assistant_language_history_language_reset on public.language_user_state;
drop trigger assistant_language_history_assistant_reset on public.user_app_state;
create or replace function public.clear_assistant_language_command_history()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if old.state->>tg_argv[0] is distinct from new.state->>tg_argv[0] then
    delete from public.assistant_language_command_history where user_id=new.user_id;
  end if;
  return new;
end;
$$;
create trigger assistant_language_history_language_reset after update of state on public.language_user_state
  for each row execute function public.clear_assistant_language_command_history('languageRecordResetV1');
create trigger assistant_language_history_assistant_reset after update of state on public.user_app_state
  for each row execute function public.clear_assistant_language_command_history('ai-fitness-record-reset-assistant');

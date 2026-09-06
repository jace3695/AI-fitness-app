-- Applied through Supabase migration add_app_record_resets, version 20260906141943.
-- App-owned record reset. No existing records are changed by installing this function.
-- SECURITY INVOKER retains authenticated users' RLS and never accepts a user ID.
grant delete on public.fitness_ai_review_history, public.growth_ai_reviews to authenticated;
create policy "Users can delete own fitness AI reviews" on public.fitness_ai_review_history
  for delete to authenticated using ((select auth.uid()) = user_id);
create policy "Users can delete own growth AI reviews" on public.growth_ai_reviews
  for delete to authenticated using ((select auth.uid()) = user_id);

create or replace function public.reset_my_app_records(p_app text, p_request_id uuid, p_confirmation text)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  current_state jsonb;
  next_state jsonb;
  marker_key text;
  marker text;
  record_keys text[];
begin
  if owner_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_app is null or p_app not in ('fitness','diet','language','growth','assistant','budget')
    or p_request_id is null or p_confirmation is distinct from '초기화' then
    raise exception 'Invalid reset confirmation' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('app-record-reset:' || owner_id::text, 0));
  marker_key := case when p_app = 'language' then 'languageRecordResetV1' else 'ai-fitness-record-reset-' || p_app end;
  if p_app = 'language' then
    insert into public.language_user_state(user_id, state, updated_at) values(owner_id, '{}'::jsonb, clock_timestamp()) on conflict (user_id) do nothing;
    select state into current_state from public.language_user_state where user_id = owner_id for update;
  else
    insert into public.user_app_state(user_id, state, updated_at) values(owner_id, '{}'::jsonb, clock_timestamp()) on conflict (user_id) do nothing;
    select state into current_state from public.user_app_state where user_id = owner_id for update;
  end if;
  if current_state is null then raise exception 'State is not accessible' using errcode = '42501'; end if;
  -- A retry after a lost response must not delete records created since that reset.
  marker := current_state ->> marker_key;
  if split_part(coalesce(marker, ''), '|', 2) = p_request_id::text then
    return jsonb_build_object('app', p_app, 'user_id', owner_id, 'marker', marker);
  end if;

  case p_app
  when 'fitness' then
    record_keys := array['ai-fitness-workout-completed-days','ai-fitness-switchon-set-completions','ai-fitness-switchon-ab-slide-checks','ai-fitness-pullup-progress','ai-fitness-weight-records','ai-fitness-inbody-records','ai-fitness-daily-notes','ai-fitness-recovery-mode-days','ai-fitness-daily-condition','ai-fitness-sleep-status','ai-fitness-alcohol-status','ai-fitness-workout-condition','ai-fitness-workout-plan-decision-history'];
    delete from public.fitness_ai_review_history where user_id = owner_id;
    if exists(select 1 from public.fitness_ai_review_history where user_id = owner_id) then raise exception 'Reset incomplete'; end if;
  when 'diet' then
    record_keys := array['ai-fitness-diet-completed-days','ai-fitness-diet-meal-log','ai-fitness-protein-total','ai-fitness-fasting-start-time','ai-fitness-fasting-completed','ai-fitness-water-intake','ai-fitness-dinner-carb-choice','ai-fitness-lunch-carb-choice','ai-fitness-lunch-protein-choice','ai-fitness-social-meal-mode','ai-fitness-diet-symptoms','ai-fitness-diet-dinner-completed-time'];
  when 'language' then
    record_keys := array['dailyRoutineProgress','dailyLearningHistory','japaneseCurriculumProgressV1','japaneseCurriculumReviewV1','savedWords','savedSentences','wrongKana','wrongKanaChars','wrongWords','wrongSentences','grammarProgress','reviewCompletedItemsByDate'];
  when 'growth' then
    record_keys := array[]::text[];
    delete from public.growth_sessions where user_id = owner_id;
    delete from public.growth_ai_reviews where user_id = owner_id;
    if exists(select 1 from public.growth_sessions where user_id = owner_id) or exists(select 1 from public.growth_ai_reviews where user_id = owner_id) then raise exception 'Reset incomplete'; end if;
  when 'assistant' then
    record_keys := array[]::text[];
    delete from public.assistant_chat_messages where user_id = owner_id;
    delete from public.assistant_items where user_id = owner_id;
    delete from public.assistant_projects where user_id = owner_id;
    delete from public.assistant_memories where user_id = owner_id;
    if exists(select 1 from public.assistant_chat_messages where user_id = owner_id) or exists(select 1 from public.assistant_items where user_id = owner_id) or exists(select 1 from public.assistant_projects where user_id = owner_id) or exists(select 1 from public.assistant_memories where user_id = owner_id) then raise exception 'Reset incomplete'; end if;
  when 'budget' then
    record_keys := array[]::text[];
    delete from public.budget_transactions where user_id = owner_id;
    delete from public.budget_income where user_id = owner_id;
    delete from public.budget_savings where user_id = owner_id;
    if exists(select 1 from public.budget_transactions where user_id = owner_id) or exists(select 1 from public.budget_income where user_id = owner_id) or exists(select 1 from public.budget_savings where user_id = owner_id) then raise exception 'Reset incomplete'; end if;
  end case;
  marker := to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' || p_request_id::text;
  next_state := (current_state - record_keys) || jsonb_build_object(marker_key, marker);
  if p_app = 'language' then
    update public.language_user_state set state = next_state, updated_at = clock_timestamp() where user_id = owner_id;
  else
    update public.user_app_state set state = next_state, updated_at = clock_timestamp() where user_id = owner_id;
  end if;
  if not found then raise exception 'State reset failed' using errcode = '42501'; end if;
  return jsonb_build_object('app', p_app, 'user_id', owner_id, 'marker', marker);
end;
$$;
revoke all on function public.reset_my_app_records(text, uuid, text) from public, anon;
grant execute on function public.reset_my_app_records(text, uuid, text) to authenticated;

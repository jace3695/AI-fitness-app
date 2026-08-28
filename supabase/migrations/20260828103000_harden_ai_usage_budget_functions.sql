drop function if exists public.finalize_ai_usage(uuid,bigint,bigint,numeric);
drop function if exists public.cancel_ai_budget_reservation(uuid);

create or replace function public.reserve_ai_budget(
  p_user_id uuid, p_provider text, p_model text, p_feature text,
  p_estimated_cost_krw numeric, p_usage_kind text default 'tokens'
) returns table (reservation_id uuid, spent_krw numeric, remaining_krw numeric)
language plpgsql security definer set search_path = '' as $$
declare v_spent numeric; v_id uuid; v_limit constant numeric := 10000;
begin
  if current_user not in ('postgres', 'service_role', 'supabase_admin') then raise exception 'unauthorized'; end if;
  if p_provider not in ('google', 'openai') or p_usage_kind not in ('tokens', 'characters') then raise exception 'invalid usage details'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || date_trunc('month', now())::text, 0));
  delete from public.ai_usage_events where user_id = p_user_id and is_reservation and created_at < now() - interval '15 minutes';
  select coalesce(sum(cost_krw), 0) into v_spent from public.ai_usage_events where user_id = p_user_id and created_at >= date_trunc('month', now());
  if v_spent + greatest(p_estimated_cost_krw, 0.01) > v_limit then return query select null::uuid, v_spent, greatest(v_limit-v_spent,0); return; end if;
  insert into public.ai_usage_events(user_id,provider,model,feature,usage_kind,cost_krw)
  values(p_user_id,p_provider,left(p_model,80),left(p_feature,80),p_usage_kind,greatest(p_estimated_cost_krw,0.01)) returning id into v_id;
  return query select v_id,v_spent+greatest(p_estimated_cost_krw,0.01),greatest(v_limit-v_spent-greatest(p_estimated_cost_krw,0.01),0);
end; $$;

create or replace function public.finalize_ai_usage(p_user_id uuid,p_reservation_id uuid,p_input_units bigint,p_output_units bigint,p_actual_cost_krw numeric)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if current_user not in ('postgres', 'service_role', 'supabase_admin') then raise exception 'unauthorized'; end if;
  update public.ai_usage_events set input_units=greatest(p_input_units,0),output_units=greatest(p_output_units,0),cost_krw=least(cost_krw,greatest(p_actual_cost_krw,0.01)),is_reservation=false,finalized_at=now()
  where id=p_reservation_id and user_id=p_user_id and is_reservation;
end; $$;

create or replace function public.cancel_ai_budget_reservation(p_user_id uuid,p_reservation_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if current_user not in ('postgres', 'service_role', 'supabase_admin') then raise exception 'unauthorized'; end if;
  delete from public.ai_usage_events where id=p_reservation_id and user_id=p_user_id and is_reservation;
end; $$;

revoke all on function public.reserve_ai_budget(uuid,text,text,text,numeric,text) from public,anon,authenticated;
revoke all on function public.finalize_ai_usage(uuid,uuid,bigint,bigint,numeric) from public,anon,authenticated;
revoke all on function public.cancel_ai_budget_reservation(uuid,uuid) from public,anon,authenticated;
grant execute on function public.reserve_ai_budget(uuid,text,text,text,numeric,text) to service_role;
grant execute on function public.finalize_ai_usage(uuid,uuid,bigint,bigint,numeric) to service_role;
grant execute on function public.cancel_ai_budget_reservation(uuid,uuid) to service_role;

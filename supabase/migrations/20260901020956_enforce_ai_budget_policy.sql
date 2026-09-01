-- The existing reserve_ai_budget function remains for backwards compatibility.
-- New server requests use this function so the 70% / 85% / 95% policy is
-- checked atomically with the reservation insert.
create or replace function public.reserve_ai_budget_with_policy(
  p_user_id uuid,
  p_provider text,
  p_model text,
  p_feature text,
  p_estimated_cost_krw numeric,
  p_usage_kind text default 'tokens'
) returns table (
  reservation_id uuid,
  spent_krw numeric,
  remaining_krw numeric,
  restriction_reason text
)
language plpgsql security definer set search_path = '' as $$
declare
  v_spent numeric;
  v_id uuid;
  v_estimated_cost numeric;
  v_limit constant numeric := 10000;
  v_high_performance_threshold constant numeric := 8500;
  v_paid_stop_threshold constant numeric := 9500;
begin
  if current_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception 'unauthorized';
  end if;
  if p_provider not in ('google', 'openai') or p_usage_kind not in ('tokens', 'characters')
    or coalesce(length(trim(p_model)), 0) = 0 or coalesce(length(trim(p_feature)), 0) = 0
    or p_estimated_cost_krw is null then
    raise exception 'invalid usage details';
  end if;

  v_estimated_cost := greatest(p_estimated_cost_krw, 0.01);
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || date_trunc('month', now())::text, 0));
  delete from public.ai_usage_events
    where user_id = p_user_id and is_reservation and created_at < now() - interval '15 minutes';
  select coalesce(sum(cost_krw), 0) into v_spent
    from public.ai_usage_events
    where user_id = p_user_id and created_at >= date_trunc('month', now());

  if v_spent + v_estimated_cost >= v_paid_stop_threshold then
    return query select null::uuid, v_spent, greatest(v_limit - v_spent, 0), 'paid_ai_paused'::text;
    return;
  end if;
  if p_model in ('gemini-3.7-flash') and v_spent + v_estimated_cost >= v_high_performance_threshold then
    return query select null::uuid, v_spent, greatest(v_limit - v_spent, 0), 'high_performance_limited'::text;
    return;
  end if;
  if v_spent + v_estimated_cost > v_limit then
    return query select null::uuid, v_spent, greatest(v_limit - v_spent, 0), 'monthly_limit'::text;
    return;
  end if;

  insert into public.ai_usage_events (user_id, provider, model, feature, usage_kind, cost_krw)
  values (p_user_id, p_provider, left(p_model, 80), left(p_feature, 80), p_usage_kind, v_estimated_cost)
  returning id into v_id;

  return query select v_id, v_spent + v_estimated_cost, greatest(v_limit - v_spent - v_estimated_cost, 0), null::text;
end;
$$;

revoke all on function public.reserve_ai_budget_with_policy(uuid, text, text, text, numeric, text) from public, anon, authenticated;
grant execute on function public.reserve_ai_budget_with_policy(uuid, text, text, text, numeric, text) to service_role;

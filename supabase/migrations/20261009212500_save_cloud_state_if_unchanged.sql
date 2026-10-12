-- Additive exact-evidence cloud save. Existing rows, tables, RLS, table grants,
-- reset functions, and older clients are unchanged. Older timestamp-only/direct
-- write clients remain unfenced and can still overwrite a newer value; rollout
-- remains blocked pending their retirement and authenticated multi-client QA.
-- This RPC has no timestamp-only or missing-RPC fallback.
create function public.save_cloud_state_if_unchanged(
  p_owner uuid,
  p_state jsonb,
  p_expected_updated_at timestamptz default null,
  p_expected_state jsonb default null
)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  server_timestamp timestamptz;
begin
  if owner_id is null or p_owner is distinct from owner_id then
    raise exception 'cloud_sync_owner_changed' using errcode = '42501';
  end if;
  -- SQL NULL / SQL NULL means the reader observed no row. A JSON null value is
  -- never an absent-row token. A present row needs both exact pieces of evidence.
  if (p_expected_updated_at is null) <> (p_expected_state is null)
    or (p_expected_state is not null and jsonb_typeof(p_expected_state) is distinct from 'object')
    or (p_expected_updated_at is not null and not isfinite(p_expected_updated_at)) then
    raise exception 'cloud_sync_invalid_expected' using errcode = '22023';
  end if;
  if jsonb_typeof(p_state) is distinct from 'object'
    or octet_length(p_state::text) > 5 * 1024 * 1024 then
    raise exception 'cloud_sync_invalid_state' using errcode = '22023';
  end if;
  -- readLocalCloudState/cloudChanges use this same top-level storage namespace.
  if exists (select 1 from jsonb_object_keys(p_state) as keys(key) where key not like 'ai-fitness-%') then
    raise exception 'cloud_sync_invalid_state' using errcode = '22023';
  end if;
  -- Traverse objects AND arrays. Reject dangerous property names at every depth
  -- without interpreting strings as JSON or including private values in errors.
  if exists (
    with recursive nodes(value) as (
      select p_state
      union all
      select child.value from nodes
      cross join lateral (
        select entry.value from jsonb_each(case when jsonb_typeof(nodes.value) = 'object' then nodes.value else '{}'::jsonb end) as entry
        union all
        select element.value from jsonb_array_elements(case when jsonb_typeof(nodes.value) = 'array' then nodes.value else '[]'::jsonb end) as element
      ) as child
    )
    select 1 from nodes where jsonb_typeof(value) = 'object'
      and value ?| array['__proto__', 'prototype', 'constructor']
  ) then
    raise exception 'cloud_sync_invalid_state' using errcode = '22023';
  end if;

  -- Same owner/reset transaction lock, acquired before either insert or update.
  -- The conditional UPDATE still compares the row itself, including writes from
  -- older clients that do not participate in this advisory lock.
  perform pg_advisory_xact_lock(hashtextextended('app-record-reset:' || owner_id::text, 0));
  server_timestamp := clock_timestamp();
  if p_expected_updated_at is null then
    insert into public.user_app_state(user_id, state, updated_at)
      values(owner_id, p_state, server_timestamp)
      on conflict (user_id) do nothing;
    return found;
  end if;

  begin
    update public.user_app_state as current_state
      set state = p_state,
          -- A server-generated monotonic revision, not an exact wall-clock time:
          -- collisions/rollback and legacy future timestamps must advance too.
          updated_at = greatest(server_timestamp, current_state.updated_at + interval '1 microsecond')
      where current_state.user_id = owner_id
        and current_state.updated_at = p_expected_updated_at
        and current_state.state = p_expected_state;
    return found;
  exception when datetime_field_overflow then
    -- A legacy maximum-finite timestamp cannot advance. Fail closed, preserving
    -- the row and emitting only a fixed code instead of any supplied evidence.
    raise exception 'cloud_sync_invalid_expected' using errcode = '22023';
  end;
end;
$$;
revoke all on function public.save_cloud_state_if_unchanged(uuid, jsonb, timestamptz, jsonb) from public, anon;
grant execute on function public.save_cloud_state_if_unchanged(uuid, jsonb, timestamptz, jsonb) to authenticated;

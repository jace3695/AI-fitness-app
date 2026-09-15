-- Empty by default. An administrator may authorize exactly three fixed-text
-- probes for a named user, expiring within 24 hours. No monthly free approval.
create table public.zephyr_probe_slots (
  slot smallint primary key check (slot between 1 and 3),
  request_id uuid not null unique default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  reserved_at timestamptz,
  key_fingerprint text,
  check (expires_at > created_at and expires_at <= created_at + interval '24 hours'),
  check ((reserved_at is null and key_fingerprint is null)
    or (reserved_at is not null and key_fingerprint is not null and key_fingerprint ~ '^[a-f0-9]{64}$'))
);
create index zephyr_probe_slots_user_idx on public.zephyr_probe_slots(user_id);
alter table public.zephyr_probe_slots enable row level security;
revoke all on public.zephyr_probe_slots from public, anon, authenticated, service_role;
grant select on public.zephyr_probe_slots to service_role;
grant update (reserved_at, key_fingerprint) on public.zephyr_probe_slots to service_role;

create function public.zephyr_probe_status(p_user_id uuid)
returns jsonb language sql security invoker set search_path = '' as $$
  select jsonb_build_object('slots', coalesce(jsonb_agg(jsonb_build_object(
    'slot', slot, 'requestId', request_id, 'reservedAt', reserved_at,
    'available', reserved_at is null and expires_at > clock_timestamp() + interval '1 minute'
  ) order by slot), '[]'::jsonb))
  from public.zephyr_probe_slots where user_id = p_user_id;
$$;

create function public.reserve_zephyr_probe(p_user_id uuid, p_request_id uuid, p_key_fingerprint text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  item public.zephyr_probe_slots%rowtype;
  stamp timestamptz;
begin
  if p_user_id is null or p_request_id is null or p_key_fingerprint is null
    or p_key_fingerprint !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('allowed', false, 'code', 'PROBE_NOT_AUTHORIZED');
  end if;
  select * into item from public.zephyr_probe_slots
    where request_id = p_request_id and user_id = p_user_id for update;
  if not found then return jsonb_build_object('allowed', false, 'code', 'PROBE_NOT_AUTHORIZED'); end if;
  if item.reserved_at is not null then
    return jsonb_build_object('allowed', false, 'code', 'DUPLICATE_REQUEST');
  end if;
  stamp := clock_timestamp();
  if item.expires_at <= stamp + interval '1 minute' then
    return jsonb_build_object('allowed', false, 'code', 'PROBE_EXPIRED');
  end if;
  update public.zephyr_probe_slots set reserved_at = stamp, key_fingerprint = p_key_fingerprint
    where request_id = p_request_id;
  return jsonb_build_object('allowed', true, 'code', 'RESERVED', 'requestId', p_request_id,
    'characters', 61, 'sendBefore', stamp + interval '10 seconds');
end;
$$;
revoke all on function public.zephyr_probe_status(uuid) from public, anon, authenticated;
revoke all on function public.reserve_zephyr_probe(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.zephyr_probe_status(uuid) to service_role;
grant execute on function public.reserve_zephyr_probe(uuid,uuid,text) to service_role;

-- One shared pool for this app, all users, deployments and API-key rotations.
-- No allowance is enabled by this migration. A trusted operator must verify the
-- billing account/project, key and other Chirp3 usage before each monthly grant.
create table public.zephyr_free_months (
  month date primary key check (extract(day from month) = 1),
  enabled boolean not null default false,
  key_fingerprint text check (key_fingerprint ~ '^[a-f0-9]{64}$'),
  billing_project_id text,
  billing_account_id text,
  verified_at timestamptz,
  valid_until timestamptz,
  external_used_chars integer check (external_used_chars >= 0),
  external_reserved_chars integer check (external_reserved_chars >= 0),
  app_limit_chars integer not null default 100000 check (app_limit_chars between 1 and 100000),
  reserved_chars integer not null default 0 check (reserved_chars >= 0 and reserved_chars <= app_limit_chars),
  -- Leave at least 100,000 characters below Google's documented 1M allowance.
  check (external_used_chars + external_reserved_chars + app_limit_chars <= 900000),
  check (not enabled or (
    key_fingerprint is not null and nullif(btrim(billing_project_id), '') is not null
    and nullif(btrim(billing_account_id), '') is not null
    and verified_at is not null and valid_until is not null
    and external_used_chars is not null and external_reserved_chars is not null
    and verified_at >= (month::timestamp at time zone 'America/Los_Angeles')
    and verified_at < valid_until
    and valid_until <= ((month + interval '1 month')::timestamp at time zone 'America/Los_Angeles')
  ))
);

create table public.zephyr_character_requests (
  request_id uuid primary key,
  month date not null references public.zephyr_free_months(month),
  -- Account deletion must not refund a shared allowance or delete retry receipts.
  user_id uuid references auth.users(id) on delete set null,
  characters integer not null check (characters between 1 and 1200),
  text_sha256 text not null,
  reserved_at timestamptz not null default clock_timestamp()
);
create index zephyr_requests_user_time_idx on public.zephyr_character_requests(user_id, reserved_at);
alter table public.zephyr_free_months enable row level security;
alter table public.zephyr_character_requests enable row level security;
revoke all on public.zephyr_free_months, public.zephyr_character_requests from public, anon, authenticated, service_role;
grant select, insert, update on public.zephyr_free_months to service_role;
grant select, insert on public.zephyr_character_requests to service_role;

create function public.zephyr_free_status(p_key_fingerprint text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_month date := date_trunc('month', v_now at time zone 'America/Los_Angeles')::date;
  v_pool public.zephyr_free_months;
begin
  select * into v_pool from public.zephyr_free_months where month = v_month;
  if not found or not v_pool.enabled or p_key_fingerprint is null
    or v_pool.key_fingerprint is distinct from p_key_fingerprint
    or v_pool.verified_at > v_now or v_pool.valid_until <= v_now + interval '2 minutes' then
    return jsonb_build_object('allowed', false, 'code', 'CONFIRMATION_REQUIRED');
  end if;
  return jsonb_build_object('allowed', v_pool.reserved_chars < v_pool.app_limit_chars,
    'code', case when v_pool.reserved_chars < v_pool.app_limit_chars then 'READY' else 'MONTH_LIMIT' end,
    'month', v_month, 'reservedCharacters', v_pool.reserved_chars,
    'limitCharacters', v_pool.app_limit_chars, 'remainingCharacters', v_pool.app_limit_chars - v_pool.reserved_chars);
end;
$$;

create function public.reserve_zephyr_characters(p_user_id uuid, p_request_id uuid, p_text text, p_key_fingerprint text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_now timestamptz;
  v_month date;
  v_chars integer := char_length(p_text);
  v_pool public.zephyr_free_months;
  v_daily integer;
  v_latest timestamptz;
  v_inserted uuid;
begin
  if p_user_id is null or p_request_id is null or p_text is null
    or v_chars not between 1 and 1200 or btrim(p_text) = '' then
    return jsonb_build_object('allowed', false, 'code', 'INVALID_REQUEST');
  end if;
  v_now := clock_timestamp();
  v_month := date_trunc('month', v_now at time zone 'America/Los_Angeles')::date;
  -- Serialize the whole shared pool, not an individual user's balance.
  select * into v_pool from public.zephyr_free_months where month = v_month for update;
  if not found then return jsonb_build_object('allowed', false, 'code', 'CONFIRMATION_REQUIRED'); end if;
  v_now := clock_timestamp();
  if v_month <> date_trunc('month', v_now at time zone 'America/Los_Angeles')::date
    or not v_pool.enabled or p_key_fingerprint is null
    or v_pool.key_fingerprint is distinct from p_key_fingerprint
    or v_pool.verified_at > v_now or v_pool.valid_until <= v_now + interval '2 minutes' then
    return jsonb_build_object('allowed', false, 'code', 'CONFIRMATION_REQUIRED');
  end if;
  if exists (select 1 from public.zephyr_character_requests where request_id = p_request_id) then
    -- Even a successful old receipt is NOT a new grant to call Google again.
    return jsonb_build_object('allowed', false, 'code', 'DUPLICATE_REQUEST');
  end if;
  if v_pool.reserved_chars + v_chars > v_pool.app_limit_chars then
    return jsonb_build_object('allowed', false, 'code', 'MONTH_LIMIT');
  end if;
  select coalesce(sum(characters), 0), max(reserved_at) into v_daily, v_latest
    from public.zephyr_character_requests where user_id = p_user_id
    and reserved_at >= (date_trunc('day', v_now at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles');
  if v_daily + v_chars > 5000 then return jsonb_build_object('allowed', false, 'code', 'DAY_LIMIT'); end if;
  if v_latest > v_now - interval '5 seconds' then return jsonb_build_object('allowed', false, 'code', 'TOO_FAST'); end if;
  insert into public.zephyr_character_requests(request_id, month, user_id, characters, text_sha256, reserved_at)
    values (p_request_id, v_month, p_user_id, v_chars, encode(sha256(convert_to(p_text, 'UTF8')), 'hex'), v_now)
    on conflict (request_id) do nothing returning request_id into v_inserted;
  if v_inserted is null then return jsonb_build_object('allowed', false, 'code', 'DUPLICATE_REQUEST'); end if;
  update public.zephyr_free_months set reserved_chars = reserved_chars + v_chars where month = v_month;
  -- Receipts and counters are never cancelled/refunded, even after a timeout.
  return jsonb_build_object('allowed', true, 'code', 'RESERVED', 'requestId', p_request_id,
    'characters', v_chars, 'remainingCharacters', v_pool.app_limit_chars - v_pool.reserved_chars - v_chars,
    'sendBefore', v_now + interval '10 seconds');
end;
$$;
revoke all on function public.zephyr_free_status(text) from public, anon, authenticated;
revoke all on function public.reserve_zephyr_characters(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.zephyr_free_status(text) to service_role;
grant execute on function public.reserve_zephyr_characters(uuid, uuid, text, text) to service_role;

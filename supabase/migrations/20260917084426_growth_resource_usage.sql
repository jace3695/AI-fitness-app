-- A reported calendar date, not inferred from upload/open/session timestamps.
-- Existing resources remain undated and all owner/routine policies stay intact.
alter table public.growth_resources
  add column last_used_on date,
  add constraint growth_resources_last_used_on_valid check (
    last_used_on is null or (
      last_used_on >= date '1900-01-01'
      and last_used_on <= (current_timestamp at time zone 'Asia/Seoul')::date
    )
  );

grant update (last_used_on) on public.growth_resources to authenticated;
comment on column public.growth_resources.last_used_on is
  'User-reported last usage date (Asia/Seoul); NULL means unrecorded. Opening a file does not update this value.';

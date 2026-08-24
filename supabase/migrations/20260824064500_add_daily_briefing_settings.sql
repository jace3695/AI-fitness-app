alter table public.push_subscriptions
  add column if not exists briefing_enabled boolean not null default true,
  add column if not exists briefing_time time without time zone not null default '07:30:00',
  add column if not exists last_briefing_date date;

comment on column public.push_subscriptions.briefing_enabled is '통합 오늘 브리핑 푸시 알림 사용 여부';
comment on column public.push_subscriptions.briefing_time is '구독 시간대 기준 통합 브리핑 발송 시각';
comment on column public.push_subscriptions.last_briefing_date is '통합 브리핑 마지막 발송 현지 날짜';

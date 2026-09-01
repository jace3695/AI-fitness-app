revoke insert on table public.fitness_ai_review_history from authenticated;

grant insert (
  user_id,
  analysis_type,
  analysis_label,
  source,
  result_summary,
  baseline_7d,
  baseline_28d
) on table public.fitness_ai_review_history to authenticated;

comment on column public.fitness_ai_review_history.result_summary is
  'AI 분석의 제한된 구조화 요약. 원본 운동 기록과 전체 프롬프트는 포함하지 않는다.';

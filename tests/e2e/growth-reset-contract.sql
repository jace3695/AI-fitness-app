-- Browser-only seed fragment: the disposable stack installs the latest reset
-- function without replaying 20260906141943_add_app_record_resets. Match that
-- migration's existing growth DELETE contract. Keep this out of schema.sql,
-- which other unit fixtures load before replaying the original migration.
grant delete on public.growth_ai_reviews to authenticated;
create policy "Users can delete own growth AI reviews" on public.growth_ai_reviews
  for delete to authenticated using ((select auth.uid()) = user_id);

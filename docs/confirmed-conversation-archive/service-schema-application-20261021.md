# Approved service schema application — 2026-10-21

Target: Jace App Hub, `piqqukiiacncfbztktga`, treated as Production. Parent verified Preview requests to this project; whether the Vercel Production app shares it remains unconfirmed.

Applied once through Supabase apply_migration:
- Version: `20261021131439`
- Name: `add_confirmed_body_analysis_and_conversation_archives`
- Result: `success: true`; subsequent migration catalog confirms this entry.

Exact source drafts, concatenated without SQL changes:
- `docs/body-analysis-history/schema-draft.sql`, SHA256 `dcb9017a261bd6d9c24c7e23614ec2c4e89442a18321141b2c411dd7b561ce0e`
- `docs/confirmed-conversation-archive/schema-draft.sql`, SHA256 `2c6ccca77cf4fa68312f9a351df49f9486fa8c8af6c91d96e57e95ca511edb53`

The draft headers describe their historical pre-application state. This document records the actual service application; the preserved candidate files were not edited.

## Preflight

Catalog query found no matching target tables, named indexes, or immutable function. Migration history had no corresponding application. Required auth.users, auth.uid(), anon and authenticated roles existed. No user-table rows were read.

## Post-application catalog verification

- Both tables exist, RLS enabled; 10 expected columns with correct nullability/defaults.
- Six owner policies restrict authenticated users using auth.uid() = user_id; archive UPDATE has both USING and WITH CHECK.
- Two explicit lookup indexes plus two automatic primary-key indexes exist; archive lookup index excludes null snapshots.
- Both primary keys are (user_id,id); both foreign keys reference auth.users(id) ON DELETE CASCADE.
- Four content/kind/deletion CHECK constraints are validated.
- Analysis grants: authenticated SELECT/DELETE, INSERT only id/user_id/snapshot; no UPDATE.
- Archive grants: authenticated SELECT, INSERT only user_id/id/kind/snapshot, UPDATE only snapshot; no DELETE.
- Neither PUBLIC nor anon has table/column grants. Existing service_role defaults remain; no new grants to that role were issued.
- Function enforce_confirmed_archive_immutable is SECURITY INVOKER with search_path=pg_catalog. anon/authenticated EXECUTE is false.
- One enabled BEFORE INSERT OR UPDATE trigger enforces immutable snapshots and content erasure, stamping deleted_at server-side.

## Limits and rollback

No test records, accounts, data migration, record deletion, external AI calls or app deployment were performed. No existing user data was queried or modified. Catalog verification is not authenticated end-to-end storage/RLS testing. Such testing and deployment still require their separate approvals.

Rollback means returning app code to the prior version while preserving new tables/content/tombstones. No table or data removal is authorized. The local runtime candidate remains `cdc47776ea186ea196c9802797d20ecab094a67657acd20e7ed40336cc134048`; this application report is separate evidence, not a new runtime candidate.

# G3: shared-record conflict selection and save evidence

Local development handoff, 2026-10-09 UTC. This documents the uncommitted G3 changes on the `ed4c7d0` local candidate. It does not authorize publication, migration installation, private-record conflict choices, or production rollout. Whole-repository validation is reported separately by the parent task.

## Scope and behavior

The root `CloudSyncPanel` now classifies the shared `user_app_state` / `ai-fitness-` namespace before autosync, including the first sync without a baseline. This is not a universal conflict inbox for the separate language, Live, growth, or blob stores.

- Independent object-field changes merge. Distinct edits to the same field require an explicit local/remote choice; there is no preselected winner. Deletion/absence and explicit null remain distinct. Concurrent arrays, parent deletion/edit, and structural replacements are atomic choices.
- A missing baseline cannot prove a deletion. The established record-reset generation policy remains authoritative and is reported separately; equal-time distinct reset markers retain the existing remote-side precedence.
- Pending local record keys and the latest unconfirmed read/write/local-application issue are shown separately. A lost write response does not mean the server rejected the write. This is a bounded current-sync surface, not a durable history of all failures.
- The in-memory review holds frozen original request/base/local and remote evidence. Reload reconstructs a new review from retained local/base state and a fresh remote read; choices are not automatically restored. Account changes remove the private prompt.

The new classifier is bounded to depth 40, 100,000 JSON nodes, 5 Mi characters per input tree, and 500 conflicting paths. Unsupported values, unsafe prototype keys, malformed supported legacy records, or exceeded bounds fail visibly without selecting a winner. The independent SQL payload limit is 5 MiB of JSONB text bytes.

## Exact evidence, remote CAS, and atomic acknowledgement

A review binds the owner, immutable session epoch, baseline acknowledgement identity, committed local-storage generation, exact local/base snapshots, and exact remote state plus revision. Unknown, duplicate, missing, or stale field choices are rejected. Local A→B→A and owner A→B→A are not treated as unchanged evidence.

`assertCloudSyncRequestCurrent` rechecks the evidence under the existing short storage lock. The subsequent remote request runs outside that lock. No network await or nested lock was added to the v2 journal/auth protocol. This guard is the local authorization point; it is not an indivisible cross-tab/network transaction.

`save_cloud_state_if_unchanged` receives the expected JSONB content and `updated_at` together in a POST body. Both expected arguments being SQL NULL means insert only if the row is absent. A present-row write must match both exact content and timestamp; same-timestamp changed content is rejected. Server-generated revisions advance monotonically, including a legacy future timestamp. Nonfinite/overflowing revisions fail with fixed errors. A successful write is followed by content readback before acknowledgement.

- Normal acknowledgement reclassifies input received during the request. A newly discovered same-field conflict preserves the local records **and the old baseline**, then requires a fresh review.
- An explicitly selected response acknowledges exactly the selected payload. Causally newer local edits after the guarded decision, including the same field, deletion, and array replacement, remain local and pending. Independent acknowledged changes still apply.
- Local records, the verified baseline, and the new acknowledgement identity commit atomically. Quota failures at each stage restore the old records/base/ack. Stale acknowledgements cannot replace a newer baseline. A genuine no-op issues no journal/generation write.
- Runtime namespace checks reject out-of-prefix roots on raw GET evidence, expected CAS state, outgoing state, and acknowledgement. Unknown roots are neither silently dropped nor presented as an empty/synced record set. Error messages contain no record values.

The existing generic backup/local merge functions remain unchanged; the autosync path uses the new conservative classifier.

## Supported legacy representations

A bounded audit covered every checked-in `user_app_state` writer, `assistant_*_store` call site, workout memo/cardio/feedback paths, diet base/meal/time/undo paths, reset functions, connector reads, `readRecordStores`, and DietView map readers. The supported object-map registry is exactly:

- `ai-fitness-workout-completed-days`
- `ai-fitness-diet-completed-days`
- `ai-fitness-water-intake`
- `ai-fitness-diet-meal-log`
- `ai-fitness-lunch-carb-choice`
- `ai-fitness-dinner-carb-choice`
- `ai-fitness-protein-total`
- `ai-fitness-diet-dinner-completed-time`
- `ai-fitness-lunch-protein-choice`
- `ai-fitness-social-meal-mode`

These match the existing `assistant_workout_store` and `assistant_diet_store` call sites. One JSON-string layer may decode to a safe plain object; every date, unknown field, nested value, and array order is retained. There is no schema projection or default-to-empty behavior.

The separate exact key `ai-fitness-fasting-start-time` follows `parseFastingStart` / `assistant_diet_fasting_value`: absent stays absent; empty/raw HH:mm, one JSON-wrapped empty/HH:mm, and a safe object date map are accepted. Null, arrays, other scalars, malformed strings, and repeated wrappers are rejected. Generic strings at other keys are not decoded and retain exact string type when applied locally.

Review and CAS evidence keep the untouched raw wire representations. Classification and postdispatch reconciliation use the canonical semantics. A legacy wrapper may therefore cause a **semantic-preserving encoding-only CAS** to a canonical object/clock, with the raw wrapper as the exact expected state. The outgoing payload, verified readback, local state, and acknowledged baseline agree. This is representation conversion, not a claim of unchanged serialized bytes. An unsubmitted conversion cannot be acknowledged as though it were the verified payload. No hosted conversion was executed.

## Migration and rollout dependency

New additive migration: `supabase/migrations/20261009212500_save_cloud_state_if_unchanged.sql`.

It requires the existing `user_app_state`, Auth roles, and reset coordination contract. The function is SECURITY INVOKER with an empty search path, explicitly checks `auth.uid()`, obeys existing RLS, and shares the existing owner/reset advisory lock. Only function execution permissions are added for authenticated users; existing tables, records, RLS, table grants, and reset functions are unchanged.

The client has no missing-RPC, timestamp-only, direct-PATCH, or upsert-overwrite fallback. Missing installation fails visibly and retains local evidence. Installation order, backup/rollback and hosted application require the separate authorized rollout procedure.

Older direct/timestamp-only clients can still overwrite a newer state because they do not obey this RPC. Mixed-version retirement/quiescence and real multi-client verification remain rollout blockers. The existing v1-journal preservation gate is unchanged; see [storage protocol v2](shared-storage-protocol-v2.md).

## Diagnostics and liveness limits

The opt-in development trace is metadata-only: operation/method, timing, status, condition shape, row/key counts and boolean match result. It does not retain/export state, field names, owner identity, raw URL/query, headers/tokens, revision values, or hashes. Equal counts are not content-equality evidence. The metadata auditor reports confirmation as unverified even when a readback is present; see [the diagnostic guide](../scripts/sync-qa/README.md). Synthetic E2E content assertions are a separate proof path.

Freshness deliberately uses the whole-origin committed generation. Any participating actual write, including an unrelated WorkoutSession checkpoint every 15 seconds while paused, can clear choices. Read-only/no-op sync does not. Repeated active-editor or other-tab writes can postpone resolution until the user saves/closes that editor or the origin briefly becomes quiescent. Newest checkpoint data remains preserved. This is an explicit liveness limitation, not a guarantee of interruption-free selection while another editor continuously writes.

## Verification and remaining acceptance

Executed locally with synthetic data:

- `node --experimental-strip-types --test app/data/cloudSync*.test.ts tests/cloud-sync-cas-migration.test.ts`: **102 passed, 0 failed**. Includes exact evidence, all conflict kinds, reset precedence, stale ABA, postdispatch edits, rollback, namespace rejection, actual record-reader legacy roundtrips, installed SDK transport/error/readback behavior, and **24 PGlite/source SQL cases**.
- Full TypeScript (`npx tsc --noEmit --incremental false`), scoped ESLint for the core/test files, and `git diff --check`: passed at core freeze.
- Adding `tests/cloud-sync-conflict-ui.test.ts lib/syncQaTrace.test.ts` to that focused command: **120 passed, 0 failed** total, including synthetic JSX controls and installed-SDK metadata-trace checks.
- `node scripts/qa-pr189-sync.mjs`: **49 passed, 0 failed**, using the shipping auth/sync handlers with synthetic server/storage/effect scheduling.

PGlite executes actual SQL/RLS on a single connection. Its ordered races are not simultaneous independent PostgreSQL-connection contention. The SDK and shipping-handler tests use synthetic servers/auth/effects; they are not browser or real-account tests.

`tests/e2e/sync-conflicts.spec.ts` authors seven disposable-account cases (14 across Chromium/WebKit): both field choices at small width and reload, stale remote/local changes, same-revision content races, reload/sign-out privacy, and lost-response recovery. Discovery is not execution. Browser launch remains blocked; no browser, physical-device/PWA, hosted migration, production data, actual private conflict choice, or real independent-connection contention passed as part of this work. Those gates and final operating approval remain open.

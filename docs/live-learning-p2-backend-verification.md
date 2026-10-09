# Japanese Live P2 backend candidate

Verification: 2026-10-09 18:38 UTC / 2026-10-10 03:38 KST.
Local base: `12e5d35f521fa0c1839ca34c022adf655b46b1c4` on
`agent/yeoni-cat-animation-poc`; this P2 work is uncommitted.
Implementation, synthetic verification, browser acceptance and deployment are
separate gates. This document covers the backend only.

## Implemented

- One owner-scoped, immutable `language_live_learning_batches` table holds the
  complete user-confirmed evidence for an exact lesson revision. Its JSON events
  contain explicit item identity, skill, result, certainty, date, source-field
  excerpt, reason, relearning linkage and separately confirmed teacher due date.
  This atomic batch envelope implements the P0 logical evidence/history model
  without duplicating legacy progress or adding mutable skill-state storage.
- An initial batch is version 1. Corrections and an explicit empty-evidence clear
  append another version using expected-version CAS. All old evidence stays
  readable. A clear affects only that exact lesson revision, and an older tab
  cannot restore its evidence by silently overwriting the newer generation.
- SQL validates exact source excerpts, source revision, item identity, links,
  bounds and request identity even for direct INSERT. RPC retries with identical
  payload return the immutable receipt; reused request IDs with changed payload
  fail. Read-back verifies the complete saved row and authenticated owner.
- Edited/deleted source revisions stop contributing immediately. Restoring a
  report does not silently revive old evidence. Explicit reconfirmation targets
  the restored revision and can retain original observation dates.
- Current state is rebuilt by a pure, deterministic reducer from a transaction-
  consistent owner snapshot, including lesson tombstones and inactive batches.
  RPC limits fail explicitly above 1,000 current lessons, 2,000 history batches,
  or 10 MB; they never return a truncated snapshot as current progress.
- Read-only practice links reuse existing Japanese routes. This implementation
  does not write legacy completion, review, cloud-sync or reset keys.

## Review policy

- Listening, speaking, reading and writing remain independent. No recorded
  evidence means unknown, not an invented unlearned/mastered row. Explicit
  not-learned evidence is a distinct state.
- Calendar-day intervals are 1, 3, 7, 14 and 30 days; continued long-term reviews
  retain the 30-day interval. Missing dates never become today's date.
- The original learning date requires an explicit dated learning observation.
  Review, hinted-success and relearning dates never fill an unknown original
  learning date, even when later spaced reviews establish mastery.
- Independent successes require explicit independent=true and hintUsed=false.
  Same-day repetition cannot inflate the interval or independent-success count.
  Mastery requires at least 3 distinct success dates spanning at least 7 days.
  This is a conservative product policy, not a language-proficiency score.
- Confirmed forgetting or errors on two distinct dates since the last independent
  success can require relearning. A single mistake does not prove forgetting.
  Relearning starts a fresh spaced-mastery run while preserving historical
  mastery references and the original learned date.
- Uncertain recognition/evaluation does not lower a known state, increase success
  or replace assessed evidence/due dates. Missed reviews create no fake failure,
  review, time or completion event.
- A confirmed teacher date and the calculated policy date are preserved
  separately. An unconfirmed or invalid recommendation does not override policy.
- Explicit same-day cross-report relearning links take precedence over UUID
  ordering, while each report's event order and actual dates are preserved.
  Contradictory causal cycles retain history but cannot create reassessment
  successes; they request clarification/reassessment instead.

## Executed checks

Command:

```sh
node --experimental-strip-types --test \
  lib/language-live/state-reducer.test.ts \
  lib/language-live/learning-repository.test.ts \
  tests/language-live-learning-migration.test.ts
```

Result: **61 passed, 0 failed, 0 skipped** (rerun with the UI review checks).

- 36 reducer/policy tests cover the five states, unknown values, date boundaries,
  delayed import order, same-day and spaced success, linked reassessment,
  forgetting/relearning/mastery history, source invalidation, restoration gates,
  owner scope, queue priorities, deterministic replay and legacy navigation.
- 9 repository/validation tests cover stable pending payloads, lost responses,
  exact read-back, account changes at every asynchronous boundary, malformed or
  incomplete snapshots, schema/network errors and identity-preserving matching.
- Independent UI review additionally found that post-commit readback errors were
  classified like rejected writes. Readback failures now always remain uncertain
  verification failures, even for schema/validation/conflict error codes. The
  input stays frozen, and retry uses the exact same request and payload; missing
  or mismatched rows also remain unverified. Regression coverage checks one
  committed batch and identical retry arguments for each error shape.
- 16 isolated PGlite tests execute both P1 and P2 SQL with synthetic users and
  roles. They cover append-only CAS/clear, idempotent receipts, atomic rollback,
  RLS/anon/cross-owner denial, direct INSERT protection, immutable identity,
  source correction/deletion/restoration, Unicode/input bounds, unknown-source
  rejection and unchanged legacy state/reset generation.
- The SQL snapshot is round-tripped through JSON, decoded by the production
  repository decoder and passed to the production reducer for the complete
  mastery → forgetting → relearning → same-day reassessment scenario.
- Two new ordering regressions failed before the reducer fix and passed after it.
- Independent backend review added two further regressions, both demonstrated
  failing before their fixes: explicitly `not_learned` source fields could supply
  contradictory confirmed achievement through RPC/direct INSERT; review,
  hinted-success and relearning dates could invent the missing original learning
  date. The SQL now accepts only explicit unlearned or uncertain observations from
  an unlearned field; the reducer preserves an unknown original learning date.
- Focused ESLint and TypeScript `--noEmit --incremental false` passed at this
  checkpoint. The parent task owns final aggregate checks after parallel UI work.

PGlite competing-write tests exercise serialized conflicting submissions in one
isolated database. They do not prove two independent hosted PostgreSQL sessions,
real Auth/PostgREST traffic, browser persistence or device synchronization.

## Changed files and integration

- `lib/language-live/learning-types.ts`
- `lib/language-live/learning-validation.ts`
- `lib/language-live/review-policy.ts`
- `lib/language-live/state-reducer.ts`
- `lib/language-live/state-reducer.test.ts`
- `lib/language-live/learning-repository.test.ts`
- `app/data/languageLiveLearningRepository.ts`
- `supabase/migrations/20261009173440_language_live_learning_history.sql`
- `tests/language-live-learning-migration.test.ts`
- `scripts/e2e-stack.mjs` adds the migration to the disposable local fixture.
- `tests/e2e/fixture.ts` checks synthetic learning-batch cleanup after test account
  deletion. Its service-role read grant exists only in the disposable seed.

## Remaining gates and deployment safety

- Parallel P2 UI work, actual authenticated browser flows, refresh/relogin,
  multi-tab/multi-device CAS, small-screen behavior and final production build
  remain separate acceptance evidence. The existing EPERM browser restriction
  was not retried or bypassed during this backend verification.
- P3 preparation history and the full P4 acceptance matrix are not completed by
  this backend candidate. No production readiness percentage is inferred.
- No hosted migration/data/RLS change, environment change, paid API call, commit,
  push, merge or deployment occurred. Local PGlite data is synthetic and disposed.
- Hosted application still requires exact-SQL approval, reconciliation of prior
  migration-history versions, backup/recovery confirmation and isolated real
  Auth/API/browser verification. Never apply a blanket hosted reset or history
  repair. Initial operational rollback is feature/navigation disable plus the
  previous app version, preserving all new history; no automatic DROP/TRUNCATE.

# Japanese Live P1 and handoff safety candidate

Baseline: `40480ea51dad01462ed63161301d7a01a21534c4`.
Local verification date: 2026-10-10 KST.

## Implemented, not deployed

- Manual v1/v1.1 report import with 25 fields, exact original text, preview/edit,
  missing-value distinctions and immutable revisions.
- Owner-scoped create/edit/delete/restore, idempotent request receipts, stale
  revision conflicts and independent read-back verification.
- Account-bound calls and per-tab recovery copies which preserve pending request
  identity. Recovery source snapshots intentionally remain on the device; the
  interface does not claim that deleting a recovered copy removes older copies.
- Additive local migration only. Existing Japanese progress and reset/sync
  records are unchanged. Hosted migration history must be reconciled before
  applying the exact SQL with separate production approval; never run a blanket
  hosted reset or migration repair.
- Calendar loading/error/disconnected/confirmed-empty states and guarded month
  requests. Upstream pagination fails explicitly rather than returning partial
  results. Valid empty Google collection envelopes remain supported.
- Additional routine interruption and diet symptom self-report choices, with
  existing values and unrecorded states preserved.

## Executed locally

- Full Node/PGlite suite: **850 passed, 0 failed, 0 skipped**.
- Full ESLint: passed.
- TypeScript `--noEmit`: passed.
- Next production build: passed, including `/language/live`.
- Independent persistence review identified and fixed duplicate opt-out,
  shared draft recovery, direct-insert and Unicode-limit inconsistencies.
- Focused tests and browser test discovery are supplementary evidence, not
  additional counts to add to the full unit-suite result.

These tests use synthetic data. No hosted database migration, real Google
Calendar call, AI/TTS/alignment request, production deployment or feature-flag
activation was performed.

## Still awaiting actual browser execution

- Ten Japanese Live scenarios in each Chromium/WebKit project, including
  lost responses, read-back failures, revisions, account transitions and
  same-origin multi-tab recovery.
- Four Google Calendar scenarios in each browser project.
- Five added routine/diet scenarios in each browser project.
- Twelve separate real media/Canvas reader lifecycle cases, described in
  `yeoni-general-validation/reader-lifecycle-20261010.md`.

The cloud workspace's direct Chromium launch is blocked by socket permissions,
including the supported escalation. No workaround or weakened browser security
was used. The new cases must execute in the normal isolated GitHub runner before
browser acceptance can be claimed. Test discovery and fixture bundling are not
browser passes. Hosted Preview authentication and physical iPhone/iPad/Pencil
checks remain distinct.

## Release gates

The existing baseline full-app run `37954896611` must terminate, with final
result, cleanup and artifacts preserved, before a new push. PR #208 stays Draft;
general reply alignment stays OFF. No main merge, production promotion, hosted
schema/RLS/environment modification or additional speech generation is included.

P2 learning states/review/relearning and P3 lesson preparation are subsequent
implementation stages, not completed by this P1 candidate.

## Coordinated candidate check, 2026-10-09 17:29 UTC

After adding isolated PHASE C statistics, the demonstrated drawing save-confirmation
barrier, synthetic Live screenshots, and reader-harness false-pass protection:

- Full Node/PGlite suite: **907 passed, 0 failed, 0 skipped**.
- Full ESLint, TypeScript and production build: passed.
- The baseline CI result is preserved separately in
  `handoff-baseline-ci-20261010.md`: 437/1, not a full pass.
- The stronger drawing test addresses a proved ordering gap but does not establish
  the sole cause of the historical Chromium protocol timeout. Official CI must
  verify the candidate. Failed-test cleanup timing is diagnostic only.
- New browser cases and synthetic screenshots still await official execution.
- PHASE C is isolated pure statistics; no automatic analysis, provider, billing,
  scheduling or Push activation is implied.

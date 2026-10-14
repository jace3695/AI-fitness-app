# Fitness priority development — locally verified candidate

## Follow-up verification result

- Full unit suite: **741 passed / 0 failed / 0 skipped**, exit 0 (`full-suite-final.log`).
- Actual React browser regressions: **11 passed** (`result.json`): date draft/calendar isolation, conflict cancellation/confirmation, invalid date correction, account and cross-tab epoch changes, late OCR, transactional quota rollback/retry, equipment exclusions, persisted guide identity, styled 320/390/1280px no-overflow checks.
- Actual `RecordCalendarView` + unchanged OA image/canvas/parser/Tesseract pipeline: **passed** (`real-ocr-result.json`). A synthetic OA-layout PNG is recognized, its date and weight are edited, an existing destination record is confirmed, unrecognized bodyAge/memo are preserved, then saving, reload and clicking the calendar date restore the edited value. Public OCR worker/core/model requests were fulfilled from local test assets; **external requests sent: 0**. This does not measure real user-image OCR accuracy.
- Local production `npm run build`: **passed**, exit 0 (`build.log`). TypeScript and changed-file ESLint passed. `git diff --check` passed using the normal approved execution environment.
- Screenshots reviewed: `viewport-390.png` and `real-calendar-ocr.png`. The browser harness also checks 320px and 1280px widths.
- No push, merge, deployment, paid AI, user-profile edit or security change.

### Earlier failures and their resolution

1. Restricted-environment Edge launch failed before UI assertions: temporary profile `SiteList` replacement error `-5`, named-pipe failure, then browser closed. The user explicitly requested a supported independent-profile path. Running the same test with normal approved execution permissions worked using a new disposable Playwright profile, without reading/modifying a user browser profile or disabling a security setting.
2. Restricted full-suite execution stopped waiting for a sync trace phase after a loopback request did not reach that phase. The same isolated file passed **8/8** in the supported environment. `waitForPhase` now fails with observed phases after a bounded timeout instead of hanging forever; an explicit missing-phase regression was added.
3. The first completed full suite was **739/740**, not a pass. Its single failure was a Windows fixture writing a native Windows path into simulated Linux `/proc/maps`. The fixture now uses a POSIX mapped path and injects identity resolution to the actual temporary binary. Hash/version/privacy assertions remain intact; production `/proc` parsing/default identity resolution is unchanged.
4. The expanded multi-tab harness initially used Playwright's single-page convenience context and failed (`Please use browser.newContext()`). It now uses an explicit disposable context. The real calendar harness then exposed a missing `process.env` compile-time replacement (`process is not defined`); the harness now supplies the replacement normally provided by Next. Both were harness failures, corrected before claiming the final passes.

### Additional source review fixes

- Excluded movement matching covers spaced Korean and English names; a removed legacy excluded movement cannot be re-added through the restore picker.
- Imported save success remains visible after automatic date selection. If another calendar editor/note is unsaved, the imported measurement is saved to its reviewed date without navigating away and discarding that other draft.

Base: main `62c2141b9ccb29daeac680e088007309d195c665`.
Local branch: `agent/fitness-record-priority`.
Separated local implementation commits: `70b44bf` (measurement-date import) and `3cdfab9` (equipment selection/source identity). Test-harness/environment fixes and evidence are kept in a third local commit.
No remote push, PR mutation, merge or deployment. PR #208 remains separate.
Checkpoint `81e4e18f02f4ba82fd812b0a567be6bb6129c7ec4420` was not found by the GitHub commit API (422); this does not prove it never existed elsewhere.

## Independently reviewable change groups

1. Measurement-date import: `app/lib/bodyImport.ts`, its test, `BodyRecordCard.tsx`, and the date callback in `RecordCalendarView.tsx`.
   - Separate, editable, memory-only import draft; recognized measurement date defaults the review field, invalid/future dates require correction.
   - Calendar movement does not erase a completed draft. Pending OCR is invalidated on calendar/session changes and unmount. Session owner plus epoch are checked before publication and saving; cross-tab session marker changes clear the draft.
   - Latest target-day records are read at save, existing records require confirmation, changes during confirmation reject saving. Only recognized/explicitly edited fields are merged. Missing values and target-day memo remain intact. Same-day unsaved edits are retained; values from a different day are not copied.
   - Weight and body composition are committed together through the existing storage transaction mechanism. Failed saves retain the draft. Successful save selects the measurement date/month in the calendar.
   - Existing OCR remains OA long-report only; no claim of general InBody form support or improved recognition accuracy.

2. Home exercise selection and source identity: `DailyWorkoutEditor.tsx`, `homeExerciseCatalog.ts` and test, `userWorkoutSettings.ts`, `workouts.ts`, `exerciseGuides.ts`.
   - Equipment selector exposes existing guided movements for bodyweight, mat, dumbbells, long bands, loop bands, AB readiness, pull-up bar and foam roller.
   - Explicit selection adds a movement; existing saved routines are not automatically replaced. New catalog/recommended additions exclude sliding board and hip bridge. Legacy selected groups remain readable; old optional-cardio data is not globally migrated/deleted.
   - Optional `sourceExerciseId` survives saved settings. Recognized older `custom-<source>-<timestamp>` IDs regain guides. Free-text entries without a known identity are not assigned an invented guide.
   - AB readiness gate retained; custom entries appear only in main (or selected cardio option), not repeatedly in warmup/cooldown. Seconds in a prescription are not interpreted as repetition counts.
   - No product capacity or band resistance claims. Kettlebell/barbell-specific guides are explicitly pending. No changes to pain/recovery decision rules.

## Validation and limitations

- Final focused regression run: **47 passed / 0 failed / 0 skipped**, exit 0. Evidence: `focused-tests.log` in this directory. Changed-file ESLint also exited 0.
- Reproduce the 47 checks: `node --experimental-strip-types --test app/data/homeExerciseCatalog.test.ts app/data/userWorkoutSettings.test.ts app/data/workoutGroups.test.ts app/lib/bodyImport.test.ts app/lib/oaReportParser.test.ts app/data/storageTransaction.test.ts app/data/workoutAdaptiveReview.test.ts app/data/currentWorkoutDirection.test.ts app/data/workoutPlanDecision.test.ts app/data/workoutPlanProposal.test.ts app/data/localWorkoutPlanProposal.test.ts`.
- Dependency recovery: root and existing `scripts/browser-qa` lockfile installations completed with `npm ci --ignore-scripts --no-audit --no-fund`.
- Focused unit checks: date rollover/future validation, target-day merge, memo preservation, epoch invalidation, original OCR numeric parser, transactional rollback, source ID/reload, AB gate, catalog exclusions and routine placement.
- Existing safety regression checks: local plan proposals, neurological/worsening-back holds, unchanged custom plans, adaptive review and plan decisions.
- Final type check: `npx tsc --noEmit --incremental false` **passed**, exit 0.
- Changed-file lint: `npx eslint app/components/BodyRecordCard.tsx app/components/RecordCalendarView.tsx app/components/DailyWorkoutEditor.tsx app/data/homeExerciseCatalog.ts app/data/userWorkoutSettings.ts app/data/exerciseGuides.ts app/lib/bodyImport.ts`.
- Earlier incomplete full-suite log is retained as `full-suite-incomplete.log`; the completed failed run is `full-suite-supported.log`. They are superseded by the final 741/741 result, not relabeled as successes.
- UI reproduction: `node scripts/fitness-priority-browser.mjs`. Actual OCR reproduction in PowerShell: `$env:FITNESS_REAL_OCR='1'; node scripts/fitness-priority-browser.mjs`. Install the isolated model first with `npm install --prefix scripts/browser-qa/.generated/ocr-assets --ignore-scripts --no-audit --no-fund '@tesseract.js-data/eng@1.0.0'`. The model is a test-only ignored artifact, not an app dependency.
- Authenticated Next app shell, cross-device/cloud save, physical-device verification and real user-report recognition accuracy remain **not verified**.
- Restricted `git diff` failed with `fatal: this operation must be run in a work tree`; normal approved read-only execution resolved it. Actual source diff review and whitespace checks are complete.

## Deferred third deliverable

No human exercise animation was added. A wall-pushup is the smallest plausible first original demonstration because its existing guide specifies a stable wall contact, fixed feet and a straight trunk; it still needs exercise-specific joint geometry, contact/occlusion checks and direct visual review of the full cycle. Accurate exercise-specific motion and visual validation have not been established here. Do not label a generic animated figure as a validated demonstration. Existing text instructions remain; pause/repeat/slow-motion controls and original/licensed validated motion remain future work.

## Release gate

This is a locally verified candidate, not an authenticated deployed release. The local browser flows above are complete; authenticated test-account/cloud synchronization and physical-device checks remain separate gates. Review the separated local changes before any push; remote push/merge/deployment has not been performed. No paid AI, external health upload, new service, security setting or Vercel alignment image was changed.

# Japanese Live P2 UI candidate, 2026-10-09

Base: `125bacf3` (local candidate changes are uncommitted). This note covers the new UI and its tests only. Backend migration/reducer/repository validation is reported separately.

## Implemented locally

- A separate **복습·학습 상태** tab. The original import/history flow and legacy Japanese progress/reset data are preserved.
- Current lesson summary; explicit five-status display; separate listening/speaking/reading/writing cards, with **미확인** distinct from **미학습**.
- Prioritized review queue, policy-versus-teacher due dates, uncertainty notices, immutable state/evidence history, and navigation to existing practice pages. No automatic curriculum completion writes.
- Manual item identity linking across active and inactive history. No free-text assessment extraction, new scores, generated study time, or AI/provider calls.
- Per-observation confirmation of exact report excerpts, skill, occurrence date, result, certainty, independent/hint flags, forgetting reconfirmation, relearning text, and reassessment link. Unknown/none/not-learned source categories cannot be silently promoted into confirmed achievements.
- A second explicit confirmation for the complete replacement evidence list. An empty list deactivates the current revision's evidence but does not erase old batches.
- Account-scoped local recovery; each recovery forks a fresh tab-private writable draft. Pending retries retain the same request and exact payload. Lost or inconsistent readback never produces a success claim.
- Deleted/superseded reports and replaced evidence are inactive. Restoring a report alone does not restore its old evidence. An explicit copy into the current report revision and reconfirmation are required; original observation dates and links remain unchanged.
- Stale/version-conflicting drafts remain available. Unavailable or incomplete snapshots do not appear as empty/current learning states. Obsolete reads and account-A responses are fenced from later views/accounts.

## Files

- `components/language/live/LiveWorkspace.tsx`: additive navigation/mount only.
- `components/language/live/LiveLearningWorkspace.tsx`
- `components/language/live/LearningEventEditor.tsx`
- `components/language/live/LearningDashboard.tsx`
- `app/language/live/learning-draft.ts`
- `app/language/live/learning-draft.test.ts`
- `tests/language-live-learning-ui.test.ts`
- `app/language/live/live.css`
- `tests/e2e/language-live-learning.spec.ts`

## Actually executed

- `npx tsc --noEmit --pretty false`: passed after UI/spec edits.
- `npx eslint components/language/live app/language/live tests/e2e/language-live-learning.spec.ts`: passed.
- `node --experimental-strip-types --test app/language/live/draft-state.test.ts app/language/live/learning-draft.test.ts`: **26/26 passed** (12 existing P1, 14 new P2).
- `git diff --check`: passed.

## Independent review, 2026-10-09 18:38 UTC

- Fixed a reproduced pending-retry race: retrying while a snapshot read was still
  in flight invalidated that read, and a failed retry stranded the refresh button
  in loading. Every settled save now replaces the interrupted snapshot read;
  obsolete responses remain fenced. The shipping-component regression failed
  before the fix and passed afterward.
- Fixed post-commit readback error classification in the repository. A schema-,
  validation-, or conflict-shaped error from the independent readback must remain
  an uncertain verification failure. It can no longer unlock the input or allow a
  new request ID when the write may already have committed. Exact same-request
  retry and missing/mismatched readback remain protected.
- Eight deterministic tests execute the shipping component at synthetic React,
  storage, and repository boundaries: repeat-save locking, interrupted snapshot
  recovery, stale reads after dismissal, account A→B isolation, quota preservation,
  separate tab draft keys, confirmation reset/cancel behavior, and hiding failed
  snapshots. These are unit checks, not DOM/browser or visual acceptance.
- Combined P1 draft/P2 draft/UI/repository/reducer/PGlite run: **95/95 passed**,
  comprising 12 existing P1 draft, 14 P2 draft, 8 UI, and 61 backend checks.
- `npx tsc --noEmit --incremental false --pretty false`, focused ESLint, and
  `git diff --check`: passed after the review changes.
- The existing authored lost-readback browser scenario now uses a schema-shaped
  post-commit error, and the source-check scenario explicitly asserts unknown
  source rejection. The browser scenarios remain **unexecuted**.
- Static markup review found labeled controls, retained unknown/explicit
  not-learned distinction, independent skill cards, preserved copied dates,
  wrapping/min-width rules, and 600px single-column layouts. These observations
  do not substitute for rendered 320/768px usability or browser history checks.

## Authored, not executed

Nine authenticated disposable-DB browser scenarios in `tests/e2e/language-live-learning.spec.ts` cover:

1. Source confirmation, four separate skills, 320/768px screenshots, refresh/relogin, legacy preservation.
2. Invented excerpts and not-learned source rejection.
3. Lost readback, immutable pending draft recovery, exact same-request retry.
4. Deleted/restored reports, inactive evidence, explicit copy/reconfirmation, preserved observation dates.
5. Historical mastery, confirmed forgetting, relearning/reassessment, and uncertain other-skill evidence.
6. Independent-session optimistic concurrency and retained losing draft.
7. Unavailable snapshots and late responses after tab dismissal.
8. Tab-private recovery, delete cancellation, leave cancellation, Back/Forward.
9. In-flight account isolation, pending request recovery, and RLS separation.

Browser execution, screenshots, visual/mobile usability, and real authenticated end-to-end persistence are **unverified** in this task. A previously established browser/process EPERM blocker was not retried or bypassed. The parent owns the subsequent aggregate checks and the authorized disposable-browser verification gate.

No commits, pushes, hosted DB application, production writes, paid calls, P3 implementation, main merge, or deployment were performed by this UI task. P2 is an implementation candidate, not an operationally verified completion claim.

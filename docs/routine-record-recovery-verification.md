# General routine record recovery (G2)

Date: 2026-10-09 UTC. Development-only, synthetic data. No hosted migration, personal record, provider call, browser execution, commit, push or production change was performed for this slice.

## Baseline actually reproduced

At local baseline b394725, an AST-extracted shipping `app/growth/page.tsx` `finishActive` called the AST-extracted shipping `useGrowthData.saveSession` twice. The synthetic DB boundary committed each INSERT and lost each response. Two rows with two distinct UUIDs resulted. Evidence was saved at `/workspace/shared/routine-lost-response-baseline.json`; this is a synthetic reproduction, not observed user data loss or a browser run.

## Shipping scope

- General active timer, manual record and quick completion now use `useRoutineRecordRecovery` and `routine-record-recovery.ts`. Existing typing, course handwriting and generic `useGrowthData.saveSession` contracts were not changed.
- Owner-scoped versioned draft contains active routine/start/memo/feedback and manual open/routine/date/status/raw minutes/memo/feedback. Blank/invalid-in-progress manual input survives; no normalization turns blank into zero.
- New attempt fixes one UUID, all 13 persisted session fields, timestamps, feedback, source and form snapshot before network access. Every attempt reads first. Errors, false/undefined malformed results and unavailable reset reads are unknown, never proof of absence. A retry can insert only after confirmed absence, using exactly the stored payload.
- Independent server readback compares every submitted field. Equivalent timezone representations normalize, but changed submillisecond instants do not match. No upsert or overwrite is used.
- New `save_routine_session` migration uses SECURITY INVOKER, owner and owned-routine checks, strict general-routine allowlists and the existing reset owner advisory transaction lock. Reset generation is checked after that lock. Exact replay is a no-op; changed same-ID payload rejects. Typing/course-only validation is not relaxed. Missing RPC fails closed; hosted installation remains required.

## Local provenance and lifecycle

- Web Locks is required for every checkpoint/staging/discard/terminal mutation. Without it, input is not claimed durable and cloud writes are blocked. Lock-time full raw-byte CAS and UUID revisions protect known participating tabs. Writes are read back.
- Terminal success and reset retain a versioned tombstone envelope; keys are never deleted, including initially empty drafts. A stale tab cannot observe null→null ABA and create a fresh ID after another tab completes.
- Current root/form extension fields are preserved through checkpoints, completion, reset and explicit discard. A pending input snapshot contains only the known form fields; unknown pending/request schema fails closed with original bytes retained. Future version, malformed type or opaque pending data is never silently normalized/deleted.
- Newer edits during an unresolved save remain separate from the immutable attempt and survive completion and reload. Original form fields clear only if their known contents still equal the submitted snapshot.
- A confirmed server row is distinct from local cleanup. A terminal write that may have committed but whose readback is uncertain blocks all further writes until rehydration. It does not claim that the pending bytes certainly remain, and does not retry cleanup blindly. Owner/reset are checked again after terminal cleanup before success notice.
- Owner epochs plus auth events and fresh auth reads fence A→B→A; old-owner fields hide as soon as a mismatch is observed. Durable A bytes remain under A's key for later authorized recovery. Unknown auth/reset blocks saving; it does not erase prior bytes.
- Same-page quick cancellation, recent record deletion and routine deletion are blocked during pending/saving/unsafe recovery. An active draft's routine cannot be deleted. If its routine is removed elsewhere, its memo/start remain visible; an explicit local confirm can clear that unsaved active draft while preserving extension fields, provided no pending attempt exists.
- Closing the manual form only changes its open flag; inputs remain. Unsaved asynchronous checkpoint work gets an unload warning.

## Time evidence and existing consumers

- Active timing records rounded observed minutes, including genuine zero; backward clocks or duration over 24 hours reject, rather than clamp or invent elapsed time.
- Manual minutes are user-entered integer evidence, 0–1440. No fabricated started/ended timestamps.
- Quick completion retains completion intent with `actual_minutes=0`, `metrics.actualMinutesRecorded=false`, `metrics.recordMode=quick`, and null started/ended timestamps. The zero is a schema sentinel, explicitly displayed as time unrecorded.
- Growth totals/averages, local coaching, paid-coach prepared aggregates, weekly assistant briefing, assistant daily card, and local assistant status/briefing preserve explicit unknown time. Unknown-only days are outside the duration-average denominator; completion and activity counts remain intact. Comparisons with unknown time are held. Known-plus-unknown displays the recorded sum and unknown count. Unflagged historical rows retain their existing recorded meaning; no historical records are rewritten or retrospectively classified.
- Existing calendar/recent-row displays already use `growthSessionTimeLabel`; the new page follows that contract. No provider activation or dispatch/consent behavior changed.

## Verified and unverified

Focused executable coverage includes the shipping recovery hook and page handlers, synthetic auth/storage/RPC faults, actual PostgreSQL constraints/RLS/reset functions through PGlite, complete immutable comparison, enum/type corruption, quota, unknown schemas/fields, stale tabs/tombstones, reset hydration races, A→B→A, delayed newer edits, uncertain terminal cleanup and explicit unknown-time assistant replies.

At documentation preparation, 104 focused tests passed with no failure/skip. Focused TypeScript and ESLint passed. Parent integration owns the final aggregate run; later evidence supersedes this checkpoint count.

`tests/e2e/routine-record-recovery.spec.ts` defines 13 isolated-account cases per configured engine: 320/390 reload, active/manual/quick committed-or-absent lost response, exact installed-SDK GET retry sequence, newer edits plus reachable pending deletes, two tabs, remote reset, quota, and A→B→A. Existing growth-progression/free-first assertions were updated to the precise new RPC and metrics contract. These browser cases were authored only, not executed locally. Local browser launch was previously denied and was not retried or bypassed.

Remaining acceptance gates: registered real-browser workflow, real multi-connection PostgreSQL lock contention, hosted migration, physical/mobile/PWA behavior, actual personal-data recovery and operational approval. PGlite proves single-connection SQL/RLS and both serialization orders, not concurrent connection lock contention.

## Explicit boundary

The reset fence is authoritative for clients using this new RPC. Older direct INSERT writers are unchanged. Ordinary cross-device manual deletion is not a server-side cancellation receipt: if another device deletes an unresolved create before the caller confirms it, later same-ID retry can recreate an absent record in the same reset generation. Same-page reachable deletion is prevented, but a broader delete lifecycle protocol remains open. No hidden retained private receipts or shared delete/reset schema expansion was added to imply that boundary is solved.

Local checkpoint eviction, unsupported storage, offline authentication/reset verification, and unknown/future recovery schemas can block progress. They are not reported as successful recovery. Operating-system/app closure before a pending asynchronous browser write can still require the displayed unload warning; browser/device acceptance remains separate.

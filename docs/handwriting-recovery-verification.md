# Handwriting course: bounded durable recovery candidate

Date: 2026-10-09 UTC. Local candidate only. No hosted migration, private material inspection/export, commit, push, or operating release was performed for this change.

## Scope and preserved behavior

- Only the 53-lesson handwriting course receives this recovery protocol. Free handwriting, drawing, sentence typing, shared growth saving, and existing reset functions remain outside it.
- The additive migration is `20261009193716_save_handwriting_attempt.sql`. Install the server RPC before releasing this client. A missing function leaves the same local request pending; there is no direct-INSERT fallback.
- No existing table, table privilege, RLS policy, or reset definition is changed by this migration. Growth reset continues to delete sessions/reviews while retaining resources and Storage objects.
- Storage cannot participate in the database transaction. A reset after upload and before the RPC can leave an unlinked private PNG. The client preserves that object and does not resurrect the stale session or silently delete it.

## Local recovery contract

`yeoni-handwriting`, IndexedDB v1, stores one owner/course slot. A record contains a version, monotonic revision, attempt UUID, reset marker, frozen lesson/check wording, worksheet identity/version/SHA-256, mode/trace, self-checks, raw minutes string, reflection, stroke evidence, current lossless RGBA raster, and up to five existing undo frames. There is no new vector drawing engine.

The bounds are explicit: width/height at most 4,096 each, at most 4,194,304 pixels per frame, at most five undo frames, 112 MiB total checkpoint raster/undo/pending-PNG bytes, and the existing 10 MiB cloud PNG ceiling. Capacity or validation failures preserve the current screen and the previous committed checkpoint and block remote writes. A browser can impose a lower quota.

Pixels are copied before asynchronous hashing. Snapshots are serialized. The IDB readwrite transaction compares the previous revision and attempt UUID before replacing the complete record; hashes and canvas encoding run outside the transaction. After transaction completion, an independent read validates the record and all frame/Blob hashes and compares the complete record signature. Confirmed/discarded/invalidated tombstones retain the revision to prevent absent-to-present ABA races. A stale writer stops instead of allocating a new ID or merging two attempts.

Owner-keyed workspaces and synchronous owner refs reject late callbacks across account changes. Local hydration comes before progress selection. A restored canvas has priority over fresh worksheet callbacks. Unknown schema, corrupt data, or an inconclusive reset-marker read preserves the stored record and prevents cloud writes.

Text/check changes are checkpointed after a short 180 ms delay; completed strokes and undo checkpoint immediately. Controlled in-app navigation and save flush the queue first. Page-hide/visibility flushes are best effort. Recovery claims apply only to completed checkpoints, not an unfinished stroke/write during abrupt termination.

## Save protocol

Before any external mutation, the local draft stages immutable session/resource IDs, fixed storage path, full metadata/payload, fixed timestamps, exact PNG bytes, and SHA-256. Paper mode records self-reported minutes; screen mode retains pointer-movement timing. No practice start/end timestamps are invented: both remain explicit nulls.

A retry is independent of today's material URL, progress fetch, and routine lookup. It checks the frozen session and resource rows first. Read errors never establish absence. It compares all supplied immutable fields, downloads the fixed PNG path, and compares SHA-256 rather than size. It only uploads after confirmed object absence, with `upsert:false`, then downloads/hashes even after an apparently successful upload.

`save_handwriting_attempt` is SECURITY INVOKER with an empty search path and authenticated-only EXECUTE. It validates owner, payload allowlists, bounded evidence, lesson/page/course linkage, owned handwriting routine, resource linkage/path and snapshot values. Under the exact existing `app-record-reset:<owner>` advisory transaction lock, it compares the frozen growth reset marker and atomically inserts missing metadata/session rows. Exact replays are harmless. Existing exact resource-only recovery is supported; conflicts and resource reuse by another attempt are rejected. Existing rows are never updated/upserted.

Independent row readback plus owner/reset checks precede the local terminal CAS and saved UI. Before independent cloud confirmation, uncertain replies, a missing RPC, or conflicting content preserve the staged pending attempt, subject to the separately reported local checkpoint outcome.

After independent cloud confirmation, local terminal cleanup has distinct outcomes. A terminal write that fails before committing leaves the active pending checkpoint intact. A terminal transaction that commits but whose readback fails may already have replaced those bytes with a small confirmed tombstone. Likewise, failure of the reset-marker read after a successful terminal CAS does not restore discarded pending bytes. The client reports that the server save was verified but local cleanup or the later reset state remains unverified, and blocks further writes until the screen is reopened. It does not claim that pending bytes survived, show the saved UI, automatically upload again, or regenerate request IDs in that uncertain state. On reopening, an active pending record remains eligible for exact-request verification; a confirmed tombstone retains its CAS revision without the old raster/PNG. A previously verified cloud save is not a guarantee that a subsequent reset retained that record.

## Executed local checks

At the initial implementation checkpoint:

- `tests/handwriting-recovery.test.ts`: 9/9 passing. Schema/hash/frozen payload, raw inputs/lesson/raster/evidence/undo, deterministic IDB transaction adapter, two-writer CAS, tombstone ABA, quota preservation, save-saga interruption/lost-response/resource-only/conflict/reset behavior.
- `tests/handwriting-hook.test.ts`: 8/8 passing. Executes the shipping hook with synthetic React/auth/database/Storage/canvas boundaries. Paper reload, recovered lesson precedence, lossless screen+undo restoration, pending retry independent of materials/progress/routine, double-click, null `toBlob`, delayed encoding with A→B, quota, two tabs, missing RPC/readback/terminal failure, corrupt schema and reset invalidation.
- `tests/handwriting-migration.test.ts`: 30/30 passing in PGlite. Uses the real growth schema/RLS/grants and real existing reset function; covers all 53 client-built lesson snapshots, paper/screen, exact replay, both reset orderings, owner/anon denial, conflicting paths/rows/linkage, atomic rollback, and unchanged seeded records/columns/policies/grants/reset definition.
- Combined handwriting SQL and existing sentence SQL/fixture regressions: 49/49 passing.
- TypeScript no-emit and focused authored-E2E lint passed after integration.

Subsequent independent review and final aggregate results should be reported separately; these counts identify this implementation checkpoint and do not substitute for final-tree results.

### Independent client review checkpoint

Completed on 2026-10-09 UTC. The review reproduced and fixed:

- A delayed previous-lesson worksheet becoming the current lesson's source. Incoming worksheet identity must now match the current lesson before it can attach; a recovered source/canvas still has priority.
- A no-move pointer discarding the oldest of five undo frames. Undo history now changes only when a stroke completes. A checkpoint during an unfinished stroke uses the pre-stroke raster and completed evidence, and an unrelated pointer release cannot finalize the active stroke.
- A previous edit's debounced checkpoint surviving reset. Reset cancels that timer, and generation checks fence delayed encoding and remote-save boundaries after reset notifications.
- Same-owner lesson changes canceling PDF/import operations and leaving their busy states stuck. Owner-action tokens are now separate from worksheet-request tokens; an owner switch still prevents further uploads or late UI updates.
- An overbroad recovery notice after independently verified cloud save but uncertain terminal cleanup or final reset-marker read. The distinct pending/tombstone outcomes and write blocking are described above.

Executed command: `node --experimental-strip-types --test tests/handwriting-hook.test.ts tests/handwriting-recovery.test.ts tests/handwriting-materials-hook.test.ts`.

- **26/26 focused client tests passed:** 14 shipping-hook tests, 9 draft/CAS/save-saga tests, and 3 private-material hook tests.
- Added regressions cover all five undo frames, unfinished-stroke evidence, unrelated pointers, delayed reset checkpoints/PNG encoding, source identity, and terminal failure before commit, after commit/readback, and at the final reset-marker read.
- Material tests use synthetic bytes only. They verify readback for all 54 uploaded payloads plus the exact ready marker, reject wrong uploaded bytes, and stop further uploads after an owner switch. This is not evidence that a real private package can be restored.
- Focused ESLint passed for the two reviewed hooks and their hook-test files; `git diff --check` passed.
- No additional aggregate typecheck/build, browser run, real-device check, hosted action, commit, or push was performed as part of this review. Final aggregate verification is a separate checkpoint.

### Aggregate-discovered fixture synchronization correction

A subsequent whole-suite run reported **1,446/1,448 passing**, with two handwriting-hook fixture failures: hydration had not yet reached ready/error, and delayed PNG encoding had not yet entered `toBlob`. A targeted rerun reproduced premature fixture waits. The fixture incorrectly treated 100 `setImmediate` turns as completion; real WebCrypto hashing finishes asynchronously on worker threads and is not bounded by that turn count.

The test-only correction waits for observable hook state-change notifications and the actual `toBlob` entry promise. If save finishes before entering encoding, the test explicitly fails. No behavior assertion was removed, no timeout was increased, and no production source was changed for this correction. The same **26/26 focused client tests passed again**, and scoped ESLint/whitespace checks passed. This focused result does not convert the earlier aggregate failure into a pass; a fresh full-suite result must be recorded separately.

The IDB adapter implements deterministic request/transaction events, not a browser database. The hook fixture executes synthetic canvas/pointer surfaces, not an actual rendering engine. PGlite uses one connection: ordering results and lock identity are tested, but real competing-connection lock contention remains unverified.

## Authored but not locally executed browser checks

`tests/e2e/handwriting-recovery.spec.ts` uses only disposable authenticated accounts and synthetic white worksheets:

- 320/390 px paper recovery, reload/back/forward, frozen lesson, lost RPC response and single committed record.
- Exact screen PNG restoration, stroke timing/evidence and undo, retry after reload with material/progress reads unavailable, and private-file owner isolation.
- Real browser IDB stale-tab CAS and preservation of visible losing-tab input.
- Reset between Storage upload and RPC, no revived session/resource metadata, retained unlinked private PNG, and stale local invalidation.

Existing `handwriting-course.spec.ts` now intercepts the new RPC for response-loss coverage. These are authored acceptance cases, not successful browser runs. The prior local browser EPERM restriction was not retried or bypassed. Chromium/WebKit CI must execute the authenticated flows, and failures require diagnosis before treating this candidate as verified.

## Remaining release/device gates

- Real multi-connection PostgreSQL reset/save contention and hosted PostgREST/RLS/Storage behavior.
- Authenticated Chromium/WebKit reload/back/forward, responsive screen/paper flow, exact Blob/IDB/canvas behavior, and private-file isolation.
- Physical iPhone Safari/PWA and iPad/Pencil: pointer pressure/cancellation, background/force-kill, storage quota/eviction, OS updates, and service-worker updates.
- No recovery guarantee after browser-data deletion, uncommitted writes, storage eviction, or loss of the only local device. Local IndexedDB is not a cross-device backup.
- The general data-backup export does not include this IndexedDB store, cloud resources, or Storage bytes. Restoring private materials still requires the full original package and verified file hashes. No real private package or production backup was inspected here.
- User operating approval remains separate from development and synthetic-test completion.

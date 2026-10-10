# Guarded storage development candidate

2026-10-10 KST / 2026-10-09 UTC. Parent: `d4382f801504e2d4310d7fc91b5dd126d31ea5a6`. Development only.

## Why another slice was required

The preceding candidate mitigated destructive reads but still had uncoordinated writers. This slice moves participating new-code fitness/diet writers, cloud acknowledgments, auth cleanup, restore, reset markers and draft handling to one origin-wide Web Lock and fresh-state transforms. No network call is held inside the local critical section. Unsupported locking fails closed; there is no unlocked fallback.

The desired owner fence is unique and never restored by rollback; readiness is a separate matching association. Queued writes and post-await UI publication validate captured ownership. Record reconciliation and acknowledged sync baseline advance atomically. Editor revisions and session cleanup-only retries prevent late completions from discarding newer drafts or repeating already-confirmed saves. Corrupt values are not silently erased by repair-on-read. Legacy weekday workout records are pinned once in a guarded migration rather than rolling into every future week. Unknown draft/schema versions are preserved; valid draft round trips retain all known fields and opaque extensions. Notification claims are conservatively at-most-once: a crash can suppress a reminder and delivery is not guaranteed.

The v2 journal supports recoverable interrupted new-code writes and coherent read-only before-images. A legacy v1 journal cannot prove its writer is gone and blocks mutation. There is no automatic timeout-based abandonment or in-app forensic export/recovery. Old-version open tabs do not participate in the protocol. These remain operating-rollout gates, not claims solved by a new lock. See `shared-storage-protocol-v2.md`.

## Prior CI failure, exactly attributed

Full run `37985139602` / job `114005145664` at parent `d4382f8` passed **1,450 unit tests**, then failed `scripts/qa-pr189-sync.mjs` with exit 13/unsettled top-level await at its CAS/logout checkpoint. Its VM omitted `crypto`; the new generation writer therefore failed before the awaited PATCH could begin. This was reproduced on frozen files. CI lint/types, build and every browser step were skipped. Cleanup succeeded; the stack had not been created and no artifacts existed.

A later local harness run passed 25/28 after a calendar migration helper was added; its extracted handlers lacked that actual module dependency. Loading the production workoutCompletion/dietPlans modules restored those assertions and added a dated-record/legacy migration regression. Updated resumed-session fixtures use the real draft validator.

The harness now supplies real WebCrypto, explicit serialized synthetic locks, and awaited storage/auth/request checkpoints. It retains original owner/CAS/record preservation assertions, adds unsupported-lock coverage, and reports failures rather than hiding a missing checkpoint behind an unsettled await. This is synthetic verification, not actual browser execution.

## Local evidence

- Preliminary integration: 1,490 passed / 2 failed out of 1,492. Corrected a TypeScript-only runtime import and the changed asynchronous SSR helper/test contract; preserved the failures in logs.
- Final reviewed-tree aggregate: **1,598 passed / 0 failed**, no skipped/cancelled cases. Earlier passing intermediate checkpoints are retained separately.
- Actual shipping-handler synthetic sync harness: **29 passed / 0 failed**.
- Final nonincremental TypeScript, whole-repository ESLint and production build all passed.
- Independent core and integration reviews found no remaining source blocker for cooperating new-code tabs, with adversarial owner, queued draft, baseline, reset, quota and journal tests. This does not certify unsupported, mixed-version or actual-device behavior.
- Discovery only: **192 early acceptance cases in 14 files**, both Chromium and small WebKit. Four new per-engine cases use actual `navigator.locks` for queued independent edits, A→B rejection, v1 preservation, and v2 reload recovery. No local browser was launched or restriction bypassed.

A new exact-commit CI run must execute these authored browser cases. The latest executed early browser outcome remains `a6624c0`'s **120 passed / 8 failed**; this document does not convert that into a pass.

## Unchanged release boundaries

PR #208 is a development Draft. No main merge, Production deployment, hosted migration/RLS/environment change, additional paid provider/TTS call or credential expansion is part of this slice. Vercel's latest verified candidate status remains account-blocked. Physical iPhone/PWA/Pencil, original private material restore, accepted short/long alignment exports and operating approval remain separate gates.

# Shared local-record storage protocol v2

Development status: 2026-10-09. This is a new-code writer protocol, not a claim that mixed-version tabs or authenticated real-browser acceptance have passed. No production rollout is authorized by these changes.

## API and lock order

All participating local writes acquire the exclusive origin lock `yeoni-shared-local-storage-v2`. `updateStorageBatch(storage, transform, { owner })` reads a new coherent snapshot after acquiring the lock and recovering any interrupted v2 batch. Its transform is synchronous and returns serialized changes. No network awaits or nested public storage APIs belong in a transform. `writeStorageBatch` is an asynchronous replacement API; read-modify-write callers use a transform instead.

`updateJson` and `readJsonForUpdate` reject malformed JSON or an incompatible outer shape. Ordinary display reads remain nonmutating. Every caller must await its save before publishing success and preserve a draft typed or changed while waiting. Captured owner tokens belong to the original editor/action, never a newly adopted owner after an await.

Existing reset/growth coordination stays outside the shared storage lock: outer reset/growth lock → storage lock. Storage code never acquires those outer locks. Remote operations happen between coherent request snapshot and guarded acknowledgment commit, with no storage lock held.

Missing Web Locks is an explicit unsupported state. There is no unlocked writer fallback. Failed initialization leaves the local document fenced, with persisted records untouched.

## Durable states and recovery

`yeoni-storage-transaction-v2` is either:

- `prepared`: version, unique transaction ID, prior generation, and a before-image reserved before changing any user key
- `committed`: version and a new unique generation, retained persistently after commit or rollback

Readers sample legacy generation, v2 metadata, v1 journal, all keys, then metadata again. A prepared transaction projects its entire before-image, including deleted and added keys. Any changed sample retries the whole snapshot; repeated instability and invalid metadata fail visibly. Readers never write, remove journals, or recover.

A newly held v2 Web Lock proves another participating v2 writer is not active. Only a v2 prepared journal can therefore be recovered automatically inside that lock. Recovery frees changed values before restoring the before-image. Reservation, record, restoration, or committed-marker persistence failure never discards recovery evidence. If commit succeeded but the owner changed before the promise continuation, callers receive a stale-session error; this does not pretend the durable commit was rolled back.

## Session fence and readiness

`fitness-cloud-sync-epoch` is a unique immutable desired-owner generation. Owner transitions publish it synchronously before waiting for cleanup. It is never in any transaction before-image and completion never rewrites it. A failed fence write keeps that document blocked; a retry must publish a fresh generation rather than revive the old one.

Owner/readiness association is committed with records under the lock in `fitness-cloud-sync-user` and `fitness-cloud-sync-ready`. Current-owner reads require the coherent readiness association to match the double-sampled desired generation. A→B→A creates distinct generations. Queued work checks its original token under the lock, immediately before the commit marker, and at promise completion. Provisional raw readiness is not exposed through a before-image read.

Same-document preparation calls share a promise. New documents join the same desired-owner generation. If two initial documents race to publish it, the superseded same-owner preparation joins the winner; it never follows a different owner.

## Cloud acknowledgment

`readCloudSyncRequest` captures local state, baseline, owner generation, and a baseline acknowledgment identity from one coherent snapshot. A network response acknowledges that request snapshot, not edits created while it was pending.

`commitCloudSyncResponse` validates owner and acknowledgment identity in the storage lock, merges with current local state, and commits records, acknowledged baseline, and a new acknowledgment identity together. A stale same-owner acknowledgment cannot overwrite a newer baseline. A true no-op acknowledgment writes no journal, generation, or acknowledgment marker, avoiding cross-tab idle feedback. Newer local edits remain pending.

Backup restoration merges into the fresh lock-time state, preserving current reset markers. It never applies a preview-time replacement blindly.

## Legacy v1 and mixed-version rollout gate

The legacy `yeoni-storage-transaction-v1` before-map has no verifiable lock owner. A newly acquired v2 lock, a timestamp, elapsed time, one visible tab, or a reload does not prove an old writer has stopped. The old code never took the new lock. Automatic v1 recovery is deliberately absent, including during logout, account preparation, and explicit `recoverStorageTransaction` calls.

When any v1 journal exists:

1. Ordinary read-only snapshots can project a valid legacy before-image without altering it.
2. Writes, cleanup, cloud application, and unsafe synchronization remain blocked. Invalid legacy JSON fails closed rather than appearing as empty records.
3. Do not delete the journal, clear site data, log out as a repair attempt, or run an old recovery function. These actions could destroy the only before-image.

There is currently **no in-app v1 recovery or evidence-export workflow**. If owner preparation is blocked, the authenticated backup page may also be unreachable. Its ordinary fitness JSON backup is not a substitute for raw transaction evidence. This is an explicit remaining product/recovery blocker, not completed migration work.

For an authorized developer-assisted investigation, preserve evidence read-only before considering any repair:

- Keep the exact raw v1 journal, v2 metadata if present, and legacy generation value.
- Keep the exact current values and absence/presence of every journal-referenced record key, plus relevant `ai-fitness-` records and `fitness-cloud-sync-base:` / `fitness-cloud-sync-ack:` baselines.
- Do not export unrelated origin storage or authentication tokens. Keep the resulting evidence private; review authorization before sharing it.
- Browser developer tools can inspect and copy individual Local Storage values without editing them. No production private-record inspection has been performed as part of this implementation.

A later explicit migration must establish quiescence of all old-code tabs/workers in the browser profile, verify the evidence is stable, select and explain the intended recovered state, obtain any required authorization, and perform a separately tested repair. Closing known old tabs is helpful, but does not by itself remove the gate or repair a journal. These changes intentionally do not provide a time-based abandonment switch, a force-recover button, or a hidden destructive escape hatch.

Even with no v1 journal present, an old tab can still write raw record keys without participating in v2. An advisory lock cannot protect against it. Release requires a separately verified old-code quiescence/upgrade strategy and a complete participating-writer audit.

## Verification boundary

Deterministic unit/synthetic checks cover before-image reads, concurrent transforms, queued owner changes, readiness publication, failed invalidation, v2 interruption, failed reservation/record/commit/rollback persistence, legacy preservation, malformed values, unsupported Web Locks, same-owner preparation races, atomic baselines, stale acknowledgments, and no-op convergence.

These are not real authenticated browser tests. Two real tabs, navigation/reload, save/re-read, owner changes, failure messaging, and small-screen flows remain a separate acceptance gate. No browser launch restriction or account-access denial may be bypassed to obtain that evidence.

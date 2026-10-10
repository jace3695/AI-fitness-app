# Diet multi-tab investigation

2026-10-10 KST / 2026-10-09 UTC. This is a failure investigation, not an acceptance pass.

## Actual browser evidence

Commit `a6624c0d7e9173767a4b3cbd9fee928b5542f9c7`, GitHub Actions run `37980448169`, job `113989305158`:

- Chromium: four diet cases passed; the shared-context multi-tab case failed at the first peer-save database readback (original line 167).
- WebKit-small: the same four cases passed; the shared-context multi-tab case failed at the save-after-peer-reset database readback (original line 184).
- Chromium expected `bingeUrge=no`, `preSleepOvereating=yes`, `digestionStatus=diarrhea`, `lateSnack=yes`, `afterWorkoutMeal=no` in today's saved record. Nine real synchronization responses, zero conditional misses.
- WebKit expected `hunger=no` and the three legacy answers `unrecorded` after another tab reset the day. Thirty-six real synchronization responses, four conditional misses.
- The approved, redacted CI log reports failure locations and bounded traffic counts, not received response payloads. The exact received browser states cannot be reconstructed from that log. Raw artifact access was not retried.
- Both failing cases cleaned up their single synthetic account with zero remaining rows and no blocked external origins.

The passing cases cover 320/390px failed-save/reload/reset, unknown/absent preservation and account isolation, and failed-server-confirmation recovery. They do not certify multi-tab safety.

## Deterministic shipped-component reproduction

`tests/diet-multitab-ui.test.ts` executes the shipping DietView and CloudSyncPanel with two shared synthetic localStorage contexts, hook/event boundaries, and an in-memory cloud boundary. It does not launch a browser or access a database.

Event ordering:

1. Both tabs hydrate the same owner and base.
2. Tab A edits only `hunger=yes` and remains dirty.
3. Tab B edits the independent answers and the three legacy selectors, then saves.
4. B's `writeStorageBatch` creates the rollback journal and writes the diet-completed key.
5. Before B removes the journal, deliver that key's storage event to A.
6. A's DietView preserves its dirty input, but A's CloudSyncPanel invokes `readLocalCloudState` from its storage listener.
7. That read invokes `recoverStorageTransaction` and rolls back B's still-active transaction.
8. B continues writing the remaining keys and publishes its successful local UI state, although its diet-completed key has already been restored to the old value.

Before the bounded development mitigation below, the regression fails with actual `hunger=unrecorded`, `bingeUrge=unrecorded`, `preSleepOvereating=unrecorded` in stored responses instead of expected `unrecorded/no/yes`. A's unsaved `hunger=yes` remains visible, showing why ordinary dirty-input helper tests did not expose the storage loss.

This proves a real data-loss execution in the shipped handlers. It is consistent with the browser failures but does not prove the exact event ordering in those redacted CI runs.

## Bounded development mitigation

The bounded development patch removes destructive recovery from ordinary reads in cloudSync.readLocalCloudState, DietView hydration, and recordStorage.readJson. DietView and readRecordStores each parse one coherent snapshot. While a journal exists, a snapshot overlays its before-image, including restoring deleted keys and excluding newly added keys, without changing storage. Invalid journals remain intact; continuously changing snapshots fail visibly instead of returning an empty record.

A persistent generation outside the synchronized-record namespace changes after every new-code batch commit and explicit rollback/recovery, before journal removal. Snapshot reads compare generation-before → journal-before → values → journal-after → generation-after. A completed commit or rollback between samples therefore cannot hide behind journal null→null. This metadata survives logout and is not included in exported/synchronized records.

CloudSyncPanel observes the journal and generation before reading, after awaited operations, and before applying or acknowledging data. An observed transaction leaves synchronization pending; a removal/commit event received during an outstanding request is retained and schedules a fresh read after that request settles. The existing owner invalidation and cleanup ordering are unchanged. The existing explicit recovery path and rollback semantics remain, with tests accounting only for the new persistent non-record metadata.

The E2E assertions retain the same expected values and timeouts. A fixed-enum-only failure diagnostic now reports expected/actual responses on the next isolated run without printing records, memos, owner IDs, credentials, or arbitrary raw strings.

### Locally executed checks

- `node --experimental-strip-types --test tests/diet-multitab-ui.test.ts tests/diet-travel-ui.test.ts app/data/storageTransaction.test.ts app/data/cloudSync.*test.ts app/data/diet*.test.ts app/data/freeDietTools.test.ts`: 77/77 passed.
- Includes the originally failing shipped-component interleaving and in-flight GET responses delivered before and after the peer commit, without losing the commit wake-up.
- Includes read-only before-image reconstruction, commit/rollback ABA, corrupt journal preservation, generation-write failure, original explicit crash recovery, account lifecycle and diet/travel regressions.
- These are deterministic component/data tests, not a new browser or database acceptance run. The mitigation still needs a fresh exact-commit Chromium/WebKit acceptance run.

### Release blockers outside this bounded mitigation

This is a reader-induced-rollback mitigation, not a general transaction or multi-tab safety guarantee:

- Concurrent writers can still race between the no-journal check and the write. Existing writeStorageBatch/clearLocalCloudState recovery remains an explicit destructive path and does not prove another writer is inactive.
- Direct raw localStorage/recordStorage.writeJson writers do not participate in the generation protocol. Their writes can race snapshot enumeration, rollback, cloud apply, and owner cleanup.
- Older open tabs do not rotate the new generation or honor the read-only contract. Mixed-version safety is unverified and unsafe to assume.
- Legacy/orphan/corrupt journals may leave synchronization deferred indefinitely. Elapsed time does not prove a writer crashed; readers never auto-delete or time out such a journal.
- A future controlled writer-protocol slice must provide common exclusive recovery/latest-read/write boundaries, cover nonparticipating writers and owner fencing, and preserve newer editor inputs while any async lock is pending. It requires separate verification; no hosted deployment is certified here.

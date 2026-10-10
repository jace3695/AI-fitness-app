# Gate B1: inactive review storage

This slice adds local review contracts and storage only. The shipping release remains `inactive / false / false`. There is no question component, capture adapter, scheduler change, new language-sync binding, server change, migration, provider, workflow, or browser activation in this change.

## Stored boundary

The existing `yeoni-legacy-language-evidence-v1` database is version 4. It adds `reviewRuns`, `itemExposures`, and `reviewTransitions`. The first store contains immutable source-bound runs and per-original-row cross-format fences. Its unique `managedSlot` index permanently excludes the old public capture commit/audio path for a managed source slot, including replay after close.

A source retains the exact whole array, exact row bytes, index, decoded unique review ID, frozen task/format/mode, and source-slot identity. The existing lossless JSON reader verifies the row without normalizing unknown fields or number/escape spellings. This is source integrity, not registered mutation authority. A future UI adapter must still reacquire the existing registered current language row handle and compare the full source before legacy mutation.

Metadata-only acquisition does not fabricate a checkpoint or presentation. Shared exposure starts unknown, including after v3 upgrade, and this API cannot promote unknown to false. Pending question/hint/feedback intents are distinct from observed facts. An answer registers its feedback intent atomically; another answer cannot consume the pending gap. Known positive exposure stays sticky across formats, close and reload. The existing answer checkpoint's anticipatory reveal flag does not authorize retry: feedback observation and exact compatibility acknowledgement must both settle first.

Cumulative `neededHelp` and `hadWrong` are retained. Answer text and the exact legacy observation stay in the existing capture handoff/commit contract. New review journals contain only immutable references and mutable metadata snapshots; they do not duplicate either value.

## Atomicity, replay and authority

`commitReviewTransition` is the one review write path. Pure plans are fully verified outside IndexedDB. One guarded all-stores transaction compares the complete immutable source, mutable run/exposure/row-fence expectations, verified graph, admission/incarnation, and referenced capture/checkpoint bytes. It writes the new journal/metadata and unchanged existing capture rows together. Synchronous request callbacks do not await crypto, network or UI work.

`findOrAcquireReviewRun` uses that same write path and exact readback to return an already selected source-bound run to a losing acquisition candidate. It does not call a losing candidate committed. `readReviewState` and `findReviewRun` support reconciliation. No new repository constructor or proof-registration escape was added.

Repository facades have distinct authority epochs. Review readback/commit can therefore receive a separately verified current fence, while the frozen original `PreparedCapture` and its canonical v1 commit bytes remain unchanged. A revoked facade never regains authority. The old undefined-admission synthetic constructor cannot use any review method.

Authenticated replay stays within the current admitted generation. The existing reset protocol completes scoped cleanup before carrying verified admission; unknown continuity has no review writer. Accounting includes all retained owner generations conservatively, but a stale-generation history can force cleanup or fail-closed handling. A current fence never authorizes replay or delivery validation for an old generation.

Independent readback verifies the bounded owner graph, journal predecessors and immutable source hashes, every referenced capture/handoff, checkpoint and event/delivery identity. Run, row-fence and exposure histories each have one contiguous revision chain from creation, no duplicate/forked revision, and a stored row equal to the unique terminal tip. Live run pointers and retirement claims agree in both directions. Historical success survives legitimate later exposure or close; it does not imply the old callback is still applicable to the current run/draft. Missing references, divergent same-ID bytes, revision-only ABA and partial rollback to a valid earlier snapshot fail closed. If a typed checkpoint does not incorporate newly observed positive shared exposure, re-preparing an answer against a fresh CAS snapshot still refuses that understated event. B1 stays conservative; B2 must separately define positive shared-fact reconciliation without inventing a reveal. A read error leaves uncertainty; retry is read-first with the same frozen IDs and bytes.

## Bounded lifecycle

The finite graphs are acquisition/presentation (two entries), hint (two), answer/feedback/compatibility (three, either settlement order), retry/local-clear acknowledgement (two), conservative loss/cancellation, and retirement/acknowledged close (two). One unsettled action is allowed per run. Retirement fences new actions in both formats of the original row. Exact-root settlement of a previously reserved sibling action remains allowed and preserves the claimant’s retirement fence. The fence cannot be cleared by unavailable-close, changing mode/source, or an unconfirmed receipt. The acknowledged row result is limited to the unchanged planner's schedule/defer result or `{deleted:true}`. Generic reviewed-item lists are outside this bounded operation.

All limits live in `review-capture.ts`: 256 KiB raw source; 8 MiB new metadata per owner across retained generations; 64 retained runs; 256 exposure rows; 1,024 actual/reserved journals; eight pending intents per item; 4/4/2 KiB mutable run/exposure/fence; 32 KiB journal including its key; and 1 MiB complete stored run including its encoded key.

The pure accounting routine charges actual UTF-8 stored encodings, keys, duplicated source strings, closed history and reservations. A live run retains two journal slots plus 74 KiB terminal capacity. A nonterminal action reserves its finite remaining graph, at most four slots plus 138 KiB before its first step. Intermediate settlement consumes its own growth allowance. Retirement transfers the terminal floor; close releases the remainder. Admission checks the worst permitted future run form against the actual immutable source encoding. Unsupported sizes refuse before mutation. There is no pruning or logical-cap exemption; physical quota failure can still be uncertain.

## Upgrade and reset

Versions 0–3 are checked against exact prior store/index shapes. Versions 0–2 retain Gate A's created/unproven-upgrade and unknown birth behavior. A v3 upgrade validates incarnation/admission/enrollment key-body consistency through queued reads inside the versionchange transaction, creates only the three new stores/index, and never rewrites prior rows. Ordinary v4 access checks the exact layout too. Blocked, aborted, corrupt and future versions do not delete/recreate the database; a v3 opener against v4 gets `VersionError`. A request that already reported blocked aborts any later deferred versionchange before touching schema. The deterministic adapter retains and resumes real blocked opens in database FIFO order; its explicit synthetic block fault remains separately labelled.

All four new row variants participate in owner-empty admission and authenticated reset cleanup. Scope and immutable key/body checks precede deletion. Existing second status/readback and admission-carry logic are unchanged. Current-generation and other-owner rows survive; failed cleanup remains pending. The inactive/unenrolled reset path still does not open evidence IndexedDB.

## Evidence and limits

The focused test suite exercises the actual source modules and real registered coordinator/repository/proof paths with the deterministic IndexedDB adapter. Its transport replies and persisted fault/history fixtures are synthetic. Existing repository/reset tests also run their existing in-process SQL fixture. None of this is browser-engine persistence, physical crash durability, authenticated personal-account testing or hosted SQL evidence.

Measured cases include exact twelve-store v3 preservation, old-client refusal, strict layout/key/body corruption, queued upgrade rollback, two-facade acquisition/CAS, permanent managed-slot exclusion, cross-format pending and retirement, close/new episode, historical readback, quota/response loss, retained-writer revocation, exact eight-MiB refusal plus reserved retirement, simultaneous last-run claims, and registered reset preservation/retry/corruption. A temporary isolated source-copy mutation removed the managed-slot guard: the targeted regression failed with a missing expected rejection; restoring the source passed. The shipping tree was not modified for that experiment.

The final source manifest and command logs accompany the parent review. Full-project aggregate/lint/build at one source freeze belongs to the parent. Independent implementation review remains required before B1 acceptance. Browser durability, UI ordering/IME, positive clean-window claims, B2 raw-response call-site omission, disposal-only capture build, same-item listening and Gate C remain unrun or outside this slice. No production readiness or activation claim is made.

# Participating language source-writer closure

Current-source implementation frozen on 2026-10-10. Baseline: `a055e11b82c0bf6deb691c63694be600daf0b822`. Final independent review and parent aggregate/build acceptance are recorded separately below. This is not browser acceptance, permission to publish, or an all-client safety claim.

## Authority and exact source

The coordinator supplies its exact registered record context through `LanguageRecordsProvider`. The snapshot hook returns all selected raw bytes and an opaque selected-key revision from the same coherent read. Missing bytes, a paused capability, and an unreadable document are distinct states. No route uses global localStorage as a fallback. Same-owner pauses retain the editor subtree without write authority; owner/reset changes remain isolation boundaries.

Every domain action captures its original context, source, operation ID, immutable payload, event timestamp and local date before queueing. A synchronous planner reads fresh lock-time records and returns one changes map. It cannot call a second writer, React setter, clock, network/provider, confirmation or audio operation. Domain source dependencies are compared as exact tokens, not sanitized display objects. Source renewal across acknowledgement rotation requires the same owner epoch, binding, reset marker/fence, readiness and exact relevant dependencies. An already-created operation never swaps in a newer capability.

`updateStorageBatchWithReceipt` supplements the existing transaction API without changing its journal format or old callers' final owner checks. A receipt is generated only after the durable marker; the exact application-record transaction after-image is constructed from the checked before-image and successful changes, avoiding a fallible post-marker storage reread. As with the existing StorageSnapshot projection, reserved journal/protocol/generation keys are omitted; the generation is returned separately. This is not a new owner/control proof or raw storage enumeration. Later observed records are separate. If owner/context retirement or notification failure prevents current UI acknowledgement, the result still identifies durable storage success and preserves the user's pending input.

Receipt-only failures distinguish runtime-proven no-commit from unknown outcome. Pre-dispatch rejection or verified exact before-image restoration can prove no-commit. Failed rollback, or a host that writes a committed marker and then throws, cannot. Later matching bytes alone do not retroactively change this classification. Existing `updateStorageBatch` callers retain their original error behavior.

A retained uncertain action can only reconcile its exact receipt or bounded current-state proof under new same-origin read authority. It is not redispatched automatically. After a definitively uncommitted attempt, a separate explicit user action may save the retained input under a new current context after exact source proof. Its old envelope remains unchanged. Pending, durable and unknown actions cannot manufacture the no-commit proof. A cached successful result is evidence of its original operation, not timeless UI freshness; shipped handlers reconcile or coherently reread before publishing it again. Advancing queued dirty input requires exact owned-path comparison between the committed after-image and the later source snapshot.

## Lossless document and row contracts

The source-span JSON editor patches only addressed known value spans and necessary structural separators. Unchanged tokens retain large-number literals, exponent/decimal spellings, string escapes, ordering, whitespace, duplicate unknown members and opaque rows. Malformed/null/wrong-root documents and duplicate touched or traversed members block writes. Known numeric no-ops use exact decimal comparison, avoiding JSON.parse rounding, infinity/null conflation and underflow. Display projection never becomes writable source.

Opaque row handles bind the registered original source, key, exact whole array bytes, original ordinal and row token. This migration deliberately uses conservative whole-array CAS: any changed array conflicts, including an unrelated insertion. No heuristic relocation, index-after-filter mutation or persistent ID backfill is used. View identities are separate presentation-only natural-identity/occurrence keys. Dirty review inputs retain their original handles even when new props arrive under the same React key.

## Action boundaries

- Course: narrow track/group updates, exact per-lesson draft proof, serialized revisioned autosaves and a single progress+review finish transaction. Restored normalization does not write on mount. A legitimate new session initializes conditionally. Only the exact finishing draft is removed; unrelated/newer sessions survive.
- Course finish receipts: reserved versioned `languageFinishReceiptsV1` within the existing reset-covered progress document. Exact immutable payload strings and results are retained for the current reset generation without silent pruning. The original 20-attempt display cap is independent. Unknown receipt format/collision and quota failure fail closed. No daily routine/history or daily reviewed-item action is added to course finish or KanaStarter.
- Daily: routine and matching history update atomically from fresh memberships. Existing known routine IDs, local-day semantics and thresholds are retained; unknown memberships/tokens and other dates remain. An older captured day cannot move the routine head backward. Toggles additionally use strict generation CAS and cannot blindly replay after uncertainty.
- Legacy learning: existing queue deduplication tuples and quiz thresholds remain. Wrong-answer and threshold completion changes compose in one transaction. Grammar increments fresh validated counters and uses an exact bounded last-operation proof. No storage side effect occurs inside a React updater. Failed quiz intent prevents dependent advancement until explicitly resolved.
- Settings: narrow explicit field intents replace mount/autosave normalization. Same-field source conflicts preserve drafts; unrelated unchanged paths can merge. Goal save is atomic across its required documents. Confirmed defaults reset only known app/integrated fields and preserves unknown fields, daily goal and records. Independent device appearance remains independent.
- Review/progress: reviewed IDs, schedule changes and threshold completion compose atomically. Course review uses a bounded last-operation proof that validates the exact expected after-row and immutable payload, so a later row change cannot be mistaken for the earlier save. Existing group-delete semantics remain, but hidden unsupported matching rows block group deletion. Occurrence deletion uses the original opaque row handle. Full-section clear requires confirmation and strict generation/source CAS and does not clear the separate legacy character key. Dirty course answers retain their original row, handle and learner mode across refresh, tab changes and temporary pause; deletion and quiz advancement wait for acknowledged commit.

## Fixed storage scope

The selected list remains exactly 16 keys: `japaneseCurriculumProgressV1`, `japaneseCurriculumReviewV1`, `reviewCompletedItemsByDate`, `dailyRoutineProgress`, `dailyLearningHistory`, `integratedLearningSettingsV1`, `japaneseAppSettings`, `learningSettings`, `savedWords`, `savedSentences`, `wrongKana`, `wrongKanaChars`, `wrongWords`, `wrongSentences`, `grammarProgress`, `languageRecordResetV1`.

Fifteen have business mutations; the reset marker remains boundary/reset-only. Record reset still clears its original 12 record keys and retains the three settings keys. There is no new storage namespace, journal, hosted table/schema/RPC, reset participant or durable sidecar. Live, A2 and G5 boundaries are unchanged. Unscoped `confusingKana` remains unread and untouched.

## Source closure audit

`tests/language-writer-closure.test.ts` checks the key/reset list, every business route/helper/component, explicit projection input, removed helper imports and aliases, exclusive domain-runner adapter authority, and the complete reachable import/reexport/index/dynamic-dependency graph. Computed or unresolved dependency routes fail rather than being silently skipped. Reachable raw storage helpers require explicit boundary review.

A production-wide scan checks selected-key call arguments and imported/local aliases, computed raw storage methods, namespace/reexport/dynamic adapter escape routes, and newly exposed raw storage capabilities. `tests/helpers/languageStorageCapabilities.json` records the exact baseline bytes of 55 unchanged external/independent storage-capability files and 102 transitive generic-capability importers; changes require a renewed selected-key call-chain audit. This avoids treating a wrapper-only grep as closure. The scan includes data modules and JavaScript/module extensions. An executable computed-key/aliased-generic-writer fixture verifies inherited capability detection. Static guards supplement, and do not replace, shipped-handler and transactional tests.

Outside-language local consumers keep their prior guarded boundary: unified calendar invalidation and the independent appearance fallback. Owner-filtered remote assistant/growth/advice readers remain remote readers. Additive inner receipt compatibility is checked without treating those server rows as local provenance.

## Validation status

Focused results and independent reviews are local synthetic evidence. They use shipped handlers, registered authority, a synthetic DOM and a serialized synthetic LockManager. Counts overlap and must not be added to a parent aggregate.

The final combined focused shipping run passed **479/479**, with zero failures or skipped tests. It includes the source-closure guard, all five domain mutation suites, shipped language handlers, the central adapter/transaction layer, lifecycle/reset, and guarded readers. Command:

```sh
node --experimental-strip-types --test \
  app/data/language*.test.ts app/data/storageTransaction.test.ts \
  app/data/japaneseLearningStorage.test.ts tests/language-*-writers-ui.test.ts \
  tests/language-guarded-readers-ui.test.ts tests/language-route-readers-ui.test.ts \
  tests/language-sync-lifecycle-ui.test.ts tests/language-reset-lifecycle.test.ts \
  tests/language-reset-ui.test.ts tests/language-writer-closure.test.ts
```

Whole-tree `tsc --noEmit --incremental false`, ESLint across all 55 changed/new TypeScript source and test files, and `git diff --check` passed. Independent focused checkpoints passed W0 139 (133 shipping + six separate adversarial), W1 87, W2 83, W3 39, W4 42, lifecycle/boundary/reset/readers 106, and the closure guard 10; these overlap the combined run. Independent source review found no remaining blocker and verified the final frozen hashes. The parent aggregate checkpoint below supersedes the earlier pending status.

Actual browser coverage remains unrun: real multi-tab Web Locks, BFCache/visibility, refresh/back/navigation, 320px layout, IME, storage availability/quota, authenticated save/reload and private-account behavior. The earlier browser socket denial is respected; no fallback route was used. Publication, merge, hosted changes and deployment remain separately gated.

## Remaining protocol limits

This closes the audited participating writer paths in the current source build; it does not establish all-client or end-to-end browser safety. Already-open/cached old raw clients can still bypass locks, hide ABA from generation and repopulate records. No universal writer quiescence is claimed. The existing client-supplied `updated_at` remote CAS remains weaker than exact server-content/revision CAS and can overwrite a timestamp-reusing competitor. Warm offline clients cannot know an unseen server reset. Aborting a request does not recall a dispatched server write. These remain explicit later protocol and acceptance gates.

Lossless local token editing does not make the existing cross-device JSON or opaque whole-string merge lossless or conflict-free. Unknown fields, large-number spellings and concurrent receipt updates still follow the existing remote merge behavior. This migration does not replace that merge protocol or establish cross-device receipt uniqueness.

## Parent aggregate checkpoint

2026-10-10 00:29 UTC, final frozen sources on local parent `a055e11b82c0bf6deb691c63694be600daf0b822`:

- Full test runner: **2,583/2,583 passed**, zero failed/cancelled/skipped.
- Shipping shared-sync handler diagnostic: **49/49 passed**.
- Full nonincremental TypeScript, whole-repository ESLint, and Next production build: all exit 0.
- Existing early-app Playwright selection: **278 cases in 19 files discovered only**, no browser launched.
- Independent source review and final manifests found no remaining blocker in this bounded current-source slice.

The `twelfth-*` local logs preserve the checks. Focused subsets overlap the full aggregate. No GitHub publication, new CI/browser result, hosted migration, main merge or production deployment occurred. Existing publication approval and browser/hosted verification gates remain open.

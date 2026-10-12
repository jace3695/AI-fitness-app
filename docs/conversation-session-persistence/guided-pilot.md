# G5 bounded guided convenience-store pilot

Date: 2026-10-10 UTC. Accepted predecessor: local `e9e4b17afb807f15d36a99b9207aaaac508571f5`, tree `94c4b239f33dc814581046cfe242f6ee0b897450`.

## Scope and acceptance boundary

This increment connects exactly **3 of 24 requested situation-by-level cells** to the existing device-local saved-session flow: convenience store × beginner, elementary and intermediate. The scripts contain **2, 3 and 3 distinct learner steps**, respectively. The other **21 cells remain reference-only/unwritten and cannot start**. Five unchanged legacy examples remain separately available and unlevelled; they are not additional levelled coverage.

This is a locally implemented, synthetically verified, **text-only and explicitly unassessed pilot**, not overall G5 completion. Native-speaker/professional content review, the remaining 21 cells, authentic automatic correction, correction/review ingestion and real-browser/device acceptance remain open. The production assessment registry remains literally empty.

Each nonblank explicit submission records one authored step only when its append applies. The button says `보내고 다음 단계로`, or `마지막 문장 보내기` on the final step. IME-safe Enter has the same stated action. Equality with the saved example or reading is a string-comparison fact only; arbitrary nonmatching input also advances once, retains its exact bytes and displays a reference example. Whitespace-only input does not advance. The counterpart is labelled `정해진 점원 응답`: it is predetermined and does not adapt to the learner's input. A fallback is `참고 예문`, never a correction. The last submission does not automatically close the session. Explicit close is available before any submission, partway through, or after all steps.

## Pinned authored content

`data/guidedConversationPilot.ts` contains the exact deeply frozen authored scripts, with explicit script-ID/revision lookup and no unknown-selection fallback. The revision recipe is SHA-256 over UTF-8 canonical JSON of each complete script with `scriptRevision` omitted: sorted object keys, ordered arrays, no formatting whitespace. Runtime writes use pinned literals rather than asynchronous hashing or the latest catalog.

- Beginner: `sha256:4d72bba976fc0aa52a7f4913b4f08d9e8a9be1022c057e19bfeb1a90f5e4989a`
- Elementary: `sha256:fb7841b7c9311d429ac7dddfc0b7cf1b3d2b97d4ff237cff5d5718cae213e99c`
- Intermediate: `sha256:9f45d6a111675b171beceb596f56fad136321478657d8797d1155c5fcb2f329c`

Every step freezes its ID, title, goal, opening prompt, learner example, fixed reply and hint. Each phrase retains Japanese, kana reading, approximate Korean pronunciation and Korean meaning. Exact content, order, review flags and policy metadata are covered by the digest and supported-source equality checks. A known digest cannot be used with altered text or a substituted script identity. Unknown supported-shape revisions are preserved read-only; unknown layouts/discriminators remain blocked.

Content status remains `locally-authored-unreviewed`. The pre-implementation review was an independent **local textual review**, not native-speaker or professional validation. Korean pronunciation is an approximate reading aid, not audio, accent instruction, alignment or pronunciation assessment. Beginner/elementary/intermediate are internal practice labels, not JLPT/CEFR certification. No approved phrase was silently changed under its original digest.

The original `data/freeConversation.ts` remains byte-identical, SHA-256 `b92edd91c70d93da57f767c30405fd013460fd98216447854212b6e7bc7483be`. Its five sources, emitted legacy responses, catalog version, match policy and summary behavior remain compatible. The paid conversation component is byte-identical to the accepted predecessor.

## Envelope versions and old-client consequence

A genuine strict v1 branch still admits only legacy records. A mixed-source v2 branch uses the **same owner partition key**, generation, marker, causal enrollment/observation, transaction protocol, immutable operations and receipts. There is no second store, migration journal, cloud record or new storage capability.

Only explicit guided creation enrolls an absent partition as v2 or upgrades an existing v1 partition. Upgrade plus new session is one complete after-image against the fresh locked envelope. Existing owner/generation/marker/enrollment, legacy sessions, peer writes and tombstones are preserved. Preview, selectors, history and ordinary legacy writes do not migrate v1. Legacy writes against an already-v2 partition retain v2. A failed transaction does not acknowledge an empty upgrade; an unknown outcome retains the original intent and requires exact read-first reconciliation rather than another creation.

Reset replacement preserves the recognized current envelope version. V2 stays v2; an absent partition stays absent; an unknown partition remains blocked and untouched. The only participant implementation change is version preservation. Generation replacement, causal observation, exact marker ordering, same-marker receipts and the central owner/reset algorithm are unchanged.

**Old P2-B/P2-C clients fail closed on v2. This can block broader language synchronization and reset, not merely guided history.** Their strict parser reports an unsupported version, and the participant is read during language-sync request/snapshot validation and reset planning. Frozen predecessor-parser tests exercise that consequence and confirm raw v2 bytes remain untouched. This is data-protective fail-closed compatibility, **not mixed-version rollout safety or downgrade support**. Do not strip v2 fields or replace the partition with v1 to make an old client read it.

Legacy close-policy coherence preserves previously accepted arbitrary unsupported identifiers, including one that now happens to equal a guided policy name. Such old subobjects still migrate unchanged; the legacy recap remains unavailable for unsupported summary policy. This does not allow guided emissions to be laundered into legacy turns. Guided source/emission/order/known-policy compatibility is validated separately.

## Required corrections implemented

### R1: two saved earlier-step lanes and a truthful exit

The two persistent draft lanes remain bounded and non-evicting. A reachable A/B-retention state before C preserves both exact older drafts under their original step references. The current step is read-only/not sendable when no current-step lane can be opened. The UI explains the lane limit separately from the envelope-size limit and exposes `현재 기록으로 대화 종료`.

Partial close records factual 2/3 coverage and the unsubmitted step; both older inputs remain unsent drafts. A separately requested new session begins again at its first step and remains subject to ordinary session/count/byte admission. It does not transfer progress. No automatic close, new session, per-draft deletion, retagging or eviction was added.

A third dirty in-memory input stays visible and blocks close until preservation succeeds or the user explicitly confirms discarding that **unsaved input only**. Saved lanes are never included in that discard. Confirmed guided discard can leave no active editor while preserving saved lanes and sticky step-specific display facts; it does not immediately reopen a saved draft as dirty merely because later help was displayed. Opening the current step is then explicit, and guided typing remains disabled until that action. The same explicit-opening rule applies after a peer consumes the displayed editor.

### R2: one bounded initial explicit-close reserve

Every open guided session with no retained close operation reserves logical space for **one initial explicit close attempt** under the unchanged 262,144 UTF-16-code-unit envelope cap. Sizing includes complete staging and the worst applied/cancelled representation, duplicated boundary/receipt metadata, maximum escaping and metadata lengths, turn-reference growth, pending-append terminal growth, and operation/state-revision headroom. Other sessions cannot spend the reserve. Sizing addresses its appended specimen directly so a valid worst-case ID matching older history cannot cause undercounting by overwriting a sizing copy of that history.

A retained close operation spends the initial guarantee, even if cancelled. The original staged operation's apply/cancel/read-first recovery remains covered; observing it again does not create a new attempt. A later newly requested close is admitted only when the actual remaining byte/count/revision budget permits and can truthfully be capacity-blocked. The reserve is not endlessly renewed. Legacy v1 capacity/admission behavior is preserved.

This is a **logical after-image reservation**, not browser-origin quota, journal-storage reservation, physical durability, current authority or eventual success. Physical storage/acknowledgment failures retain the existing blocked/unknown behavior and input-preservation rules. All existing ceilings remain: 25 sessions, 500 total committed/reserved turns, 200 turns per legacy session, 8,000 UTF-16 units per input and two persistent draft lanes. Guided sessions additionally stop after their exact 2/3/3 steps. No receipt pruning or limit relaxation was introduced.

### R3: immutable draft-ID source identity

A guided draft ID pins exact `{scriptId, scriptRevision, stepId}` across every retained revision, current lane, committed turn, pending/applied/cancelled command and recovered draft. Consuming a lane does not forget that identity. A new step gets a new draft ID. Older-step drafts can be saved under their original references but cannot be resubmitted under the current prompt; future-step references and cross-revision retagging are rejected. Unedited inserted content must equal its own step's exact example.

### R4: append admission and historical replay are separate proofs

New append admission requires a coherent open current session, no pending command, the active authored step, the exact persisted draft, frozen rendered head/editor/step proof, current session CAS and registered facade authority. Historical validation instead derives the recorded turn or operation from its original prefix and immutable draft. It does not require the consumed draft lane to exist today or use today's active step as historical authority. Prefix reconstruction is validation data, never a write capability.

The hook preserves accepted P2-C rendered-source and post-await fences, including post-save and post-create rereads, selected-script/revision identity, unknown creation and every terminal apply/recovery/cancellation-winner path. Newer A input typed while A is appended remains A input. It is not silently reinterpreted as B. Stale callbacks cannot advance an unseen step or manufacture current-step provenance.

## Display facts, recap and privacy

Example/reading/meaning/hint observations are sticky by exact owner/generation/session/script/revision/step and follow actually committed visible DOM. Stale effects are rejected. Prompt translations and prior transcript are contextual help, not evidence that the current target hint was shown. A's fallback/hint never marks B helped. Post-answer help can affect later drafts of A only after display and cannot be backdated into A's submitted answer. Unknown exposure is not converted to `not-shown` or an independence claim.

The guided recap has its own versioned branch; it never passes multiple steps through P1's singleton-example adapter. It retains frozen source/level/revision, original close observation/timezone, exact per-step input/reference/goal, origin, pre-answer exposure, equality fact and every actual emitted field. Coverage is `none`, `partial` or `all-steps-submitted`, with ordered submitted/unsubmitted IDs. Nonblank unsent drafts are listed separately under their real steps; acknowledged empty lanes remain stored but are not presented as expressions. Submission is not correctness or goal attainment. Assessed turns remain zero and well-used/correctable-expression claims unavailable and empty. Pure projection is not a persistence receipt or proof that no later reset occurred.

The sole production facade importer remains the existing hook. The page imports only the recap projector; the renderer's projector import is type-only. Closure allowances add individually named pure helpers through the same contracts-module route, retaining namespace/dynamic/re-export/computed escape negatives. The 16 selected-language keys and 12 legacy reset-record keys remain unchanged. No provider, ASR, TTS, credentials, dependency, SQL, central owner algorithm or voice asset was added or changed. Guided content has no audio control or call; existing legacy sample playback is preserved. Synthetic canaries cover provider/cloud payloads, notifications, diagnostics, prepared journal handling and backup exclusion.

## Verification before the parent aggregate gate

Implementation verification uses synthetic owners, records, storage/browser boundaries and SDK responses. The actual shipping auth/coordinator/facade/hook/page execute in those fixtures. They are not real-browser or physical-device evidence.

- Consolidated focused conversation/content/model/facade/reset/privacy/UI/closure run: **369/369**, no failures/cancellations/skips. Log: `/tmp/yeoni-guided-final-focused.log`.
- Timing caveat: this run began just before one **test-only** strengthening of the applied-winner cancellation uncertainty case. Production bytes were already frozen. The strengthened test loses the actual read-only replay acknowledgment rather than injecting a nonexistent marker transaction, explicitly checks uncertainty and then recovery; its focused pair passed **2/2** afterward. Therefore 369 is not asserted to be a complete single-final-test-freeze result. The parent aggregate must exercise the final source.
- Combined UI checkpoint: **82/82** (56 existing P2-C cases and 26 guided cases), with the same subsequent test-strengthening caveat. The guided cases include all actual page flows, saturation/dirty-third-input recovery, step exposure, post-apply DOM effects, final-step retained input, peer progress, pending restoration and explicit no-editor opening.
- Full nonincremental TypeScript, focused ESLint over all 22 changed/new code/test files, and `git diff --check` passed. Logs: `/tmp/yeoni-guided-final-types.log`, `/tmp/yeoni-guided-final-lint.log`.
- Independent final review approved the exact 22-file freeze without an open blocker: **13/13 external core probes**, **6/6 final-hook external shipping probes**, **298/298 selected regressions** and **26/26 guided UI cases rerun after the final test strengthening**. Final hashes and seven protected files were reverified. Review: `/workspace/shared/yeoni-guided-conversation-implementation-review.md`; reviewed manifest: `/workspace/shared/yeoni-guided-conversation-reviewed-freeze.sha256`.

All these counts **overlap** and must not be added together or added to the parent aggregate. No predecessor aggregate count substitutes for verification of this pilot. The 22-file implementation manifest is `/workspace/shared/yeoni-guided-implementation-files.txt`; this documentation-only checkpoint is additional. Four pre-existing reader-lifecycle artifacts remain untouched.

### Authored E2E coverage and workflow inclusion

Three new guided scenarios were added to the **existing** `tests/e2e/free-first.spec.ts`, one per level. Each covers explicit selection/disclosure/start, exact draft save and reload, all authored steps, explicit close, factual history/reopen, 320px overflow assertions, unchanged server state and provider-POST/audio tripwires. The existing legacy conversation E2E case was updated for the renamed `기존 예문 · 수준 미지정` selector; its explicit flow and no-POST/paid-route/unassessed assertions remain.

Discovery-only Playwright `--list` succeeded with the required disposable-loopback configuration: **28 discovered cases including authentication dependencies**, of which the three new guided scenarios produce **six engine cases** across Chromium and WebKit-small. No browser or web server was launched and no fixture account was used.

The file is already explicitly included by `.github/workflows/browser-verification.yml` in the two-project command (`--project=chromium --project=webkit-small`), without a grep excluding these cases. It is also covered by that workflow's full-suite command and the existing Playwright project patterns. **No workflow edit was necessary.** Inclusion/discovery is not a workflow execution result.

## Remaining acceptance and parent gate

The prior actual-browser `EPERM`/escalation denial remains respected; no alternative browser route was attempted. Authenticated real storage, refresh/Back/close behavior, real multi-tab timing, IME event ordering, 320px usability, physical-device behavior, storage latency/headroom and crash durability remain **unrun**. Local text review does not close native/professional content review. Assessment/correction/review ingestion, the other 21 cells and overall G5 remain incomplete.

The implementation worker made no commit, push, PR, hosted/private-account mutation or deployment. Root owns the final exact-freeze aggregate, shared-sync diagnostics, full types/lint/build, review acceptance, checkpoint commit and any separately authorized branch upload. Publication or a green build must not be described as production/main approval or as closing the unrun browser gate. The parent appends the final aggregate/commit result below only after verifying it.

## Parent final aggregate checkpoint

2026-10-10 02:22 UTC: final source and the strengthened UI test passed **2,895/2,895 repository tests**, zero failed/cancelled/skipped; **49/49** shared-sync handler diagnostics; full nonincremental TypeScript, whole-repository ESLint and Next production build, all exit 0. Independent review accepted the frozen implementation with 13 external core probes, 6 external shipping probes, 298 overlapping selected regressions and the final 26-case guided UI rerun. The focused subsets are not added to the aggregate.

Evidence: local `sixteenth-*` logs. Browser discovery lists **284 cases across 19 files** in the existing early-app selection, including the three new guided scenarios in both engines; no browser was launched locally. Authenticated browser/hosted/device and mixed-version rollout acceptance remain open. Owner approved upload to the named development branch; this checkpoint itself does not claim the branch was updated or any main merge/production deployment occurred.

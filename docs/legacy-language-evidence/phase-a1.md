# Legacy course evidence, Phase A1

Source baseline: `ed4c7d058c6374a198184906d14664c35cbbec20`. Local implementation only. This is the inactive pure foundation of G4, not G4 acceptance or production activation.

## Implemented boundary

- Strict version-1 event, receipt and snapshot schemas; exact authenticated-context owner/generation comparison; prospectivity and source/format/content/grading validation; explicit immutable source-slot tuple.
- Authored question metadata and a 496-task catalogue. Generated meaning and input questions share their vocabulary identity. Advanced pattern examples remain separate from vocabulary. Core questions retain their own identity. No fuzzy or text-based identity resolution.
- A pure `legacy-study-v1` projection of item/revision/modality pairs. All three observed formats are separate; past modalities stay unknown, speaking remains unobserved. No legacy aggregate or completion adapter exists.
- Factual shared summary functions. No UI or assistant imports them yet.

No SQL, IndexedDB/outbox, network requests, capture hooks, provider calls, production UI, assistant integration, Live changes, legacy completion/scheduling changes, commit, push, hosted operation or browser execution was performed for A1.

## Contracts for the next phase

The caller must acquire `ProjectionContext` from authenticated, owner-epoch/reset-fenced context. Passing an owner ID is not authentication. The snapshot must echo the exact owner, generation, prospective start, and generation-stable study-day timezone. Persist that timezone with the generation; never use the current device timezone to reinterpret older days. Events retain their own recorded timezone separately.

The complete snapshot is the exact committed server sequence prefix `1..throughServerSequence`. Missing sequences, conflicting IDs/payloads/receipts/semantic slots, unknown source revisions or clock errors suppress promotion. Exact repeated receipt delivery is deduplicated. Conflicting IDs are quarantined, never last-writer-wins. Retired/unknown raw events are not rewritten; they remain in the source snapshot for later historical inspection, but cannot populate the current projection.

Receipt hashes have strict shape and participate in replay equality. Cryptographic hash verification, server authority, receipt authenticity, frozen/immutable durable writes, actual audio-event collection and verified paging remain repository responsibilities in A2. A1 neither fetches nor claims to authenticate a receipt.

The episode begins with presentation sequence 0; actual answers have contiguous positive sequences. Repeated answers are explicitly retries. Feedback after any submitted response reveals the answer in the existing UI: later responses must retain `answerPreviouslyRevealed=true`. Previously exposed typed targets/readings/answer choices and listening targets/readings/translations must also retain this flag even after hiding the text. Forgetting it makes the episode partial. Ordinary visible listening choices are allowed, and described in the summary; they do not prove attention, hearing or language ability.

`responseMs` is nullable and bounded, never implicitly zero/fast. Complete timing must fit the recorded elapsed episode. Future, nonprospective, reversed or inconsistent clocks and ambiguous simultaneous failure/success ordering cannot promote. A complete snapshot containing incomplete required response provenance reports partial coverage, with raw valid outcomes retained and stage unknown.

## Versioned study policy

These are initial product heuristics, not validated cognitive-science thresholds or certified memory.

- No new presentation/answer: `시작 전`, primarily described as `영역 기록 없음`.
- Presentation only: `학습 중`.
- A qualified correct first response, no help/reveal and complete provenance: `한 번 완료`.
- Latest wrong/helped episode or suggested due date reached: `복습 필요`. Being due does not establish forgetting.
- Three consecutive qualified study days spanning at least 7 actual elapsed days: `거의 익힘`.
- Five consecutive qualified study days spanning at least 30 actual elapsed days, with the final gap at least 14 elapsed days: `장기 기억 완료 · 기록 기준`.

One study-day credit per item/modality; actual responses/retries remain counted. Help/wrong interrupts the run at the actual response time even if an older episode resumes later. Due takes precedence; prior highest stage and its evidence remain visible when trustworthy. The new suggested intervals are 1/3/7/14/30 days, advancing only once when the previous actual gap elapsed. Early responses do not postpone due dates. None of this edits the old scheduler.

Typing is always `직접 입력`. Listening is always a response to a listening-format task, with explicit matching completed-playback and text-visibility provenance required for qualification. No evidence certifies actual hearing, attention, speaking, handwriting or retention.

## Preservation and verification

Before metadata edits, Node evaluated the baseline catalogue and old selection/grading functions. Regression tests preserve:

- Full stripped catalogue SHA-256: `5f14c077777c5e68fc9817f0bce097f85982385af29dbe689477c92157e9cf58`.
- All 5/10/20-minute selections, starter/reader choices, and typed-answer grading probes SHA-256: `8ee0b2f6007606ca2474eba29fda5873aebaddf56c4de9e52175365363f4b70d`.
- 62 lessons, 496 quizzes, original IDs/content/order/count, first-answer scores, final retry results, sticky legacy help/timing, review IDs, old unobserved-draft behavior and repeated-save idempotency.

Focused command:

`node --experimental-strip-types --test lib/language-legacy-evidence/*.test.ts`

The current suite has 41 passing tests covering schema roundtrip/rejection, source/revision collision, all six stages and exact thresholds, same-day repetitions, long gaps, missing timing, audio failures/text leakage, skip-not-answer, retries, overlapping episodes, duplicates, late commits, partial prefix, owner/reset mismatches, clock/DST rules, summaries and old-semantic regression.

Full-repository TypeScript and focused ESLint checks are recorded in the parent implementation report after the final source freeze. Root aggregate tests/build are separate from focused tests. Browser, database, save/reload/reset integration, same-item optional practice, UI/assistant consistency, physical-device behavior, actual learning effects and publication remain unverified and outside A1.

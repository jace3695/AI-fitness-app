# G5 P2-A: inactive conversation-session foundation

Date: 2026-10-10 UTC. Baseline: `77768814b86aaf4baa6493cb2f37821512e12973`.

## Scope and status

This checkpoint adds only pure contracts, deterministic planners, a factual recap adapter, and synthetic tests. Nothing imports the foundation from production. There is no store instance, browser storage key, reset participant, owner capability, facade, hook, UI, provider, audio, cloud upload, hosted change, migration, new dependency, publication, or A2 activation. The production assessment registry stays empty. The five original examples remain unlevelled; the 24 level/context cells remain unauthored/reference-only.

A returned `planned` result is an immutable proposed after-image, **not** a successful write. A returned `replay` means matching persisted data was supplied to a pure function, **not** current authentication or a durable read. The future P2-B facade must establish all actual owner/runtime authority, lock-time source, transaction, receipt, unknown-outcome, reset, and current-acknowledgement guarantees before production use. No browser or release acceptance follows from these tests.

## Files and public seam

- `lib/conversation-session/contracts.ts`: strict schemas, immutable legacy snapshots and builder compatibility, canonical encoding/parser, coherence validation, conservative logical capacity calculation.
- `lib/conversation-session/reducer.ts`: `sessionSource`, `planCreateSession`, `planSaveDraft`, `planStage`, `planApply`, `planResolve`, `planDeleteSession`.
- `lib/conversation-session/recap.ts`: `projectClosedConversationRecap`, with no assessment-input parameter or trust-restoration route.
- Synthetic tests and their test-only fixture helper in the same directory.

The caller supplies frozen IDs, timestamps, source, and command payloads. No planner reads a clock, generates IDs, touches storage, takes a lock, performs network work, or mutates its input. Parsing an already supplied timestamp and validating a timezone are deterministic operations, not observations of current time. The returned objects are recursively frozen.

`sessionSource` contains exact canonical session bytes plus owner/generation/session identity. It is a compare-and-swap data token, not an opaque authority handle. Matching it rejects same-session drift while preserving unrelated sessions from the current envelope. A future facade must keep actual registered authority separately and must not expose these pure functions as an authority bypass.

## Frozen data model

One schema-version-1 owner envelope includes:

- Owner and independent local generation IDs; exact legacy reset marker (`timestamp|request UUID`, preserving fractional precision and case) or null; explicit enrollment metadata.
- Sessions with immutable source snapshot, creation timezone/time, state revision, head revision, turns, at most two draft lanes, operation records, and optional immutable close boundary.
- Generation-scoped deletion tombstones. Deleted session IDs cannot be reused.

A source snapshot preserves the entire current authored content, label, unlevelled identity, source module/export/entry/revision, step ID, catalog version, builder policy, and sample-match policy. Claiming the supported revision with altered authored content is invalid. Unsupported historical source/policy data cannot activate today's builder or recap.

Each draft preserves exact UTF-16 input, ID/revision, recorded save time, source reference, typed/inserted origin and inserted-then-edited flag, and tri-state pre-answer exposure for example, reading, meaning, and hint. Empty/whitespace draft revisions are allowed so an acknowledged erase does not resurrect an earlier nonempty draft. Empty/whitespace turns are forbidden. An unedited inserted example must equal the exact frozen Japanese example and must record example exposure as shown. A draft ID/revision cannot acquire divergent bytes in historical commands, turns, or a current lane. A consumed draft's ID must not be reused for divergent revision-1 bytes; a new editor lane may use a new caller-generated ID.

Turns are append-only, revision 1, sequential, and predecessor-bound. They preserve their exact submitted draft, versioned equality-match fact, actual fixed-builder branch, and every returned reply/reading/pronunciation/correction/explanation/source field. The supported snapshot implementation is checked against the actual legacy builder. `emission.postAnswerHint` records that the returned payload contains a hint; it does **not** prove that the payload was displayed. The future UI must separately capture actual display and carry sticky exposure into later drafts. An emitted hint is never backdated into pre-answer exposure.

A close boundary freezes the ordered complete turn references, boundary and summary policy IDs, close time/timezone, and original observation metadata. Observation metadata means “successful authenticated remote observation received by this client,” with request/owner/epoch/lifecycle/marker identity. In this pure layer it is only supplied data. It is not a local-write clock, signed server timestamp, fresh server claim, owner capability, or proof of no unseen later reset. P2-B must source it from the trusted coordinator at the actual remote response, not at a later lock or local save. Local clock reversal is not server order and does not invalidate historical data by itself.

## One terminal state machine

Commands are discriminated `append` and `close` objects. Every operation retains its original command verbatim plus one terminal field: null, applied, or cancelled. An applied record must match its immutable turn/boundary. A cancelled record keeps the exact new resolution command and the original recovery result. Receipt IDs, operation IDs, result identities, resolution IDs, draft versions, predecessor order, and close coverage are checked. ID categories are explicit; different command results cannot reuse a turn/boundary identity, including after cancellation.

- Stage checks terminal records first. Same ID and exact payload returns the existing state; divergent payload conflicts. An old stage cannot recreate a pending slot after apply/cancel. A tombstone takes precedence and forbids resurrection.
- Only one unresolved command per session. A different command cannot overwrite it, and close cannot bypass an unresolved append.
- An append pins its exact durable submitted draft lane until terminal state. Other-lane edits are permitted only if they fit the remaining budget. No automatic lane switch or overwrite occurs. If both lanes are occupied, newer input must explicitly revise an unpinned lane under its exact source or remain unsaved; it cannot displace the submitted lane.
- Apply appends exactly one turn or closes exactly one boundary. Only the exact submitted draft is consumed; the other lane survives. Closed sessions cannot receive further drafts/turns in this model.
- Resolution is a **new explicit command** under exact current source, bound to the unchanged original pending command. Append cancellation retains the pinned lane as unsent and freezes its recovery snapshot; it does not create a duplicate lane. Close cancellation creates no draft, does not close or reopen anything, and preserves all existing drafts.
- Apply wins a race if its exact receipt/result already exists. Cancellation wins if its exact terminal record already exists. Repeated exact resolution is idempotent; a different resolution payload cannot rewrite it. Later original stage/apply returns the terminal result and never resubmits it.
- Missing both command and matching receipt remains `unresolved`. Absence, matching text, elapsed time, or a pure result cannot prove no commit. A recreated runtime cannot redispatch an old operation just because its data parses; only the future original-capability facade may call apply on behalf of an original intent.
- Deletion requires exact current session source and revision. It removes only that session and adds a permanent generation tombstone. User approval of irreversible deletion belongs in the future facade/UI; this planner cannot prove consent.

No planner silently prunes receipts, tombstones, sessions, drafts, or input.

## Capacity and preservation

Approved ceilings are 262,144 UTF-16 code units for the entire serialized owner envelope, 25 retained sessions, 500 total committed turns, 200 per session, 8,000 input code units, and two draft lanes. These are joint ceilings; larger realistic payloads can hit the envelope ceiling well before the count ceilings. They are not bytes or an origin quota.

Admission uses actual canonical envelope length **plus**:

1. The maximum serialized growth for applied or cancelled terminal state of every unresolved command, summed across all sessions. Worst-case resolution IDs include JSON escaping, timestamp length, and revision digit width. Pending append count capacity is reserved too.
2. An additional full worst-case deletion tombstone for every retained session, conservatively without credit for removed session bytes.
3. One state-revision increment for each unresolved command. No draft edit can spend the last terminal increment. Tombstone count headroom is reserved as well.

Every planner and parser validates the same budget. Other sessions and draft updates cannot borrow pending completion/cancellation reservations. Staging can block even when its immediate bytes would fit. Logically admitted append, cancellation, close, and deletion have reserved representation space. Exact boundary and adversarial multi-session tests cover this property. The conservative reservation can block earlier than an optimal packing scheme; it does not evict data to improve capacity.

This reserves **no actual browser quota**. Other owners, other app data, and the shared transaction's duplicated before-image/journal cost storage outside this envelope. Browser quota, unavailable storage, prepared-journal failure, replacement failure, and durable-marker failure must be tested in P2-B and real-browser verification; none are implemented or certified here. A full metadata budget remains a block, not an excuse to prune metadata or trigger a broad reset.

Persisted parsing accepts only the exact canonical encoding. Alternate key ordering/whitespace/escapes and duplicate JSON members, including duplicate escaped keys, are rejected instead of normalized. All object schemas are strict; in-memory hidden properties, symbols, accessors, custom prototypes, array extras, and cycles are rejected. Invalid/unsupported bytes yield controlled fixed codes only. The caller must retain original raw bytes untouched and must not render, log, attach, normalize, or overwrite them. No raw malformed source or host exception appears in returned errors.

## Factual recap limits

The adapter requires a coherent fully covered closed boundary and supported saved source, builder, match, and summary policies before calling P1. Any unknown exposure is unavailable rather than false. Rich inserted/edited and all four exposure facts remain in the projection; P1's narrow edited-input mapping is conservative. The adapter always passes an empty assessment list. Positive expressions, corrections, proficiency, zero-error claims, and independent-production claims are unavailable.

The output explicitly states `persistence: not-verified-by-pure-projection` and omits P1's caller-declared save-status/verified-at labels. It exposes the original precisely named observation object. Historical authored and emitted content is retained, not reconstructed from a newer catalog. Nonempty unsent drafts are counted separately from committed turns; empty saved lanes are not counted as unsent expressions.

## Privacy and integration gates

P2-B must join both explicit reset and authenticated remote-observation cleanup paths in the existing single-store transaction, with fresh exact owner bytes, lifecycle fencing, receipt/read-first recovery, and no allowlist expansion. No production conversation writer may appear before that atomic participant is independently accepted.

Conversation text must never enter application-created notification metadata, cloud/provider payloads, analytics, logs, diagnostics, URLs, or errors. Native same-origin localStorage events necessarily contain raw old/new values; later listeners must use only key/storage-area routing and never copy, forward, log, or attach those values. This phase has no storage events or listener.

P2-C must separately establish honest local-only retention/disclosure, actual editor/exposure lifecycle, save visibility, history/recap UI, and permitted real-browser multi-tab/reload/IME/owner/reset/quota behavior. Existing denied browser access remains respected. No physical-device, browser, real account, or actual durability claim is made here.

## Verification record

The frozen checkpoint is subject to independent review before acceptance. Focused command:

`node --experimental-strip-types --test lib/conversation-session/*.test.ts`

Additional checks: installed ESLint on this directory, full nonincremental TypeScript, and `git diff --check`. The parent owns final repository aggregate tests, build, and any local commit. Test/type/lint/build results are separate from real browser execution, which was not run. Four pre-existing reader-lifecycle artifacts are untouched.

### Accepted local checkpoint

2026-10-10 00:58 UTC: independent review passed the 33 focused tests plus 12 separate adversarial probes and verified no production activation. Parent final aggregate passed **2,616/2,616 tests**, zero failed/cancelled/skipped; shipping shared-sync diagnostic **49/49**; full nonincremental TypeScript, whole-repository ESLint and Next production build all exit 0. Focused subsets overlap the aggregate. Evidence remains in local `thirteenth-*` logs and the independent review. No browser ran, no hosted resource changed, and publication remains pending. P2-B/reset-participant integration and P2-C/UI are not implemented by this checkpoint.

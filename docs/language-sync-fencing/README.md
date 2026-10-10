# Participating language coordinator fencing

Local implementation, 2026-10-09. This is a bounded participating-client change. It does not establish namespace-wide safety, hosted installation, browser acceptance, or permission to publish/deploy.

## Scope and authority

The shared owner transition now composes language preparation inside its existing short Web Lock and before-image transaction. AuthGate and the root CloudSyncPanel use that same transition; AuthGate has no second raw language cleanup. A successful current `getUser`, completed shared owner readiness, and the PIN gate precede exposure of a runtime-only registered lease. Stored owner strings, copied lease objects, and A2 freshness fixtures cannot manufacture that lease.

The coordinator captures all selected raw strings and exact absence, base bytes, acknowledgement identity, binding/readiness, marker/fence and committed storage generation in one participating snapshot. HTTP is outside the storage lock. Every insert/update has a no-write short-lock dispatch guard and synchronous runtime check immediately before dispatch. Existing owner-filtered `language_user_state` reads and client-`updated_at` CAS/readback transport remain unchanged in authority.

Responses atomically reconcile selected keys, full wire baseline, a rotated acknowledgement UUID and binding provenance. A key changed locally since capture retains its latest exact string or absence. A competing acknowledgement/base mutation rejects the older response. The adapter reports the last snapshot it observed; the coordinator reads again at its final UI-publication boundary. Neither claims immunity to writes occurring afterward.

Unknown current remote fields survive outgoing payloads. Known-key unsupported encodings and malformed base/control bytes block without deleting the original. Inner record JSON remains opaque to this adapter. New metadata is outside both upload namespaces and outside record-reset lists:

- `language-storage-binding-v1`
- `language-cloud-sync-ack:<owner>`
- `language-reset-fence-v1`
- Existing `language-cloud-sync-user` and `language-cloud-sync-base:<owner>` remain compatible metadata

## Ownership and bootstrap behavior

- Truly empty namespaces initialize without fake acknowledgement or reset authority.
- Declared legacy ownership requires agreeing language/shared owner stamps and valid previous prepared shared readiness. Malformed shared readiness/protocol/journal fails globally; corrupt language-only evidence blocks language after reader isolation.
- Unowned/conflicting bytes remain in place and unavailable. Durable ambiguity survives logout/login and owner ABA. No archive, export, discard or automatic adoption is added.
- A valid verified base/ack exactly matching the selected local bytes permits established cache cleanup on owner departure. Pending or unknown/unverified bytes are held for their known owner; another owner cannot read them. No arbitrary other-owner base-prefix sweep occurs.
- Without acknowledgement: exact local/remote bytes may establish one; empty local may import validated remote; an exact full legacy-base/remote match may establish that baseline while preserving local pending delta. Divergent unproved history and missing historical remote rows block recreation. Only genuinely empty first creation may insert.

These are provenance decisions for participating code. A matching acknowledgement means no detected local delta since one observation; it does not prove a remote backup still exists.

## Reset and lifecycle

Language reset captures owner/marker before the outer operation lock, persists pending intent and rotates acknowledgement before auth/RPC, then releases the short storage lock for network. Responses must match app, owner and exact marker request UUID. One transaction removes only the 12 existing language record keys, writes the marker, invalidates the old valid base, rotates acknowledgement and records completed local receipt. The three settings keys and unrelated app records remain.

Unknown outcomes retain a durable pending/uncertain fence. An explicit retry reuses its request ID and reads the server first: matching receipt can complete, unchanged pre-reset marker can retry, a later marker blocks redispatch. A completed receipt retry preserves newer records. A legacy equal marker without cleanup completion evidence never authorizes another bulk clear. Notification/session-receipt failures remain explicit. The safe reset confirmation panel is reachable outside the blocked raw-writer subtree; it never submits automatically.

Owner/reset/control changes, pagehide, hidden visibility and unmount retire runtime operations. Resume verifies auth and reads remote again. An old awaited result cannot publish into a later operation. Same-owner temporary pause retains the editor subtree inert/hidden; a verified changed reset marker gives it a new key so old editor memory cannot reopen in the new generation. Initial failure never mounts raw writers.

Same-document record events and raw read-only polling wake local work without treating old writers as participants. Prepared protocol snapshots block dispatch. Ordinary participating record transactions do not abort already-dispatched retirement; newer edits reconcile at acknowledgement. Independent owner-scoped remote-refresh events are distinct from the coordinator's own acknowledgement event.

The calendar removes unavailable language facts immediately, including while other reads await. The companion preference fallback drops unavailable language-derived cached preferences but retains its independent device setting. Unscoped `confusingKana` is no longer displayed; its bytes remain untouched and it was not added to upload/reset lists. Guarded `wrongKanaChars` stays supported.

## Future write API, not a writer migration

`updateLanguageRecords` requires a registered coordinator-issued post-observation record context and validates it inside the short transaction. The transform receives fresh exact selected strings, rejects metadata/reset keys and async transforms, and retains caller data on failure. `captureLanguageDraftRevision` supplies an opaque selected-byte plus global-generation CAS for React replacement drafts. Unrelated participating writes may conservatively invalidate these draft revisions.

No course, lesson, review, settings, kana, words, sentences, grammar or daily writer was migrated in this slice. Known nonparticipants include:

- `utils/curriculumProgress.ts`, `utils/dailyRoutineProgress.ts`, `utils/integratedLearningSettings.ts`
- `components/language/FocusedLesson.tsx`, `KanaStarter.tsx`, `LearningWelcome.tsx`
- `/language`, `/language/learn`, `/language/review`, `/language/progress`, `/language/settings`, `/language/kana`, `/language/words`, `/language/sentences`, `/language/grammar`
- Mount-time normalization/autosave and review daily-completion replay in those paths
- Already-open, cached or offline old clients; authenticated server assistant apply/undo/reset competitors

FocusedLesson finish still writes only its existing progress/review action; no daily-completion behavior was added. General merge algorithms, curriculum/scoring/scheduling, Live stores, G3 namespace/RPC/schema/RLS, A2 and G5 activation remain unchanged. No future reset participant was registered and no participant execution seam is shipped; cleanup wording covers only the existing static local record list. Future owner/generation-partitioned stores need an independently reviewed cleanup participant/receipt contract.

## Exact synthetic acceptance map

The design labels are coverage categories, not a count of independent browser checks. Multiple parameterized cases cover a category; counts must be reported from the executed command.

| Category | Shipping/source coverage |
| --- | --- |
| O01 | boundary shared preparation order/dedup; existing AuthGate/root handler suites |
| O02 | queued A→B→A boundary and old response; reset epoch boundary cases |
| O03 | missing binding, durable ambiguity, corrupt fence fast paths |
| O04 | shipped AuthGate same-owner subtree/lease retention and changed-readiness revocation |
| O05 | shipped fresh auth error/no-user preserves source; explicit SIGNED_OUT cleanup remains |
| O06 | unowned/conflicting stamps, invalid prepared ownership, corrupt controls and stale other-owner base |
| O07 | blocked ownership survives logout/login and ABA |
| O08 | verified exact-cache narrow cleanup; pending/unknown held owner; contradictory completed receipt |
| O09 | owner cleanup rollback and irreversible epoch fence; shared transaction regression suite |
| O10 | all no-ack bootstrap branches, malformed baseline strict parser |
| O11 | locks absent, v1 journal, corrupt shared protocol/readiness, language-only corruption |
| S01 | coherent before-image projection; pending snapshot cannot dispatch/mint writes |
| S02 | participating ABA advances generation and invalidates dispatch |
| S03 | missing vs null/root/encoding errors; raw base whitespace exact comparison |
| S04 | local/remote marker missing, null, invalid types/shapes, unavailable storage |
| S05 | queued participating changes and immediate post-guard invalidation suppress send |
| S06 | actual coordinator auth/GET/PATCH/readback assert lock inactive; existing sync-transform refusal |
| S07 | current unknown remote fields retained; opaque inner malformed strings; no metadata upload |
| S08 | historical missing-row block vs empty first creation |
| A01 | newer replacement survives acknowledgement |
| A02 | newer exact deletion survives changed response |
| A03 | unrelated keys and JSON whitespace/order retained |
| A04 | same-content ack rotation retires competing response |
| A05 | equivalent parsed but different raw base rejects old response |
| A06 | each nonmarker selected-key set/removal, base/ack/binding/commit-stage failures; rollback failure preserves journal; reset covers marker failure |
| A07 | durable commit then owner invalidation suppresses return/publication; post-commit pending resample |
| A08 | local marker changes reject old baseline retirement |
| A09 | own ack event does not loop; independent refresh during GET survives; final publication sees queued local edit |
| R01 | durable fence before RPC; failures make no RPC call |
| R02 | reset owner ABA across outer lock/auth/RPC/post-auth/local commit |
| R03 | before-send suppression, after-send uncertainty and no late acknowledgement |
| R04 | newer remote reset clears old records, retains settings; ties/local-ahead/disappearance block |
| R05 | wrong receipt app/owner/request marker and read errors cannot clear records |
| R06 | each local cleanup failure restores records/marker/base/ack; receipt retry; settings/other apps preserved |
| R07 | notification/session receipt failure then same-ID retry preserves newer records |
| R08 | unknown outcome keeps fence after DOM flag clears; reload panel keeps ID and does not submit |
| R09 | different later remote marker forbids old-ID RPC; legacy equal marker cleanup remains unconfirmed |
| R10 | shipped cross-tab reset/owner event immediately invalidates before auth; storage clear included |
| R11 | shipped hidden/pagehide/unmount/pageshow and deferred operation retirement |
| R12 | deferred old auth/response cannot win; paused editor retained; cold failure gated; reset remount separate |
| R13 | shipped calendar pending-network invalidation and preferences cache invalidation |
| R14 | shipped progress reader suppresses confusingKana but preserves bytes and normal wrongKanaChars |
| R15 | Not applicable: optional future participant seam not implemented; no participant cleanup completion claimed |
| N01 | executable negative: raw ABA leaves generation unchanged and can pass dispatch guard |
| N02 | executable negative: reused remote timestamp permits competing-content overwrite; no exact-content CAS claim |
| N03 | copied/JSON lease/request and A2 freshness cannot confer authority |
| N04 | production import/key/RPC exclusion checks; no A2/G5/G3 activation |

Test files: `app/data/languageStorageBoundary.test.ts`, `app/data/languageCloudSync.test.ts`, `tests/auth-storage-lifecycle-ui.test.ts`, `tests/language-sync-lifecycle-ui.test.ts`, `tests/language-guarded-readers-ui.test.ts`, `tests/language-reset-lifecycle.test.ts`, `tests/language-reset-ui.test.ts`, and existing shared storage/reset regression suites. They use shipped handlers, a synthetic SDK transport and serialized synthetic locks. They do not establish real Web Locks, multi-tab/BFCache/IME behavior, RLS, hosted SQL or private-account data outcomes.

## Verification boundary

The implementation worker used installed Node/TypeScript/ESLint binaries only. Focused adapter+boundary command (2026-10-09):

`node --experimental-strip-types --test app/data/languageCloudSync.test.ts app/data/languageStorageBoundary.test.ts`

Result: 76/76 passed at that checkpoint. Reset worker focused command:

`node --experimental-strip-types --test tests/language-reset-lifecycle.test.ts tests/language-reset-ui.test.ts tests/remaining-storage-lifecycle.test.ts`

Result: 107/107 passed at its source-freeze checkpoint. These counts overlap later aggregate commands; they must not be added to an aggregate total. Final combined focused/type/lint and parent aggregate/build results are recorded separately after source freeze.

Not run here: browser, private records, real auth/provider calls, network endpoints, hosted/multi-connection/RLS, schema migration, old-client retirement, publication, merge or deployment. Browser acceptance remains a separate permitted run: settings/lesson/review, two tabs, reload/back, BFCache/visibility, 320px, IME and storage quota/availability. Browser-denial boundaries were not bypassed.

## Remaining limits

A raw writer can race a lock, fail to advance generation, write A→B→A, partially complete an action or repopulate after reset. A wrapper or polling cannot certify raw-writer quiescence. Complete writer migration and old-client policy are still required before namespace-wide claims.

The current language `updated_at` CAS is weaker than exact expected-content/server-revision CAS. Timestamps are client supplied and may collide/repeat. Readback detects some mismatches but cannot undo an already overwritten competitor. Abort cannot recall an already dispatched request. Local reset receipts are not an immutable server generation ledger. Warm offline continuity cannot know an unseen server reset. These remain explicit later protocol and acceptance gates.

### Implementation-worker final checkpoint

After both implementation slices stopped editing and the preference cache unsubscribe regression was added, the combined focused command below passed **288/288** (0 failed/skipped):

`node --experimental-strip-types --test app/data/storageTransaction.test.ts app/data/cloudSync.authLifecycle.test.ts app/data/japaneseLearningStorage.test.ts app/data/languageCloudSync.test.ts app/data/languageStorageBoundary.test.ts tests/auth-storage-lifecycle-ui.test.ts tests/language-sync-lifecycle-ui.test.ts tests/language-guarded-readers-ui.test.ts tests/language-reset-lifecycle.test.ts tests/language-reset-ui.test.ts tests/remaining-storage-lifecycle.test.ts`

`node node_modules/typescript/bin/tsc --noEmit --incremental false` passed with no diagnostics. Targeted installed ESLint on all 26 changed/new TypeScript source/test/helper files passed with no diagnostics. `git diff --check` passed. No whole-repository test aggregate or build was run by this worker; the parent owns those checks. Shipped auth/lifecycle/guarded-reader subset is 52/52 (18 + 23 + 11), overlapping the 288, not additional. The N02 SDK-mock case uses the shipped component transport to demonstrate the timestamp-collision limitation; its accepted overwrite is expected negative evidence, not a safety pass.

### Parent aggregate checkpoint

2026-10-09 23:37 UTC, unchanged production freeze on local parent `2a8e96a09bdd59df8de857a4b4355bac476a812b`:

- Full installed test runner: **2,293/2,293 passed**, zero failed/cancelled/skipped.
- Shipping shared-sync handler diagnostic: **49/49 passed**.
- Full nonincremental TypeScript, whole-repository ESLint and Next production build: all exit 0.
- Existing early-app Playwright selection: **278 cases in 19 files discovered only**. No browser was launched or acceptance claimed.
- Independent review found no remaining blocking defect in the bounded participating-client scope and verified unchanged production hashes.

The first aggregate exposed 21 old VM-loader failures and 48 handler-loader failures for the new real boundary dependency. Three loader allowlists were extended to load the actual module, without stubs or weakened assertions. The full chain above was rerun afterward; earlier failing results are preserved as superseded diagnostic evidence. Focused counts overlap this aggregate.

Evidence is preserved locally in `eleventh-revised-*` logs and the independent review. Publication is still pending explicit repository/branch upload approval. No main merge, hosted migration, production deployment or new browser result occurred.

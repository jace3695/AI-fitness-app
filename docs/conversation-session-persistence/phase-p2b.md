# G5 P2-B: registered device-local conversation/reset integration

Date: 2026-10-10 UTC. Predecessor: local `070bfb2147282fba20c5e247dcc28a38b9776040`, tree `f249917174fb2b5e35432c6da850718f56eff4ef`.

## Scope and gate

This phase integrates the bounded pure conversation model with the existing authenticated language coordinator and single-store transaction. The conversation page is unchanged. There is no production importer of the conversation facade, no automatic session/store enrollment, no UI persistence activation, no A2 activation, no assessment authority, no provider/audio work, and no new dependency, hosted resource, SQL, account access or publication. The production assessment registry remains empty and the five original scripts remain unlevelled.

The static participant is active in language reset/sync handling so that future local conversation bytes cannot escape the reset boundary. An absent owner partition remains absent on ordinary observation, remote reset and explicit reset. Only a future explicit new-session command enrolls it. P2-C UI and authorized real-browser validation are separate gates; this phase does not establish browser durability, performance, multi-tab IME behavior, authenticated real-data behavior or release acceptance.

## Bounded architecture and public seam

- `app/data/languageLocalParticipants.ts` is the fixed singleton. `conversationLocalKey(ownerId)` is the only owner-key factory. The namespace is `yeoni-conversation-local-v1:` plus an encoded exact owner ID. There is no prefix enumeration, runtime registry, generic journal, arbitrary cleanup key, async participant, nested lock or cross-owner cleanup.
- `app/data/languageCloudSync.ts` keeps registered requests, observation receipts, contexts and snapshots in private WeakMaps/WeakSets. Its single `languageConversationCapability` accepts registered contexts/sources, reads only that owner's canonical envelope and writes only that same exact key. A callback cannot replace an established enrollment/generation or change its marker/owner. This capability has one reviewed facade importer.
- `app/data/conversationLocalRecords.ts` exposes registered reads; captured session/draft/append/close/cancel/delete commands; original-intent stage/apply; read-first operation/edit reconciliation. Handles are frozen and runtime-registered. Copying their fields, a pure envelope, a receipt-shaped object, an observation or a session CAS token does not restore authority.
- Session creation, draft saves, cancellation and deletion use immutable captured edit commands. Append/close have distinct original stage/apply attempts. New cancellation under a current snapshot cannot rebind or redispatch the old intent. A close cancellation preserves existing drafts and creates neither a learner draft nor a close boundary.

Captured IDs, payloads and timestamps are allocated before asynchronous writes. All transformations run against fresh locked coherent bytes through the existing `updateStorageBatchWithReceipt`; no raw setItem fallback exists.

## Observation provenance

The reviewed coordinator captures a receipt immediately when a successful authenticated remote read/readback is received, after lifecycle checks and before local-lock work. Its registration binds exact request object, owner epoch, lifecycle, marker and received wire. The timestamp is generated on that receive path, never by minting a record context or saving/closing a conversation. Direct legacy commit-helper calls without a registered observation cannot access the conversation facade.

An observation means **the last authenticated remote observation received by this client**. It is not a signed server timestamp or evidence that no later reset occurred. Client time is not reset order. Local saves, coherent rereads, close and a delayed lock do not advance it. A close freezes the original observation; a later current viewing snapshot may carry a newer observation without rewriting historical provenance.

## Canonical enrollment and cleanup receipts

The P2-A strict envelope gains a small enrollment union. The original explicit-enrollment encoding remains valid for inactive pure fixtures, but the production participant requires its matching owner/marker observation. The reset-replacement variant contains exact owner/new generation, previous generation and marker, new marker including request UUID, cleanup identity/time and explicit-reset/remote-reset/observation-catch-up reason. Remote/catch-up variants require matching observation data. All fields remain inside the original per-owner budget, with no exempt receipt store.

Both explicit `completeLanguageReset` and authenticated `commitLanguageRemoteReset` compose participant changes into the same existing atomic journal transaction as marker, base, acknowledgement, fence and the original twelve legacy record keys. Ordinary successful authenticated observations perform the same catch-up check when an older client has advanced the legacy marker without retiring the local conversation generation.

A provably older valid partition is replaced from exact lock-time bytes; pre-RPC bytes are never used as its cleanup after-image. A same-marker completed receipt or valid causal post-marker enrollment is preserved, including new sessions. A same-marker missing/invalid receipt never authorizes another sweep. Equal-time different-UUID markers conflict. Old reset requests cannot replay after a newer marker. Absent data stays absent.

Known corrupt/unsupported/noncanonical data blocks before language network reads/updates, and fresh locked validation repeats before local commit. If corruption appears after a network request, local commit remains blocked and the coordinator reports uncertainty/blocking rather than claiming reset completion. Opaque bytes and recovery journals remain untouched; this is not an automatic repair design. Existing selected legacy records are not partially committed around a bad participant.

Conversation-only catch-up exposes separate `conversationReset` metadata. It does not set the legacy reset flag and does not remount unrelated dirty language editors. Actual remote language reset retains the original editor-generation remount behavior.

## Outcomes and recovery

Durable committed after-image, current acknowledgement, proven no-commit and unknown outcome stay separate. Owner/lifecycle revocation or notification failure can leave durable bytes with `acknowledged: false` and no current source. Coalesced callers recheck authority before returning acknowledgement. A cached completed edit result is historical evidence, not renewed acknowledgement.

Stage/apply inspect the same operation terminal state under the lock; old stage cannot revive cancelled/applied work. One pending slot and pinned append draft remain enforced by the pure reducer. Logical admission retains terminal completion/cancellation and deletion headroom, including two-lane recovery and metadata-only exhaustion.

Unknown edit results are reconciled read-only by their private immutable expected identities: exact session postcondition for create/draft, exact resolution/operation receipt for cancellation and exact tombstone for deletion. Matching text alone is insufficient. Newer divergent sessions can leave conservative reconciliation unresolved. Absence is never proof of no commit, and successful observation does not reset the original unknown attempt into a writable intent.

Explicit reset notification failure carries fixed committed-completion evidence while suppressing success acknowledgement. A matching completed fence/participant receipt is recognized on read-first retry and preserves new records. Neither notification failure nor a post-marker host exception causes a pending/uncertain fence to overwrite proven completion.

## Privacy and limits

The exact sixteen selected language keys and twelve legacy reset keys are unchanged. Conversation keys, drafts, transcript text, command payloads, local receipts and prepared-journal bytes do not enter cloud/provider requests, fitness backup exports, analytics, logs, diagnostic metadata, URLs or user-facing errors. Unknown fields already received from the language server continue to be preserved; that compatibility rule does not introduce local participant fields.

New facade/parser/participant diagnostics use fixed codes with no original host error, payload or receipt attachment. Coordinator and language reset messages redact untrusted SDK/storage exception text. Storage events inherently contain old/new values within the origin; application listeners still consume only key/storage area and never copy, forward or log those values.

The 262,144 limit is UTF-16 code units per owner envelope, not bytes or an origin quota. The journal temporarily duplicates bytes; other owner partitions and other app data consume additional storage. No origin-wide quota reservation, silent eviction, receipt pruning, automatic language reset or fallback store is added. Device-local records are not encrypted, isolated from same-origin scripts, permanently retained, cloud-synced or backed up.

## Verification

All tests use synthetic owners, SDK transports, browser/storage fixtures and poison strings. The actual shipping coordinator/component is exercised with a genuine fluent SDK mock and per-tab runtime identities. The test-only VM loader executes the installed Zod CJS validator inside each tab realm instead of stubbing validation or accepting cross-realm forged prototypes.

Focused verification includes:
- Exact owner key/namespace; registered/copy-rejection authority; original intent and same-owner/owner-ABA fences.
- Stage/apply/cancel/delete races, two draft lanes, erased drafts, terminal late replay, immutable close provenance.
- Prepared, replacement, durable-marker, rollback and unknown-outcome failures; unknown create/draft/cancel/delete reconciliation; current acknowledgement versus committed after-image.
- Explicit reset and remote reset atomic before-images, every legacy cleanup point, participant failures, notification/session publication failure, completed retry, fresh lock-time generation, absent partition and old-request rejection.
- Ordinary catch-up without editor remount, corruption/unsupported/duplicate/noncanonical preservation, and zero-network known-corruption preflight.
- Exact logical capacity ceiling for integrated apply/cancel/delete plus enrollment/receipt budget accounting.
- Privacy canaries in transcript, draft, staged/receipt-associated text, corrupt bytes and prepared journal, across ordinary/backup/rollback/unknown projections; unknown server fields remain intact.
- Shipping SDK receive/readback provenance, lifecycle cancellation and strict request/wire binding. Read timestamps are not minted at local commit/close.
- Existing closure scanning plus narrow P2-B importer admission and negative namespace/reexport/dynamic/computed capability fixtures. No external capability fingerprint was bulk refreshed.

Worker verification on the frozen checkpoint: **292/292 focused tests passed**, full nonincremental TypeScript passed, focused ESLint passed, and `git diff --check` passed. The focused set contains all new integration/facade/privacy/enrollment tests plus affected pure-model, legacy sync/reset, shipping SDK lifecycle and closure regressions. Root owns the full repository aggregate, sync-handler checks, build and local commit. Real-browser verification remains blocked by the previously recorded browser launch denial; no alternate route was attempted and no authenticated store was instantiated for a person.

### Accepted local checkpoint

2026-10-10 01:19 UTC: independent review passed 292/292 focused tests and 9/9 external adversarial probes, with all 18 checkpoint hashes verified. Parent final aggregate passed **2,731/2,731 tests**, zero failed/cancelled/skipped; shared-sync handler diagnostic **49/49**; full nonincremental TypeScript, whole-repository ESLint and Next production build all exit 0. Focused counts overlap the aggregate. Local `fourteenth-*` logs preserve the results. P2-C is not implemented at this checkpoint. No browser ran, no real user store was instantiated, no hosted resource changed, and publication remains pending.

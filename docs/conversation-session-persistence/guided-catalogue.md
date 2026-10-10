# Complete authored guided catalogue: bounded integration

Date: 2026-10-10 UTC. Implementation baseline: `e073621aee74e2ae62e3212a1cf8d5959d8251dd`.

## Scope and truthful completion level

The local implementation now exposes exactly 24 authored situation × level cells: the unchanged three convenience-store pilot scripts plus 21 newly registered scripts across restaurant, hotel, train and four company contexts. They contain 64 learner steps (8 retained + 56 added). The original five unlevelled legacy examples remain separate.

These are fixed-response, text-only practices. Any nonblank explicit submission advances one authored step only when its append is applied. Equality with the saved Japanese example or kana is a string fact, never a correctness judgment. A nonmatching input retains its exact text and receives the fixed reply plus reference example. Final submission never closes automatically. Native-speaker/professional review, calibrated proficiency levels, semantic assessment, corrections, mastery, ASR, TTS and runtime conversation providers remain unavailable or unperformed.

This document records focused local implementation verification. Independent implementation acceptance, full aggregate gates and authorized real-browser acceptance are separate. Discovery is not a browser run. Prior guided WebKit failures remain open until separately authorized execution establishes their outcome. No release, deployment, account work, network service, provider, server/browser launch, dependency change, commit or push was part of this integration task.

## Immutable identity and compatibility

`data/guidedConversationCatalog.ts` holds the accepted content unchanged, deeply frozen retained registrations, and separate explicit current `(contextId, levelId, scriptId, scriptRevision)` pointers. Lookup never chooses a first/latest revision or substitutes another level or legacy source. There is no mutable registration API or runtime hashing. The only runtime dependency is the frozen pilot data; context/level types erase at compilation.

| Identity | Three retained pilot scripts | Twenty-one new scripts |
| --- | --- | --- |
| Envelope | Existing strict mixed v2 | Existing strict mixed v2 |
| Source / emission version | 1 / 1 | 1 / 1 |
| Catalogue | `free-conversation-catalog-v2` | `free-conversation-catalog-v3` |
| Response policy | `guided-fixed-exchange-v1` | `guided-fixed-exchange-v2` |
| Source module | `data/guidedConversationPilot.ts` | `data/guidedConversationCatalog.ts` |
| Export | `GUIDED_CONVERSATION_PILOT` | `GUIDED_CONVERSATION_REMAINING` |
| Counterpart label | 점원 | 상대방 |

The match, progression and recap policies are unchanged. Legacy sources retain `free-conversation-catalog-v1`. Pilot content, wrapper metadata and complete historical emissions remain byte-identical. The new policy changes only the counterpart word in the fixed explanation; fresh construction and historical replay use the same exact supported-source dispatch. Unknown policies cannot build an authoritative turn. Stored explanation comparison is not weakened.

The strict old pilot-shaped schema stays separate from the additive new module/export/context schema. Original pilot hashes remain globally pinned. Newly introduced hashes are pinned only inside their new namespace: an old pilot-shaped unknown revision whose opaque string equals one of the new hashes remains readable and unsupported exactly as before. That exception never grants support or write authority.

Old-client limits are material:

| Predecessor reading an envelope with new sources | Parser result | Unchanged shipping participant result |
| --- | --- | --- |
| Strict legacy-v1 client | `unsupported-schema` | `unsupported-partition` |
| Pilot-v2 client at the baseline | `invalid-envelope` | `invalid-partition` |

Both block broader language sync reads and reset planning, preserving the raw partition. This is fail-closed behavior, not downgrade compatibility or mixed-version rollout safety. No stripping, auto-reset, migration authority or normalized fallback was introduced. Existing v1 upgrades to v2 only through a successful explicit guided-session creation after-image; preview remains read-only.

## State, privacy and capacity boundaries

Reducer, facade, hook, recap projection, participant, storage, sync and reset algorithms were not changed. Draft identity remains tied to exact script/revision/step. Two persistent lanes, sticky pre-answer exposure, stale-selection/owner/generation fences, explicit partial/zero/full close and read-first terminal reconciliation remain intact. Changing the selector never relabels an existing session. Preview labels use the selected registration; active/history labels use the frozen source.

The envelope cap remains 262,144 UTF-16 units, with the existing session, input, turn, operation and tombstone caps. The largest new canonical script is mechanical-design/intermediate (3,809 units). Tests size actual complete envelopes, pending apply/cancel growth and the single initial-close reserve, including escaped metadata and prior sizing-ID collision. A cancelled close spends that reserve. Twenty-four selectable scripts do not promise twenty-four simultaneously populated sessions or browser physical quota.

Conversation inputs/source metadata remain excluded from generic backup/export, server sync payloads, notices, diagnostics and provider requests. The paid-page implementation, original diagnostics and all prior E2E bodies are preserved except the obsolete coverage sentence.

## Focused verification on implementation bytes

Counts below describe distinct commands, not a summed aggregate result. All had zero failures/skips unless otherwise specified.

- Existing catalogue/pilot/contracts/guided/legacy compatibility tests: 68/68 passed.
- New content/model suites: 113/113 passed. Covers 21 digests and source schemas; 24 explicit pointers; every new step with Japanese/kana/normalized/arbitrary/punctuation/Korean/combining/maximum/blank input branches; canonical saved, pending, applied and cancelled states; every zero-through-full close prefix and factual recap; malformed sources/emissions; largest-source capacity, lanes and reserves.
- New predecessor compatibility suite: 37/37 passed. Pins both comparator files and all five independently captured legacy wrapper strings/constants; compares original builders and pilot step/history bytes; tests all 21 old-shape hash collisions; exercises exact old parser/participant/sync/reset failure mappings and untouched raw bytes.
- Registered facade suite before final boundary additions: 123/123 passed, including all 21 full isolated journeys and 77 independently closed prefixes. Thirteen additional disjoint capacity/lost-ack cases subsequently passed in their focused selection. The parent aggregate gate must run the complete final file.
- Reset integration: 67/67 passed. Mixed legacy/pilot/new pending history, owner isolation, rollback, explicit reset/catch-up and v2 retention included.
- Privacy: 47/47 passed. All 21 new sources traverse actual hook/facade paths; seven new-context uncertain-write cases preserve canary exclusion.
- Shipping-page synthetic UI: 38/38 passed. All 24 exact preview selections preserve absent storage and existing v1 bytes; three full representative new journeys, all company labels, cross-context same-level races and original-source reopen are included. Existing IME/exposure/lane/owner regression tests remain.
- Unmodified model/import/writer closure guards: 19/19 passed; no allowance expansion.
- Installed local TypeScript compiler: `node node_modules/typescript/bin/tsc --noEmit --incremental false`, exit 0.
- Scoped installed ESLint for core production/tests and four UI-owned files: exit 0. `git diff --check`: exit 0.
- Discovery-only through the installed Playwright CLI and required disposable-loopback configuration: 290 early-app case identities. The complete original 284 project/name identities remain; exactly six were added (restaurant/beginner, train/elementary and mechanical-design/intermediate in Chromium and WebKit-small). No test skip/retry/timeout/workflow/project change was introduced.

Required remaining gates at this task freeze: independent exact-source review; full `npm test`; `node scripts/qa-pr189-sync.mjs`; final nonincremental whole-tree typecheck; whole-tree lint; production build; final diff check; separately authorized real-browser journeys, reload/navigation/320px checks and resolution of any baseline failures. This task does not claim these remaining gates passed.

## Protected byte pins

| Source | SHA-256 |
| --- | --- |
| Accepted 21-script input | `331d74183bc7565b14cc8ea27dcba5b7a025129a11a7a027e858df449430292d` |
| Reviewed integration plan | `d7c9e5c3f53cc770c7efda734ff13658b60a3cf7c44bb3065a6319d5d4139d89` |
| Original legacy data | `b92edd91c70d93da57f767c30405fd013460fd98216447854212b6e7bc7483be` |
| Original pilot data | `ea2754df48ec63198f717fc4b70cd715532c16e5fb31183bb57a9f72e228a1b1` |
| Strict-v1 comparator | `7b6da2573ae21037409d3e110eeddaf954f8606eab22bb3ed2cbd4bbf56709db` |
| Byte-exact baseline pilot-v2 comparator | `00eeee45d0386458870e0d12e23af91739dbeeaa80306e4d274368933dc59619` |
| Unchanged paid-page function remainder | `87e799076a2a4f7a4356b7fe74c11225f2317f04bb6e6f3177e142b23c6d5aec` |

## Accepted new content revisions

Each integrated canonical body matches the reviewed complete object excluding only `scriptRevision`. No content field, order, review flag or text was edited during integration.

| Script | Steps | Revision |
| --- | --- | --- |
| `guided-restaurant-beginner` | 2 | `sha256:f536c29078f567a5cc5dde12754c4e8cd406197b4daf91ff4881536fd6a0c9d3` |
| `guided-restaurant-elementary` | 3 | `sha256:ad272787da4fac2df9f60d19d71c665d641dc9ec51073a137dd2ece1796c5179` |
| `guided-restaurant-intermediate` | 3 | `sha256:727bd90a1981f853c2d0b2a7b4e6fc8d4a1f8cd9e2088ade9a0aa410d65d636a` |
| `guided-hotel-beginner` | 2 | `sha256:b75b4811dad73bfffdf8056a0667f95f8972a0565967eff27c4841f991ee0d02` |
| `guided-hotel-elementary` | 3 | `sha256:852ff666451fda9ca741a2c67753e9b72867fd3b1b1e2ca9bf9653b77e96e0cd` |
| `guided-hotel-intermediate` | 3 | `sha256:9ad1fdd0c5da4bb905f729d7629bacec264a4e7d4bc04946caec83eb8aaeea63` |
| `guided-train-beginner` | 2 | `sha256:19f448ba6fa10f54e1f579e55a7541fc98d94505eb9fbbc3261a41fc8c50753e` |
| `guided-train-elementary` | 3 | `sha256:ab4d4a40900eb5c232d2a3090843dbe198f8113854248349940c7f791d15c085` |
| `guided-train-intermediate` | 3 | `sha256:d5178b284e4d0d1d89a56be77a34e71923916b6a2dcf866e976f115a6bce11a5` |
| `guided-company-general-beginner` | 2 | `sha256:fe229227b1667f00beb7c603067db8239f2bb3eefa3ec28df04957096ba3eae6` |
| `guided-company-general-elementary` | 3 | `sha256:461090c88ad4e775fa5f99462fb3b636c0931159dfaa67ab0d3dbbe19ecf841d` |
| `guided-company-general-intermediate` | 3 | `sha256:93b0f940f4a1de380b6146dac0852411e886767fa9809eea2f24b6737b7d81bb` |
| `guided-company-mechanical-design-beginner` | 2 | `sha256:0e291a53f3ef71f6ef77c0eb37d45dac7ca1f5e28560e3be4ef1dffe28ca184f` |
| `guided-company-mechanical-design-elementary` | 3 | `sha256:124209ba5e67d5628324a3a453245a0e493e8e6a5a20d41374121416e670324c` |
| `guided-company-mechanical-design-intermediate` | 3 | `sha256:e7122f518361da4322d717ce5f3873c1cd67a51a44a1b824a136a54b0ca47afa` |
| `guided-company-development-beginner` | 2 | `sha256:077fe1b205adf6527f62448bb2fcdcb09c12c006e51df4993fd585246e73e09d` |
| `guided-company-development-elementary` | 3 | `sha256:fe529450660ac9feb889f086ba71dabd7c5660cdd7de488d7fc2883e5f552249` |
| `guided-company-development-intermediate` | 3 | `sha256:6a8c204a6396d1d8f3018f213d878227590d96251910fa2b09ea38ea532c9264` |
| `guided-company-quality-beginner` | 2 | `sha256:1b28ee02e6b75c2270ef92e79ec301e1f5210d3724396e9d47fc52bb0a0a3de8` |
| `guided-company-quality-elementary` | 3 | `sha256:5072ae7dcd99bfec4209b8424ee58a55d76338099deec57b7e8375be6d143dad` |
| `guided-company-quality-intermediate` | 3 | `sha256:525fe4c01d580121d882fb7d5414d97b0f0bad11a00f6f536b8347d80734482f` |

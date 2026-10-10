# Local free conversation and inactive marker diagnostics

Checkpoint: 2026-10-09 22:58 UTC / 2026-10-10 KST, based on `02c670aaa70aee6e3843e9b53efab388943413c6`. Local implementation only.

## G5 bounded foundation

The existing conversation page now computes FREE_MODE responses locally before authenticated headers or fetch. It preserves the draft/history if construction fails, suppresses repeated sends from the same render, and explicitly labels fixed examples as unassessed. The original five examples, API response, provider gate and authored-example audio controls remain unchanged. The revised free-first browser definition asserts no conversation POST for sample and arbitrary input; it has not executed.

`data/freeConversationCatalog.ts` models 24 requested context/level cells truthfully: 21 reference-only and three not-authored, with zero authored levelled scripts. It preserves the five unlevelled legacy examples and versioned sample-match provenance. This is not completed scenario coverage or new teaching content.

The pure `lib/conversation-review/` contracts validate exact owner/generation/session/turn/request/source/receipt/input/span identities, replay and conflicting evidence, and source-bound recurrence/recap coverage. The production source registry is empty. Fixture adapters are test-only; caller flags, cloned records and serialized trusted claims cannot activate assessment. An in-memory identity handle is not cryptographic or durable receipt authentication.

No production correction ingestion, personal-review UI, persistence, reset integration, course/Live/A2 progress change or new provider transmission was added. Empty corrections, string equality and sample insertion never prove natural language use or absence of mistakes. Future persistence/source integration must establish the currently declared owner/save boundaries rather than trust caller metadata.

## G8 inactive diagnostics

The new pure marker classifier and exactly-three-key/two-sample adapter remain unimported by the application. Output is closed metadata codes only; quiescence is always unverified and repair/resume permissions are always none. Descriptor-only normalization prevents getter-based size bypass or private exception leakage. No raw record, owner identity, key name from journals or secret is returned.

There is no diagnostic UI, pre-auth shell, forensic export, repair, migration or writer startup change. Equal marker samples do not establish old-writer quiescence. See [G8 scope](storage-marker-diagnostic-g8.md) for the separate entry-isolation, preservation and operator gates.

## Final frozen-source verification

- Repository tests: **2,121/2,121**, no failures, cancellations or skips.
- Shipping sync-handler QA: **49/49**.
- Full nonincremental TypeScript, whole-repository ESLint and production build: all passed using installed Node CLI binaries without package fetching.
- G5 focused: **50/50**, plus independent adversarial probes and hash-pinned review.
- G8 focused: **20** new diagnostic tests, **49** existing storage/auth regressions, and **10** independent adversarial probes; all passed. Counts overlap the aggregate.
- Early browser discovery: **278 cases in 19 files**. Discovery is not execution.

Review found and fixed draft loss on local-builder failure, sample-policy drift, and unsafe marker-input getters before this final chain. No dependency change was made. The earlier npm-script invocation was interrupted over registry access; it is not claimed as a successful aggregate.

## Release limits

Publication remains paused for the explicit development-branch upload approval. Remote development `d4382f8` and main `62c2141` were reverified unchanged at 22:41 UTC. Local commits do not establish deployment. Actual new browser/device/owner-switch acceptance, hosted changes and production rollout remain unrun; the last actual early-browser result remains `a6624c0` (120/8), and later `d4382f8` stopped before browser execution.

G4 persistence/capture/server integration, full G5 correction/content coverage, safe G8 transition, independent-analysis integration and other documented gates remain open. This checkpoint is not all-roadmap completion or release readiness. Four old untracked reader lifecycle artifacts are excluded.

# G4 A2.1 — inactive authenticated repository roundtrip

Source implementation, 2026-10-10 UTC. Based on local HEAD `67c1bd996aadec90ffee44dd7e69c4fc56280a1e`; the changes described here are a separate uncommitted review candidate. This is not G4 product completion, learner-capture activation, a hosted migration, shipping reset acceptance, or a real-browser/database-concurrency pass.

## Implemented boundary

The demonstration executes the existing `LocalEvidenceStore`, the new registered repository, the actual checked-in SQL public wrappers, independent readback, and the existing A1 projector. It does not replace the server with a JavaScript receipt generator.

1. The normal language coordinator captures its authenticated remote observation and produces the existing registered `LanguageRecordContext`.
2. One new read/guard-only capability in `languageCloudSync.ts` accepts that exact context and requires its private coordinator observation. Raw local response commitments, copied contexts and serialized objects are insufficient. The capability exposes no owner lease, storage object, generic writer or conversation authority.
3. `acquireLanguageLegacyEvidenceRepository()` uses the existing application Supabase singleton and fresh `getUser()` before each fixed RPC. It validates the strict server context and immutable manifest. Production accepts no injected transport, generation, clock or trust constructor.
4. A private runtime cancellation serial fences the existing local store. It is not derived from the opaque storage-owner epoch. Every asynchronous boundary checks the registered authority; terminal authentication/generation failures retire it.
5. Actual prospective catalogue identities (`f01:2` in the core demonstration) are committed atomically to local checkpoints/events/outbox. The compatibility answer remains local in the original checkpoint/journal handoff.
6. Delivery independently reads exact IDs before every initial write or retry. Only a complete returned/missing partition may establish absence. SQL append results never acknowledge local delivery. After append, including a deliberately lost committed response, a new exact read must verify canonical bytes, recomputed SHA-256, receipt metadata and context before a runtime-registered proof reaches the store.
7. A complete prefix must contain exactly sequences 1 through captured H. It uses bounded keyset pages and a noninitializing final context read. Later H advancement is allowed; generation, marker, start, timezone or protocol changes are not. The repository maps only the strict five A1 receipt fields and five projection-context fields into A1.

There is no dedicated source-slot reconstruction API and no reconstruction of a missing original draft/checkpoint. Exact-batch readback and verified prefix reading do not authorize replaying a legacy callback into a missing or different source row.

There is no production importer of the new repository. Capture UI, learning selection/grading, review scheduling, Live/provider/audio paths, assistant consumers, shipping reset handlers and reset fence source remain unchanged. Source-closure tests constrain the sole bridge consumer and proof producer/consumer, including aliases, reexports, namespace/dynamic/computed routes and test-only loader imports.

## Additive SQL and fixed manifest

Migration: `supabase/migrations/20261010025109_language_legacy_evidence_ledger.sql`.

Protocol: `legacy-evidence-server-v1`.

Release: `legacy-curriculum-identity-v1`.

Manifest SHA-256: `139c003cd7b99e71a62dae22bd49d63524329c292bea6f953a9d1811a4045c0c`.

The deterministic generator (`scripts/generate-legacy-evidence-manifest.mjs`) uses the real 496 authored task descriptors across 62 lessons. It contains identity/source/format/grading metadata, not prompts or raw answers. It creates neither capture-visibility evidence nor a same-item listening/typing pair. The current release rejects `item_practice`.

The migration adds manifest/task, generation and immutable-event tables with explicit privileges/RLS; authenticated clients have only five invoker RPC wrappers plus the required independently checked private entry-point calls. Separate non-login, non-table-owning, non-BYPASSRLS roles own the evidence entries and marker trigger. New-table application/service-role defaults are explicitly revoked. Event updates are unavailable even to the append executor. The executor's existing-language `UPDATE(updated_at)` grant is solely the reviewed prerequisite for row-locking SELECT; no evidence function writes the legacy state or timestamp.

Initialization/append take owner advisory lock → language row → generation. The marker-change trigger already holds the language row and never takes that advisory lock. Generation counters are transactional, so replay and rolled-back writes do not create sequence gaps. Reads assemble context, records and page boundaries in one statement snapshot. Function-local statement timeouts are not asserted to replace a top-level caller timer; the authored real-Postgres driver sets session timers before dispatch.

### Reviewed R4 reset-role correction

Exact-owner RLS alone cannot distinguish an absent generation from a generation hidden by a null/foreign `auth.uid()`. The accepted source correction gives only the reset trigger role `SELECT(owner_id,generation_id)` and a separate unrestricted metadata SELECT policy on generations. It has no timestamp/marker/timezone/payload visibility. The trigger validates its exact table/AFTER ROW UPDATE context before an unlocked existence probe, returns for an unenrolled owner, then requires exact `auth.uid()` before locking or mutating an enrolled owner's generation. UPDATE and DELETE remain exact-owner.

There is no new client-callable helper, role membership or bypass. Existing administrative marker updates for unenrolled users are preserved; enrolled marker writes without the exact user JWT intentionally fail. Actual hosted administrative writers, table DDL and default ACLs still require separate review before any installation.

## Local persistence and offline meaning

The database name stays `yeoni-legacy-language-evidence-v1`; version 2 additively preserves its original six stores and adds `receipts`, `contexts` and `prefixes`. Existing canonical events, indexes, commit journals, checkpoints and raw compatibility handoffs remain intact. Strict versioned decoders recognize old pending/readback/quarantined metadata and the explicit v2 acknowledged form; unfamiliar/future/corrupt forms are not treated as pending success.

Acknowledgement checks the exact frozen batch, event bytes, hash and delivery-revision CAS atomically, then independently re-reads it. Identical competing acknowledgements and lost local completion recover read-first. `markReadbackRequired` cannot downgrade an acknowledged row. Acknowledged events/checkpoints remain available as exact predecessors; there is no retention/eviction policy. Restart discovery streams retained history one row/batch at a time, retains only bounded pending work and exact dependencies, and enforces the pending cap before fetching an excess event. Persisted prefix decoding shares the repository’s 10,000-event/8 MiB payload limits.

Persisted caches always report `previously_verified_offline`. A cached flag, copied proof or serialized metadata never restores fresh authority. Cold offline acquisition cannot invent a server generation or a complete-empty result. The repository's `serverContext()` is the acquisition observation, including its as-of server time; fresh completeness comes only from `readPrefix()`.

Prefix bounds are 200 rows and 256 KiB canonical payload per SQL page, with 16 KiB per event; these are canonical-payload limits rather than exact HTTP byte limits. Repository whole-read bounds are 10,000 events/8 MiB canonical payload. A resource cap returns explicit partial cursor/H/generation metadata and no completed snapshot. Structurally valid unknown historical descriptors remain in the verified raw prefix and make A1 partial instead of disappearing.

## Adapter-only reset

The demonstrated path is actual `reset_my_app_records` SQL → ordinary coordinator refresh → fresh registered context → repository acquisition with `mode: 'existing'` → noninitializing generation read → `cleanupAfterReset(exactMarker)`.

Cleanup removes stale-generation entries across all nine stores while retaining the selected current generation and other owners. Same-request reset replay preserves evidence recorded afterward. Stale-generation queues cannot be retagged or resubmitted into the new generation.

No automatic shipping reset hook, completed-reset authority bridge, activation flag or enrollment subsystem was added. Before A2.2 capture, resolve durable enrollment/loss semantics and post-reset shipping authority. An IDB-only activation record cannot distinguish an untouched installation from a lost activated database. Current mixed-version whole-language writers can still restore old aggregate bytes or roll/remove a marker, conservatively purging evidence; this rollout limitation is unchanged.

## Verification performed

Tests use existing PGlite and the deterministic IDB adapter. PGlite executes the actual new migration plus current assistant command/reset, connector and corrected language-history trigger dependencies under restricted synthetic roles. The repository test helper substitutes only the application singleton import; real coordinator, owner/context registries, proof producer/consumer, store and A1 modules share their actual source module graph.

Measured checks: the independent final source review ran 151/151 focused and adversarial tests successfully, including its two reproduced defects after fixes. The implementation run separately passed all 82 evidence-library tests and the repository scenarios; the final two added regressions passed 2/2. Full TypeScript, scoped ESLint, immutable manifest regeneration check and whitespace checks passed. Root-wide test/build gates are tracked separately against the exact candidate. Coverage includes:

- SQL: all authored bindings, strict canonical/UTF-8 hash parity, optional/null/boolean/numeric/time/source semantics, limits, immutable replay/suffix, wrong-owner and RLS/ACL denial, preserved preexisting rows/grants/policies, late failure/rollback gap-free allocation, 0/1/200/201 paging and payload continuation, raw marker transitions, reset replay/cascade, real assistant/connector effects, R4 enrolled/unenrolled null/foreign auth, malicious search paths.
- Registered runtime: raw versus coordinator-observed contexts, copied/serialized authority, same-owner epoch/lifecycle changes/logout, auth mismatch, invalidation during hashing/IDB/transport/acknowledgement, copied genuine proofs and append-output rejection.
- Real-source synthetic roundtrip: presentation → learning; supported first response → completed_once; unknown provenance → partial; committed-response loss plus lost independent read and restarted exact recovery without a second append; partially known batch; acknowledged predecessor; lost acknowledgement completion; two same-process facades' exact CAS recovery; immutable conflict quarantine; raw-answer privacy.
- Prefix/reset: malformed ID partitions/receipt fields/hashes/cursors/sequences/exhaustion, unsafe integers, final read failure, resource caps, captured H with later writes, historical-descriptor preservation, resets at start/page/final, reacquired adapter cleanup and same-request reset replay.
- IDB/source: v1 preservation, strict v2 decoding, terminal acknowledgement, fake blocked upgrade handling, cache/offline status and cleanup scope, unchanged writer closure, inactive consumers.

No assertion, retry limit or existing test was weakened to obtain a pass. The schema and transport fixture deliberately distinguish synthetic observations/authentication from production learner facts.

## Authored but unrun next gate

`scripts/qa-legacy-evidence-postgres.mjs` and `scripts/qa-legacy-evidence-http.mjs` are explicit CI-only entry points, outside `.test.ts` discovery. Their pure refusal tests and authored catalog audit run locally; the real drivers were not launched.

The race driver verifies actual GitHub-runner state, generated loopback stack configuration/status and the exact local Docker socket/container/project/image before registering its private execution capability. Fabricated/copy-shaped stack objects cannot call its process/network entry points. Two persistent psql participant processes and a third read-only observer use backend PIDs and observed `pg_blocking_pids` barriers for all nine schedules, including both corrected initialization/reset orders. It records sanitized case outcomes/digests and cleans up disposable users/sessions. The HTTP scenario signs in through real local Auth, invokes the actual public RPCs through the same repository, and exercises committed-response loss/restart/reset with fake IDB.

Neither the explicit seed list nor the workflow was changed. After independent source/security review and authorization of the exact later commit/run, the remaining CI integration is one migration seed entry and one named harness step in the existing isolated workflow, preserving its cleanup and artifact allowlist.

Still unrun: real independent PostgreSQL locking, actual local Auth/PostgREST HTTP, browser IndexedDB upgrade/durability/multi-tab scheduling, authenticated learner capture/save/reload/offline flows, device acceptance and hosted installation. Passing synthetic tests cannot close those gates. A2.2 visible capture, shared evidence views and the same-item listening/typing exercise remain separate work.

## Root final local gate — 2026-10-10 03:19 UTC

The frozen runtime/test/SQL/harness source passed 2,961/2,961 aggregate tests, 49/49 shipping synchronization checks, full non-incremental TypeScript, whole-repository ESLint and Next.js production build. All five commands exited 0. Independent focused/adversarial results overlap the aggregate and are not added to it. Real PostgreSQL two-session races, local Auth/PostgREST harness execution, browser durability and hosted installation remain unrun. This phase is not included in the earlier 36ef7cd publication or its currently running CI.

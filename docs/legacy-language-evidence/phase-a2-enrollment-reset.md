# A2.2 Gate A: inactive enrollment and reset prerequisite

## Source boundary

This slice implements only enrollment/status, shared local admission, and the existing language reset integration. It does not instrument a question, change scheduling/receipt payloads, add exposure/run metadata, expose evidence in the language or assistant UI, activate capture, install hosted SQL, or execute the real CI harness.

The existing A1/event/server-receipt schemas and catalogue/projector are unchanged. The new enrollment envelope is separate from those receipts. Existing migrations are unchanged; `20261010040739_language_legacy_evidence_enrollment.sql` is additive.

## Enrollment and continuity

The retained server witness contains exactly owner UUID, immutable first-enrollment request UUID and immutable initial-generation UUID. It survives language reset and language-row deletion/reinsertion. Only account deletion removes it. It contains no answer, progress, timestamp or device identity. Existing real generations are adopted with a server-generated nonce. A deferred generation-owner FK enforces that no current generation commits without its witness; the immutable initial-generation UUID deliberately has no FK to the rotating generation.

`read_language_legacy_evidence_status` is authenticated and noninitializing. Missing legacy state, unsupported/malformed metadata and RPC failure are errors, never evidence of non-enrollment. Its exact nullable marker assertion is optional at SQL level and mandatory for reset proofs. It distinguishes unenrolled, enrolled/current generation and enrolled/missing generation.

`enroll_language_legacy_evidence_v1` validates the expected owner, exact marker, request nonce, timezone and protocol/manifest pins. First witness and generation commit atomically. Same-request replay requires initial generation still current and every original field unchanged. Rotation/loss cannot restore an old first-enrollment context. The old initializer delegates to this invariant and cannot reconstruct a witnessed missing generation.

The shared IDB open path upgrades the same database to version 3. Creation/unproven upgrade records an immutable incarnation with unknown continuity before any cache, context or event access. Every opener, including reset and repository cache access, observes this metadata. Unreadable/future/corrupt/blocked stores are preserved.

A frozen enrollment intent is local inert metadata. Initial admission requires a registered fresh status, an owner-empty genuinely created store, persisted exact request bytes, and an independent authenticated status read proving its exact request created the still-current initial generation. Cache writes and successful server prefix reads cannot promote continuity. Every repository writer is bound to exact admitted incarnation/admission bytes within each ordinary transaction. Observed continuity loss permanently retires that retained writer, including after a cache-first open; closing a repository also revokes already returned store handles. Unknown upgraded/new-device/evicted state cannot expose the repository store writer; verified server prefix viewing remains possible and the repository exposes the continuity warning separately. No automatic learning reset repairs admission.

## Shipping reset ordering

`performLanguageReset` retains its existing outer Web Lock, original reset RPC/request, read-first retry, owner guards and later-marker refusal. No new global reset RPC, localStorage key or generic participant service was added.

In the required regime, after the original cloud reset receipt it persists `evidenceCleanup: {version:1,status:'pending'}` in the existing reset fence and rotates the acknowledgement. This also happens for an already completed same-request retry. Ordinary language contexts and other tabs stay blocked during cleanup.

Only a live registered reset context can mint reset authority. The adapter authenticates through the fixed app client and obtains a fresh noninitializing status for the exact reset request marker. Copied contexts/proofs or serialized `verified` fields cannot finalize cleanup.

- Unenrolled: skip IDB entirely. Old inert pre-enrollment metadata may survive; the next authorized open retires its stale marker. This branch never claims physical erasure of those inert bytes.
- Enrolled: remove only the proven owner's stale generations across all evidence stores and admission metadata. Preserve current-generation work and other owners. Carry an already verified intact owner/incarnation admission atomically to the exact current generation; unknown continuity is never promoted.
- Enrolled generation missing: proof-gated owner cleanup may erase local evidence, but creates no generation and leaves evidence unavailable for subsequent acquisition.

The old A2.1 ordinary cleanup method also requires intact admitted writer continuity; a remote-only reset cannot use it to bypass the registered reset bridge or carry admission.

Cleanup is independently read back. A second fresh status must retain the enrollment discriminant, immutable witness identities and exact cleanup generation/context. High-water growth is allowed. Another device enrolling under the same marker or a same-marker generation loss leaves cleanup pending for re-evaluation on explicit same-request retry. Only then does the adapter persist the runtime-verified cleanup transition, and the existing reset completion/notifications run.

Storage/transport errors preserve cleanup-pending and use the existing cloud-complete/device-cleanup-unconfirmed result. A committed cleanup with a lost response may be accepted only after its independent exact readback. Existing settings, language key lists, conversation cleanup and other-app reset behavior remain unchanged.

## Default denial and deployment floor

The sole release configuration is `languageLegacyEvidenceRelease.ts`: reset protocol inactive, enrollment false, capture false. Inactive reset executes no evidence status, fence extension or IDB operation, including when the new schema is absent. Schema detection and RPC-error fallback never activate the protocol.

The additive SQL revokes PUBLIC/anon/authenticated/service-role execution on all six write/init endpoints:

1. `public.get_language_legacy_evidence_context(uuid,jsonb,text,text,text)`
2. `language_legacy_evidence_private.get_context(uuid,jsonb,text,text,text)`
3. `public.enroll_language_legacy_evidence_v1(uuid,uuid,jsonb,text,text,text,text)`
4. `language_legacy_evidence_private.enroll_v1(uuid,uuid,jsonb,text,text,text,text)`
5. `public.append_language_legacy_evidence(uuid,uuid,text,uuid,text,jsonb,text[])`
6. `language_legacy_evidence_private.append_events(uuid,uuid,text,uuid,text,jsonb,text[])`

Read/status/reset remain available under reviewed grants. Witness clients have no direct table access. The existing nonmember, non-BYPASSRLS roles retain exact-owner mutation policies; the trigger receives only witness-owner-column existence visibility needed for R4. No public helper oracle is introduced.

Later deployment order requires separate approval: verify hosted history/adoption and administrative writers; install with writes disabled; deploy and validate required-reset release with capture off; verify old-client retirement/fencing; then explicitly grant exact endpoints and activate an approved pilot. The first write grant establishes the permanent required-reset rollback floor even before a user enrolls. Capture may later be disabled, but the required reset release, witness and status remain. Offline devices erase stale local bytes only when revalidated; immediate device-wide physical deletion is not claimed.

## Test/runtime limits and CI handoff

Local tests execute the authored SQL on installed PGlite with synthetic claims, actual repository/reset/fence modules, and a deterministic serial IDB test adapter. They are not independent PostgreSQL lock, Auth/PostgREST, real IDB durability, multi-tab transaction scheduling, browser/IME, hosted adoption or learner-acceptance evidence. Successful proof fixtures are produced by actual repository paths, not by manually branded objects.

The disposable SQL fixture installs both migrations with writes disabled by default. Its explicit `activateWrites:true` option grants only the six functions above. Synthetic repository tests explicitly substitute `{resetProtocol:'protocol-required',enrollmentEnabled:true,captureEnabled:true}`. Required-reset tests also prove capture-disabled cleanup and inactive/no-schema availability.

The separately updated CI source now installs the additive enrollment migration after the ledger and its reset/connector dependencies. Its catalog and actual restricted-role checks must prove all six write methods default-denied before the privately verified disposable stack may grant those exact methods to `authenticated`. The seed and production release remain inactive; the workflow is unchanged. The extracted catalog audit now uses both authored migrations and rejects each single-endpoint accidental reactivation.

The HTTP source explicitly substitutes the fixture release, preserves the production default-inactive refusal, and drives the shipped reset orchestrator. It covers first-enrollment committed-response loss with read-first proof, altered/competing nonces, inactive status-free reset, required unenrolled no-IDB reset, status-outage cleanup-pending retry without redispatch, capture-disabled cleanup, verified continuity carry, same-request current-generation preservation, and evicted-store refusal. The PostgreSQL source retains the original nine schedules with request-bound enrollment and nonrepairable witnessed loss, adding exact replay/marker rollback and competing-nonce cases. Report source digests include the additive migration, release/repository/reset/admission contract, directly executed codec/receipt/authority modules, deterministic IDB/owner fixtures, and dependency manifests. The report explicitly labels this selected-source inventory; it is not a digest of the entire checkout or installed dependency tree.

These are source changes, not a Gate A runtime/CI pass. Only pure refusal/wiring assertions and the authored SQL catalog checks on PGlite have run for this harness revision. Independent harness review and a separately authorized exact-commit disposable run remain required before publication claims. No Docker, real PostgreSQL, Auth/PostgREST HTTP, browser, hosted installation or capture activation was executed for this update.

Exact test counts and source hashes are recorded in the independent-review handoff at the source freeze. Gate B capture/privacy and Gate C views remain separate, unimplemented work.

## Disposable installer compatibility (2026-10-10)

The actual disposable run for `1e6356137ba426821e535bc96645b93292ece492` stopped during seed installation on Supabase PostgreSQL `17.6.1.167`, before SQL/HTTP/browser acceptance. Its error was `42501: must be able to SET ROLE "language_legacy_evidence_executor"`. The original first ledger ownership transfer reproduces under a NOSUPERUSER installer; a default-superuser PGlite setup had hidden this installation prerequisite.

`scripts/legacy-evidence-installation-fixture.mjs` is a pure adapter used only by the existing guarded disposable seed launcher. It pins both authored migration hashes, checks their exact insertion anchors and transaction boundaries, and preserves all original SQL bytes. The ledger scope begins immediately before its first ownership transfer; enrollment has its own scope after BEGIN. Ownership installation uses only the installer’s temporary SET/INHERIT membership and the two executor roles’ necessary private-schema CREATE. It verifies the installer and restricted executor attributes, then restores the exact prior membership rows (including grantor, options and OID) and private-schema ACL before that migration’s COMMIT. A failed migration, restoration or equality assertion aborts the transaction. No role attribute, production migration, application grant, RLS policy or default-disabled endpoint is changed by the adapter.

Run `38033201009` additionally proved that both executors lacked effective `auth` schema USAGE, while the other fifteen checked dependencies, including both `auth.uid()` EXECUTE checks, were present. The fixture now supplies only missing USAGE through authority the restricted installer already possesses: preferably an authorized transaction-local SET to the catalog schema owner, otherwise a direct installer grant option with an unambiguous grantor. It creates no owner membership and uses no stronger connection or credentials. If neither path exists it raises the fixed `disposable_auth_usage_authority_unavailable` failure and rolls back. Already-satisfied grants are preserved; target CREATE or grant-option access is refused. The two non-grantable USAGE grants last only for the disposable fixture’s lifetime. They implement the authored prerequisite without broadening production migrations or enabling application writes.

Each scope verifies the exact expected auth ACL delta and unchanged complete membership rows, executor attributes, auth schema ownership, `auth.uid()` ownership/ACL, auth relation and column ACLs and public/private schema ACLs, with installer identity restored before continuing and before COMMIT. The gate emits only fixed capability labels and booleans for the existing owner-SET/effective/direct-grant-option paths. Restricted-session regressions cover both supported paths, absent and inherited-only authority, one pre-satisfied target, second-migration no-op, unsupported targets, and rollback after a grant, while switched to the owner, or after a restoration mismatch (including a column-only auth grant). Both production migration hashes remain unchanged. Synthetic PostgreSQL 18.3 results do not establish the next actual PostgreSQL 17 gate result.

PostgreSQL automatically gives a non-superuser CREATEROLE creator an inert ADMIN-only membership granted by its bootstrap superuser. The adapter preserves that baseline. The catalog audit recognizes only the exact trusted installer/schema-owner’s creator row with that grantor and SET/INHERIT both false. It rejects other incoming/outgoing memberships, effective application MEMBER/SET/USAGE paths, retained installer SET/USAGE and executor schema CREATE. The sanitized report records this role audit and its digest, explicitly labels superuser status, and names the effective-access check as non-superuser-only. The separate historical superuser fixture is not represented as lacking SET/USAGE. Existing table/column/RLS/definer-owner and six-endpoint default-denial checks remain in force.

The regression executes actual authored SQL and the actual CI catalog audit with both session and current identity set to a NOSUPERUSER, CREATEROLE, BYPASSRLS synthetic installer. It covers the original failure, restoration before each independent COMMIT, preexisting own-grant options and schema ACL preservation, failed-install/failed-restoration rollback, unsupported identities/attributes, unexpected direct/indirect memberships and each accidentally reactivated write route. The installed PGlite engine is PostgreSQL **18.3**; it is not proof that the exact Supabase **17.6.1.167** stack now passes. A separately authorized exact-commit disposable run remains required. This fix itself performs no Docker, real PostgreSQL, HTTP, browser, hosted or deployment action.

Primary references: [PostgreSQL ALTER FUNCTION requirements](https://www.postgresql.org/docs/17/sql-alterfunction.html), [PostgreSQL creator-role and grantor semantics](https://www.postgresql.org/docs/17/role-attributes.html), and [Supabase’s non-superuser postgres role](https://supabase.com/docs/guides/database/postgres/roles-superuser).

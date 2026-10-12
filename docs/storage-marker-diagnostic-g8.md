# G8: inactive bounded marker diagnostic

Date: 2026-10-09 UTC. Schema baseline: `02c670a`.

## Delivered scope

`app/data/storageMarkerDiagnostic.ts` is a dependency-free, inactive module. It is
not imported by an application route, component, provider, auth flow, synchronizer,
or writer. The only runtime exports are:

- `classifyStorageMarkers`: pure classification of one or two caller-supplied
  observations of the three fixed marker strings.
- `readStorageMarkerDiagnostic`: synchronous read-only adapter, taking an explicit
  already-resolved object with `getItem`, or null/undefined for unavailable storage.

There is no default browser storage lookup. If obtaining a storage object throws,
a future caller must supply unavailable observations or null; this module never
accesses `window`, auth, ownership, locks, or other browser lifecycle capabilities.
A throwing `getItem` accessor or any individual read is mapped to a fixed
unavailable code without inspecting the thrown value.

The adapter attempts exactly these reads in this order, twice, without retry:

1. `yeoni-storage-transaction-v1`
2. `yeoni-storage-transaction-v2`
3. `yeoni-storage-generation-v1`

It does not enumerate the origin, read `length`/`key`, dereference journal keys,
read owner/baseline/auth keys, acquire a lock, or write anything. Caller-supplied
objects must implement read-only `getItem` semantics; the module cannot prevent
side effects inside a caller's own accessor implementation.

No existing transaction, storage, auth, synchronization, or writer implementation
was edited. G8's existing v1 fail-closed behavior remains intact.

## Input and bounds

The classifier snapshots exact own data descriptors into fresh internal wrappers
before inspection. Missing, extra, inherited, accessor, or unknown-discriminant
fields become unavailable without calling getters. Raw primitive strings are
captured once; later caller changes cannot bypass bounds or change parsed input.
Descriptor/proxy reflection failures are caught without inspecting error objects.
A hostile Proxy can execute code inside its own reflection trap; portable browser
JavaScript cannot sandbox that caller code. This contract does not claim to do so.

Each observation distinguishes absent, present string, and unavailable. An empty
string is present, not absence. Raw strings are transient private input, never
part of returned output, a receipt, a log, telemetry, a hash, or an export.

Hard limits, not caller-overridable policy options:

- 1,048,576 UTF-16 code units for any individual marker string.
- 2,097,152 UTF-16 code units across the entire classifier invocation. For two
  samples, repeated equal strings count twice; all six reads share this budget.
- 10,000 own entries per parsed before-map.

The entire string budget is checked before any JSON parse or raw-string equality
comparison. Exceeding any string cap skips all parsing/comparison and reports
`inspection_incomplete` (or `storage_unavailable` when a read is also unavailable).
Present v1/v2 fields then report incomplete inspection. Absent fields stay absent.
The observation comparison is unavailable. Source strings are never truncated.
Storage necessarily returns the complete string before its length can be checked;
these limits bound diagnostic inspection, not the storage engine's allocation or
supported user-record size.

The own-entry cap is checked after the bounded outer JSON parse and before map
values are inspected. Overflow is incomplete, including an oversized map that
also contains malformed entries. Before-image values are only checked for
string/null shape. They are never recursively parsed, normalized, copied into a
record map, projected, executed, or used as key permissions. The legacy generation
string is opaque, including empty/non-JSON/Unicode data: only bounds and an exact
bounded string comparison apply.

## Schema meaning

The classifier mirrors the marker shapes in `storageTransaction.ts` at the
baseline, without importing that module:

- V1 is a JSON object mapping keys to strings or null.
- Committed v2 has numeric version 2, state `committed`, and a nonempty string
  generation.
- Prepared v2 additionally has a nonempty string transactionId and a valid
  before-map.
- A numeric v2 version other than 2 is `unsupported_version`. A missing or
  wrong-type version, malformed JSON, wrong root/field shape, or unknown state is
  `unreadable`. Both remain invalid metadata.
- Before-maps reject the three marker keys and the session epoch key, matching the
  existing reader's reserved-key restriction. This diagnostic also conservatively
  rejects `__proto__`, `prototype`, and `constructor` keys. This stricter shape
  check does not change the existing writer or reader.

Structurally valid does not mean private-data-safe, correctly owned, complete,
committed, exportable, or recoverable. Other private or secret-looking strings may
occur inside a structurally valid journal and are never returned or dereferenced.

## Closed result and conservative precedence

The frozen result has exactly eight fields, each a fixed literal/closed enum:
`version`, `legacyMarker`, `v2Marker`, `observation`, `reason`, `quiescence`,
`repairPermission`, and `resumePermission`. It contains no original key/value,
owner, epoch, transaction ID, generation, count/length, URL, exception payload,
content hash, timestamp, parsed record, or durable authority token.

`quiescence` is always `unverified`; both permission fields are always `none`.
No result means safe, recovered, ready, synchronized, or migration complete.

The reason precedence across the whole observation window is:

1. Any unavailable read: `storage_unavailable`.
2. Any inspection limit: `inspection_incomplete`.
3. Any observed present v1 plus any observed valid prepared v2:
   `ambiguous_markers`.
4. Any present v1, including malformed/empty: `legacy_preservation_required`.
5. Any unreadable/unsupported v2: `invalid_metadata`.
6. Any valid prepared v2: `v2_prepared_observed`.
7. Otherwise: `no_legacy_marker_observed`.

Per-marker summaries retain the more conservative status across both samples;
they never silently replace a first-sample problem with the last sample. For v1,
unavailable/incomplete precede unreadable/valid/absent. For v2, unavailable and
incomplete precede unsupported/unreadable/prepared/committed/absent.

A v1 marker that disappears still requires preservation. A prepared v2 that
becomes committed remains an observed preparation, without a recovery claim.
Cross-sample v1/prepared-v2 ambiguity is a conservative observation-window result,
not a claim that both markers atomically coexisted.

A difference between available bounded marker pairs is negative evidence:
`changed_during_observation`. This negative evidence is retained even when a
separate read is unavailable; the reason still reports storage unavailability.
Equal samples mean only `no_marker_change_observed`. Single samples remain
`single_sample`; unavailable comparisons remain `unavailable`.

Equal markers cannot reveal an old nonparticipating record writer, marker/record
A→B→A, owner A→B→A, or writes before/after the observations. Web Locks availability,
a lock held elsewhere, elapsed time, one visible tab, empty client lists, offline
state, or owner hints are deliberately outside this API. Supplying extra wrapper
fields is rejected as unavailable. These hints cannot grant repair or resume
permission.

## Implemented synthetic acceptance

`app/data/storageMarkerDiagnostic.test.ts` implements D01–D16 from the G8 design,
with four additional API/precedence/hostile-wrapper tests (20 tests total):

- D01–D07: absent/valid/malformed/empty/ambiguous/committed/prepared/unsupported
  marker combinations and opaque generation.
- D08: exact and exceeded marker/total/entry bounds, including a parse tripwire
  proving preflight rejection and two-sample total accounting.
- D09: missing storage, throwing accessor, every one of six failing reads, opaque
  error objects, and non-string returns without coercion.
- D10: changes to each marker, disappearance, and changed evidence with partial
  unavailability; no retry beyond the two ordered samples.
- D11–D13: unobserved old-writer mutations, ABA, no-journal old writers, and
  lifecycle hints rejected at the API boundary; all permissions remain closed.
- D14–D16: private/script-like/prototype/reserved/token-reference input, outer-only
  parsing, owner ABA, and exact fixed-key capability restrictions.

Each fixture checks exact fixed output fields and values, immutable result shape,
and denied repair/resume. Storage proxies and browser/global/logging tripwires
assert zero diagnostic mutation, origin enumeration, auth/lock/network/navigation,
clipboard/download/event/timer access. Normal fixtures compare the entire
fabricated backing map before/after. The old-writer/ABA fixtures explicitly mutate
only their synthetic peer state to demonstrate the observation limitation.

Verification run with installed local tools and public Supabase configuration
removed from the synthetic regression process:

```sh
env -u NEXT_PUBLIC_SUPABASE_URL -u NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY \
  -u NEXT_PUBLIC_SUPABASE_ANON_KEY node --experimental-strip-types --test \
  app/data/storageMarkerDiagnostic.test.ts app/data/storageTransaction.test.ts \
  app/data/cloudSync.authLifecycle.test.ts
```

Result: **69 passed, 0 failed**, comprising 20 new diagnostic tests and 49 existing
transaction/auth-lifecycle regressions. The existing Node module-type warning
remains; no package configuration was changed to suppress it.

Scoped ESLint passed for both new TypeScript files. Whole-project TypeScript
checking (`tsc --noEmit --incremental false`) passed on the final source. A separate
read-only reviewer also ran ten hostile-input probes; all ten passed. Those probes
are additional review evidence, not additional E/I acceptance tests or browser
validation. Full aggregate tests and any parent-level final audit are separate.

## Not delivered or validated

This is the diagnostic slice only. The design's E01–E08 exact forensic-evidence
fixtures and I01–I08 isolated-entry/operator/repair fixtures are **not implemented
or claimed** by these tests. There is no evidence export, private capture,
preservation receipt, operator procedure, old-writer quiescence mechanism,
recovery/repair permission, migration, resume path, UI, or application activation.

The pure code has no network requirement, but no offline browser entrypoint or
pre-auth/PIN access has been validated. Root auth/sync/PWA/editor lifecycle effects
remain separate integration gates. No browser, physical device, old cached
release, private account, hosted backend, actual recovery, deployment, or rollout
was exercised. An unchanged source under synthetic tests is not a backup and does
not establish that a live peer tab cannot write. Actual preservation, supported
quiescence, owner verification, chosen-state repair, and old remote-writer
retirement remain separate authorization and validation work.

# Free-handwriting interrupted-attempt recovery

Date: 2026-10-10 KST / 2026-10-09 UTC. Source-only G1 implementation; no commit, push, hosted migration, Production change, provider call, original/private artwork, or browser launch was performed for this slice.

## Contract and feature preservation

- `/growth/handwriting/free` remains a free one-page handwriting practice. It keeps the three guide choices, arbitrary six-digit pen color, pressure-width drawing, measured contact time/occupied bounds/pressure range, clear, undo and redo, private image and completion metadata, and link to the separate 53-lesson course.
- Canvas sizing still uses `min(1200, max(640, round(displayWidth * 2)))`, with height `round(width * .62)`. All **20** historical snapshots, including redo frames and the selected index, are retained. The selected raster is represented by its frame index, not a second duplicate raster.
- The local format contains owner, practice kind, attempt UUID, revision, reset marker, historical guide index **and original guide wording**, ink, selected history index, complete raster/metric frames, and an optional immutable pending request. Historical guide wording is not rewritten from today's guide array.
- Each RGBA frame is lossless and SHA-256 checked. PNG is stored as bytes with SHA-256; full-content IndexedDB CAS compares every PNG and raster byte, all recognized nested fields, owner, attempt and revision. Equal byte counts are not evidence of equality.
- The aggregate serialized binary budget is 80 MiB, covering all 20 frames and an optional PNG up to 10 MiB. The maximum existing surface and full history fit. Invalid/oversize/unknown-schema/unknown-field records are blocked and preserved; no migration or stripping to a known tombstone occurs.
- A bounded checkpoint drain has one current encoding/write and at most one latest coalesced snapshot. Each caller has its own completion waiter; a checkpoint arriving between drain completion and its finalizer restarts the drain and cannot receive premature flush success.
- Checkpoints contain completed strokes only. A different pointer's release does not end the active stroke. A no-movement pointer does not consume history. The pressure, range and time evidence is restored per frame alongside the exact raster, including undo/redo.

## Frozen save and remote boundary

1. Verify the active owner, checkpoint locally, and read the authoritative growth-reset marker. Missing/error responses are not treated as absent/reset-null.
2. Encode a PNG while edits are locked, freeze its exact bytes/hash plus session UUID, resource UUID, object path, full immutable session/resource fields and timestamps. Commit this pending payload to IndexedDB **before any cloud mutation**.
3. Every attempt/retry independently reads session, resource, and object before mutation. Network/auth/read errors never authorize an insert. Only explicit Storage absence allows `upsert:false` upload to the frozen path. Downloaded bytes must match the SHA-256, even after upload error/lost response.
4. `save_free_handwriting_attempt` is a new, isolated SECURITY INVOKER function. It has an exact free-only metric schema and cannot accept 53-lesson course metadata. It verifies expected owner, owned handwriting routine, and authoritative reset marker under the existing per-owner reset advisory lock. Resource/session inserts are atomic; existing rows are compared but never updated. Resource UUID/path reuse with another attempt is rejected.
5. The exact object is downloaded and hashed before the RPC; after a commit response, independent session/resource row reads determine success. Owner/reset/local-CAS checks surround each asynchronous boundary. A missing RPC stays pending; there is no fallback to generic growth-session inserts. Pending retries use the original frozen routine ID and payload even when current routine listings fail.
6. Only a confirmed save permits a compare-and-swap confirmed tombstone. The UI distinguishes server confirmation from failed/uncertain local cleanup or a later marker read. A terminal write that committed but lost its readback is not called a retained pending draft.

The reused `handwriting-draft` utilities are generic canonicalization/hash/raster utilities and the reused `handwriting-save` utility is the read-first exact-row/object transport. Course draft parsing, course RPC validation and course source are unchanged. The adapter maps the free RPC's reset error fail-closed. Existing server fields outside the frozen immutable payload (such as session `created_at` and resource `last_used_on`) are left untouched; this is not a claim that future server columns are part of the immutable request.

## Preservation and explicit clearing

- Owner-keyed workspaces and owner/generation checks before and after asynchronous boundaries stop late account-A work from displaying success or clearing data in account B. A draft never migrates to a new owner.
- An existing local draft can be displayed and locally edited while authoritative reset lookup is offline. It retains its original marker. Saving still requires an authoritative owner/reset check; a fresh blank draft waits until its initial marker is known.
- Quota/encoding failures preserve the latest visible screen and the prior durable record when the write did not commit. A nonterminal write may commit and then lose its readback: the UI keeps the screen and explicitly treats the final local checkpoint state as unconfirmed, rather than promising the old bytes remain. Cloud mutation is blocked whenever staging is unconfirmed. Writes are serialized and CAS-fenced across tabs. Conflicts retain both the winning durable value and the stale tab's visible values rather than choosing one silently.
- Normal clear first persists its blank frame, then paints it, preserving the existing undo behavior. Clear of an uncertain pending save is disabled. A reset-invalidated pending attempt is preserved until the user explicitly confirms starting a new attempt; replacement uses CAS against the complete prior record.
- A same-page pending/save attempt cannot use free-page clear to discard its uncertain request. Cross-device ordinary manual record/resource deletion is a separate unresolved product concurrency boundary; it is not claimed to be a reset fence, and this change adds no hidden server receipt or shared delete-schema change.
- Storage is not in the SQL transaction. Uploaded private objects can remain unlinked after a later reset/failure; they are never automatically deleted, and the UI states that preservation. No row/object deletion is used as compensating cleanup.

## Executed verification

- Local synthetic free parser/store/transport tests: unknown schemas and every nested extension level, full byte/hash mismatch, metadata/timestamp mismatch, strict evidence/date fields, course incompatibility, two-tab CAS, stale cleanup/ABA, quota, read-first retries, missing RPC and orphan retention.
- Local transpiled shipping-hook tests: reload raster/history/guide/ink, stage-before-write, pending routine-independent retry, double click, delayed/null encoding, owner switch, offline editing, two-tab conflict, reset before/during save, explicit reset-invalidated replacement, quota/terminal uncertainty, microtask checkpoint restart, greater-than-20-frame burst, local offline clear and unfinished/unrelated pointers.
- Local single-connection PGlite tests: **34 new free RPC cases**; additive installation leaves table schemas, table grants, RLS, reset and course function definitions unchanged. Includes actual client payload round-trip, authentication, type/shape validation, strict date/time checks, pressure ranges, free/course separation, exact no-update replay, normal reset/save ordering, routine/path/resource collisions, full rollback, newer timestamps and RLS owner isolation.
- The new and existing course suites are run together as compatibility regressions. Exact latest totals belong to the accompanying parent validation logs; focused tests do not certify the whole concurrently changing tree.
- TypeScript, focused ESLint and whitespace checks were executed. No build was started by this worker; the parent owns final aggregate build and workflow registration.

## Authored, not executed

`tests/e2e/free-handwriting-recovery.spec.ts` defines **9 browser cases per configured engine**: 320/390px reload/history/navigation; lost-RPC response; immutable pending retry with unavailable current listing; real-IDB two-tab conflict; reset after upload/orphan preservation; quota; offline marker/local edits; and delayed save with account switch. These are authored assertions, not browser results. The parent registers the additive migration and browser spec in the disposable stack/workflow/config.

Still unverified here: actual browser IndexedDB persistence/eviction/quota behavior, full offline navigation and PWA caching, physical iPad/Pencil touch/pressure, small-screen visual acceptance, multiple PostgreSQL connections racing save/reset, hosted SQL/RLS/Storage deployment and Production readiness. Local browser execution was explicitly unavailable by authorization, and no alternate route was attempted. Follow the authorized browser/hosted/device gates separately.

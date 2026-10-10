# Saved handwriting comparison (G7)

Implementation handoff, 2026-10-09 UTC. Developed against base commit `719bb3918e071dd96c957779a35b31b4c790de37`; this document describes the new working-tree implementation, not a deployed release or authenticated browser pass. Final aggregate/release evidence belongs to the parent verification report.

## Implemented scope

`/growth/handwriting/compare` is a dedicated read-only view of two explicitly selected saved practice attempts. Course and free editors link to it through their existing checkpoint-before-navigation flow. It does not load `useGrowthData`, recover drafts, finalize pending saves or migrate records.

- Current course trace/copy and versioned free attempts require the saved PNG hash to match the downloaded original bytes.
- The explicitly supported legacy course/free schemas may show a readable PNG, prominently labeled “저장 당시 원본 해시 없음 · 원본 무결성 미확인”. A digest computed today never upgrades legacy integrity.
- Paper completions have a non-image state. Missing links, unsupported metadata, missing rows, failed reads, unreadable PNGs and mismatched hashes remain distinguishable.
- Provenance requires a surviving owner-linked session and its explicit resource ID, a validated owned canonical practice path, and an unambiguous link. Duplicate claims are checked beyond the loaded page. Generic uploads, workbook files, local drafts and resource/Storage remnants cannot become attempts.
- Routine deletion or changes to resource title, notes or classification do not manufacture or erase image provenance.

“Original” means the saved canvas PNG, including its original background. It is not a physical paper photograph, reconstructed pen trajectory or background-free handwriting layer. Images are not cropped, aligned, recolored, sharpened or re-encoded.

## Reading and privacy

The reader uses direct owner-filtered queries, authenticated Storage downloads with `cache: 'no-store'`, a bounded request deadline and revocable in-memory Blob URLs. It verifies MIME, byte size, PNG header, bounded dimensions, successful decoding and, for modern saves, the stored hash. Exact session/resource context, resource linkage, authenticated owner, session epoch and authoritative growth-reset marker are checked again before publication.

Every asynchronous operation is generation-fenced. Owner/epoch changes, reset signals, uncertain shared auth/reset reads, replacement and unmount clear affected state and revoke URLs. A side-local image failure cannot borrow the other image. Private images bypass Next's image optimizer. The comparison creates no signed URLs, persistent comparison records, browser-storage copies, analytics payloads or application mutations. Existing application-wide synchronization remains outside the reader.

Focus/visibility return and page restoration clear the pair and require explicit reselection after revalidation. This is intentional, including selections from later pages; the view never partially restores only first-page selections. Optional viewing checks reset with the pair and are never saved.

Remote resets/deletions are checked at read, publication and resume boundaries, not continuously. Already obtained pixels cannot be remotely revoked at the instant another device deletes a record. Retained resources after reset remain unlinked and are not restored as practice attempts. The existing global reset/sync flow can reload the whole page.

## Context and history

History is paginated by a unique session-ID cursor, then sorted by record date within the loaded set. The UI shows loaded counts, explicit “더 불러오기”, errors and filters over loaded records. It makes no global oldest/latest claim and does not certify an immutable account snapshot. Filters restart discovery and clear selections.

Each pane distinguishes record date from save timestamp, shows source/mode/context and original pixel dimensions, and identifies path-date disagreements. Historical course wording is shown only when saved; a current-catalog fallback is labeled as current. Condition notes identify differences or unknowns in lesson, guide, mode, worksheet identity and dimensions. Equal guides mean the same selected guide, not verified transcription.

Only stored source-specific measurements are shown. Valid zero remains zero; unavailable metrics remain unknown. Input strokes are not character count or correct stroke order; contact time can include pauses; coordinate extents are not letter size/spacing; pressure is an uncalibrated device scale. There is no quality score, improvement verdict, physical-size equivalence or automatic progress/completion change.

## Verification recorded for this implementation

Before the aggregate handoff:

- **125 focused tests passed**: **75 new comparison tests** (30 model + 45 reader/hook/transport/account-gate tests), plus 50 existing course/free hook and recovery tests.
- Full TypeScript no-emit check, scoped ESLint and `git diff --check` passed.
- The new E2E spec contains **10 authored cases**, collected for Chromium and WebKit-small (**20 comparison instances**, plus existing auth prerequisites). Static collection and synthetic PNG CRC/scanline validation passed.

Relevant files:

- `lib/handwriting-comparison.ts`: provenance, compatibility, context and bounded PNG preflight
- `lib/handwriting-comparison-reader.ts`: read-only transport contract and fenced in-memory reader
- `app/growth/handwriting/compare/`: account gate, production read transport and UI
- `tests/handwriting-comparison.test.ts`
- `tests/handwriting-comparison-hook.test.ts`
- `tests/e2e/handwriting-comparison.spec.ts`

The synthetic tests cover more than 1,000 tied-date records, strict modern/legacy distinctions, exact byte/hash checks, duplicate links, missing versus failed reads, delayed success and rejection at lifecycle boundaries, timeout uncertainty, StrictMode replay, owner-preparation completion, reset fences, temporary URL cleanup and preserved editor navigation wiring. The authored browser suite additionally checks actual image display, full aspect, 320px/normal layout, dialog keyboard/focus behavior, no-write snapshots, private-persistence audit and fixture-owned cleanup.

## Explicitly unverified

Root final frozen-source verification (2026-10-09 22:12 UTC): **1,978/1,978** repository tests and **49/49** sync-handler scenarios passed. Full nonincremental TypeScript, whole-repository ESLint and production build all exited successfully using the installed Node CLI binaries. Independent focused review passed the 125 cases above and found no remaining blocking source issue. The early browser suite discovers **270 cases in 18 files**, including 20 comparison cases; none of those new comparison browser cases has executed. These counts are overlapping layers, not additive unique cases.

Authenticated browser execution was **not run** in this environment because local browser execution was denied. Static test collection is not browser acceptance. Actual browser rendering/decoding, keyboard and focus behavior, navigation/reload/reset flows and 320px usability remain gated on an authorized disposable Chromium/WebKit run, including cleanup verification.

No real private original or workbook was inspected. No hosted service, production record, Storage object, migration or deployment was changed by implementation verification. Actual historical-image availability, hosted save-RPC installation, production availability, physical iPad/Pencil behavior, calibrated pressure, handwriting improvement and unrelated segmentation/stroke-order work are not established here. There is no merge/deployment readiness claim based on the local checks alone.

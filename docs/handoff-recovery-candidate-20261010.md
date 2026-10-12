# Recovery and Live overview development candidate

2026-10-10 KST / 2026-10-09 UTC. Parent: `a6624c0d7e9173767a4b3cbd9fee928b5542f9c7`. Development branch only; not an operating release.

## Changes

- Live overview and calendar projections expose recent lessons, review/relearning evidence and allowlisted navigation without creating reports or changing existing calendar records.
- Basics typing and handwriting gain bounded owner-scoped interrupted-attempt recovery, immutable read-first save retries, reset fences and explicit uncertain outcomes. Handwriting adds an additive SQL RPC; it has not been applied to a hosted database. Browser storage is not cross-device backup.
- Travel dates reject impossible calendar dates; authored travel cases cover local-date and return boundaries.
- The local backup UI names its actual local-record scope and refuses an export larger than its existing import ceiling. It does not export cloud-only records, private files or recovery IndexedDB.
- The reproduced shared-storage reader rollback is mitigated with nonmutating coherent snapshots, persistent generation checks, and cloud-sync deferral. This is NOT full multi-tab transaction safety. Concurrent/raw writers, old tabs, ambiguous orphan journals, and check-before-apply races remain release blockers.
- CI diagnostic assertions now match the installed Auth client's missing-session error and PostgREST GET retry contract without weakening owner, immutable-payload, no-extra-POST or logout assertions.

## Executed local evidence

- First aggregate: 1,446 passed / 2 failed out of 1,448. The handwriting fixtures assumed 100 event-loop turns were sufficient for asynchronous WebCrypto/toBlob readiness. Failures occurred before the intended behavior assertions.
- Replaced those polling assumptions with observable hook-state/toBlob-entry handshakes, retaining assertions. Added two actual-client basics transport cases.
- Final aggregate: **1,450 passed / 0 failed**, no skipped/cancelled tests. This includes synthetic shipping-component tests and PGlite SQL/RLS checks; it is not browser execution or hosted verification.
- Production build passed on the same shipping source (later changes were test/document updates and one whitespace-only cleanup).
- Final nonincremental TypeScript and whole-repository ESLint reruns both passed.
- Playwright discovery lists **184 cases in 13 files** for the expanded early Chromium/WebKit acceptance gate. Discovery launches no browser and is not a pass result.

## Actual browser baseline and pending gates

The latest actual full run remains `37980448169` at parent `a6624c0`: **120 passed / 8 failed** in the early acceptance step. Later drawing/aggregate checks were skipped. This candidate requires a new exact-commit run; local checks do not replace it. No browser retries or access-restriction workarounds were used.

The previous reader lifecycle run at `3a36a395` passed 12 cases, and animation checks passed eight jobs; those results remain attributed to that commit, not this candidate.

Vercel's last verified candidate status was “Account is blocked.” No new Preview deployment is claimed. PR #208 remains Draft until separately verified. Main/Production, hosted migrations/RLS/settings, paid providers, TTS grants and operating approval remain outside this development publication.

Physical iPhone/PWA/iPad/Pencil, real multi-connection PostgreSQL contention, original private-material restoration, missing accepted short/long alignment exports, and the full shared-writer/legacy-tab migration remain explicit gates. See the feature-specific verification notes for bounds and failure behavior.

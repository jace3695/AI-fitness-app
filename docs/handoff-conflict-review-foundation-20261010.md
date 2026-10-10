# Conflict review and legacy course evidence checkpoint

Local checkpoint, 2026-10-09 21:48 UTC (2026-10-10 KST), based on `ed4c7d058c6374a198184906d14664c35cbbec20`.

## Implemented locally

- G3 shared-record conflict classification and explicit choices, exact content/revision CAS, owner/reset and newer-edit safeguards, conservative legacy encoding compatibility, and metadata-only diagnostics. See [G3 handoff](shared-sync-conflicts-g3.md).
- G4 Phase A1 only: inactive pure legacy course evidence validation, item/modality projections and factual summaries. Optional catalogue metadata preserves existing content, selection, grading and completion behavior. See [A1 scope](legacy-language-evidence/phase-a1.md).
- Additive `20261009212500_save_cloud_state_if_unchanged.sql` is registered in the disposable test stack. It has not been installed on the hosted database.

## Final local verification

Final frozen-source chain used the already installed Node CLI binaries:

- `node scripts/test.mjs`: **1,903 passed**, no failures, cancellations or skips.
- `node scripts/qa-pr189-sync.mjs`: **49 passed**, no failures.
- Full nonincremental TypeScript, whole-repository ESLint and production build: passed.
- Early browser suite discovery: **250 cases in 17 files**, Chromium and WebKit-small. Discovery is not execution.
- Independent G3 review: 149 focused cases and 49 handler scenarios passed. These overlap the aggregate; they are not additional unique tests.
- Independent inactive A1 review: 41 focused cases passed, catalogue equality (62 lessons/496 questions) and adversarial provenance probes passed. Four exposure/retry defects found during review were fixed before the final aggregate.

An earlier preflight failed 11 old diet test-loader cases; its adapter was corrected without weakening assertions. A subsequent 1,902-case chain passed tests and handlers before the final typed-choice exposure correction, then its `npx` invocation was blocked attempting registry access. The final 1,903-case chain above used installed executables without a registry request and passed all five stages. Neither earlier run is the final acceptance result.

## Explicit remaining gates

No new authenticated browser run, physical-device test, hosted migration, private-record conflict choice, provider call, main merge or production deployment occurred. Local browser execution remains restricted. Publication is paused pending the owner's explicit response to the development-branch upload approval request; the remote development branch remains at last verified `d4382f8`.

The last actual early browser run remains `a6624c0` (120 passed / 8 failed). Later `d4382f8` CI stopped in the previously diagnosed sync harness before browser execution. New code and authored tests do not change those historical outcomes.

G3 retains the documented active-editor selection liveness limitation, old-client retirement requirement and real multi-connection/hosted rollout gates. A1 does not implement durable evidence capture, persistence, optional same-item practice, UI/assistant integration or full G4 acceptance. Other roadmap gaps remain; this checkpoint is not whole-project completion.

Preserve the four old untracked reader lifecycle logs outside this commit. No existing TTS source, approval quota, production data or daily-analysis automation was changed.

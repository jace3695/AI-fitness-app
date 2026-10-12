# Preserved handoff baseline CI result

- Source: `40480ea51dad01462ed63161301d7a01a21534c4`.
- Existing run: https://github.com/jace3695/AI-fitness-app/actions/runs/37954896611
- Job: `113903300779`; no cancellation or rerun was requested.
- Final aggregate at 2026-10-09 17:16:32 UTC: **437 passed, 1 failed**.
- Failure: Chromium, `drawing.spec.ts`, “drawing D33 D34: previous memory
  source remains untouched and reference snapshot survives deletion”.
- Reported failure location includes `drawing-tools.ts:9` and timeout during
  fixture teardown. The result alone does not establish database loss or prove
  that this failure has the same cause as older drawing races.
- All preceding focused workflow steps 1–19 succeeded. Their counts are not
  added to the final aggregate or substituted for it.

## Cleanup and evidence

The job's disposable database/container/volume/key cleanup and artifact upload
both succeeded. Logs confirm removal at 17:16:41 UTC. Across the run, 760 emitted
row-level cleanup records report `rowsRemaining: 0`; the failed test's timed-out
fixture does not independently prove its row-level cleanup. Whole-stack removal
is the final cleanup evidence for that case.

Preserved artifact:
https://github.com/jace3695/AI-fitness-app/actions/runs/37954896611/artifacts/11633375379

- Artifact ID: `11633375379`
- ZIP bytes: `24486074`
- Downloaded ZIP SHA-256:
  `1560db1f110ef47f1f4b9d8dac9458f033ca351bbef96e7f81d8ef6fa6bd6109`
- Full log and original ZIP are retained separately for diagnosis; no raw
  personal records or credentials are published in this checkpoint.

The earlier 438/0 results remain attributed to their earlier SHAs. This baseline
is a failed run, not a full pass. A subsequent candidate must diagnose the actual
failure and execute required regression checks without weakening assertions,
timeouts or retry policy. Production and PR Draft/feature-OFF gates remain intact.

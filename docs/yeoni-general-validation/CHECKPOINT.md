# Approved general samples — recovery and validation

## 2026-10-08 23:28 KST authorization

User approved preserving the existing short recording and continuing development
within the existing approved scope. Production merge/activation remains separate.

## Preserved baseline

- Remote source: `fab899338ed1644da27084b16b0f5d75a316defd`; local recovered commit
  `76f0006a7c4bae87c45410bce3f4a55e519ba911` has the identical tree
  `3efd0dcfda3faa9a01283b713b0e38bba78e22e4`.
- The old dirty phase9 HTML is untouched. Work continues in an isolated worktree.
- Production remains `62c2141` / `dpl_7sQeDrCAVugwnwhgHkNt6MLkxhfK` READY.
- Saved-sample character PoC remains 16/16 complete; no old checks were repeated.

## Short recovery completed

- Existing Preview UI restored one saved response; no TTS request was made.
- Exported `yeoni-review-short.json` and persisted a separate backup successfully.
- Exact approved text, voice and request UUID were checked. No receipt was reset.
- Request ID: `fd002e38-7817-4846-a5b5-b247edb63df1`.
- JSON: 25465 bytes; SHA256 `354cfa026f749573c1ca0591ee8c6008c9cfce7bd51871f9c8a257cc8f7c8509`.
- MP3: 18912 bytes, 24000 Hz mono, duration 4.728s; SHA256
  `b189e12b0542ef87b04623b61048ad7d127e63bbb1bf750a2d2c5e8c3ba5113b`.
- Stored generation elapsed 2436ms is generation latency, not audio duration.
- Read-only server check at 23:30 KST: short reserved32; numbers/long have no
  receipts; app limit326/reserved57/remaining269. The budget is not a billing report.

## First new short alignment failed closed

- One hosted saved-audio alignment at 23:30 KST: decode OK0.22s, engine OK4.48s,
  then `INVALID_RESULT_OR_INPUT`. No new TTS or automatic retry.
- Playback/phonetic accuracy has not passed. The saved response remains intact.
- Diagnostic-only follow-up separates unknown/empty phones and invalid timing
  into fixed log categories; it does not accept invalid alignment, log transcript,
  retain service inputs, change voice or enable general alignment.
- Targeted rejection/privacy and failure-cleanup checks passed locally.
- Next: one explicit alignment attempt with the same backed-up short bytes after
  the diagnostic Preview is READY, then address the observed category. Numbers
  and long retain their one-call authorization and remained ungenerated at that point.

## All three originals now backed up

- After the short backup succeeded, the two remaining previously approved cases
  were each generated exactly once: numbers at 23:36:14 KST, long at 23:36:50 KST.
- Numbers request: `332e052e-595c-4ecd-b710-029592eec14b`; MP3 29376 bytes,
  7.344s, SHA256 `1e8b482284879b35b3bcf42549e4efe565ff86a1c3695e9c241589d768b5e4b1`.
- Long request: `5f2f9546-7649-436d-8c55-bb273536887f`; MP3 115584 bytes,
  28.896s, SHA256 `3355e6a2ec15688067b221e6373110e1b87789f9829d84188f069fcb9717208e`.
- Three original JSON responses, three decoded MP3 files and `backup-integrity.json`
  are persisted independently of the browser; all SHA256 values were checked.
  MP3 decoding for backup was base64 only, with no audio re-encoding.
- Read-only server verification: exactly three approved request IDs / 301 characters;
  October app limit326/reserved326/remaining0 including the prior Japanese25.
  This is the application's reservation ledger, not a cloud billing audit.
- Reloading the stable Preview and restoring results recovered all three samples.
  Generation controls are disabled. Never reset IDs/receipts or regenerate any case.

## Dictionary OOV diagnosis and bounded follow-up

- Diagnostic Preview `1a973854ffe575da06eb8ea3c76e962bb4c92231` /
  `dpl_G47ua6PiUE5tBBM8YJEsTEJ8PjXX` was READY.
- Saved short retry 23:40:08, first numbers alignment 23:40:44 and first long
  alignment 23:41:33 KST all failed closed with `UNKNOWN_PHONE`.
  No TTS retries and no accepted manifests or playback passes.
- The next candidate adds hash-pinned official Korean MFA G2P v3.0.0 via MFA3.4.2's
  supported OOV option. It does not alter audio bytes, request UUIDs, acoustic
  model, controller, unknown-phone rejection or general feature OFF state.
- New targeted checks: acoustic/G2P filename collision prevention, corrupt G2P
  rejection, private error suppression and failed-job cleanup all passed.
- MFA3.4.2 source inspection shows G2P writes OOV lexicon additions. G2P requests
  therefore use writable job-local copies; the shared immutable lexicon stays
  untouched. The modified cache test verifies isolation and deletion after exit.
- Hosted G2P validation is pending. Number readings, connected pronunciation,
  latency and iPhone review remain unverified. PR208 remains Draft; no production
  merge, deployment, flag activation or quota change is authorized here.

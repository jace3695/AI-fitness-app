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
  and long retain their one-call authorization and remain ungenerated at this point.

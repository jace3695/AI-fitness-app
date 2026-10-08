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

## G2P Preview and renderer inventory follow-up

- G2P + isolated mutable lexicon Preview `a8c4a51d09e16047be3fd93221d9b5da0703c7fa`
  / `dpl_AdQs6aj2yCnr26wDfAFPZdGRGBHS` READY. At 23:59 KST, a saved-short
  request completed decode0.27s /engine7.96s with no worker validation error,
  but the app still returned ALIGNMENT_UNAVAILABLE. No playback success claimed.
- Static model/renderer comparison found only45 of108 G2P symbols supported.
  The next candidate explicitly projects the complete pinned inventory using
  published MFA IPA categories; unknown symbols still fail. See PHONE_PROJECTION.md.
  Two targeted checks cover all108 symbols, rejection outside the inventory and
  preservation of source phone labels/timing. Both pass.
- A local MFA environment setup was attempted for deeper source-output review,
  but package processing reported `fatal library error, lookup self`; installation
  was stopped. No local engine execution or phonetic review is claimed.
- No numbers/long hosted retries were performed on a8c4a51 while diagnosing the
  common short failure. All originals and three server reservation IDs remain.

## 2026-10-09 00:20 KST — saved-audio review checkpoint

- Code Preview `6a1f52a9885bc101e32cce5a86477f08fe9be2f0` /
  `dpl_MCwd5wxkKzHt7derUn6yNcuPGGQL` READY. The complete phone inventory
  fix resolved the short manifest rejection; its actual new phones include
  `pʲ`, `t͈`, `ɟ`, which were absent from the old renderer map.
- Short: 51 cues /4.728s, alignment8443ms. Original MP3 and request ID unchanged.
  Browser played to4.728s and returned to `rest:rest:0` at end.
- Numbers: saved-audio attempt still rejected with `UNKNOWN_PHONE`
  (2026-10-08T15:15:55.498Z). No manifest accepted, no regenerated audio.
  The pinned G2P model has no digit graphemes; MFA's Korean tokenizer preserves
  numeric surface forms. Spoken-number normalization remains an open issue.
- Long: 363 cues /28.896s, alignment13833ms (UI13.83s). Original MP3 and request
  ID unchanged. Cat playback advanced12.074s with a non-rest mouth pose and
  reached28.896s/rest. Human playback showed changing poses, paused at10.34391s
  with a stable clock/rest, resumed and reached25.959s with `a:a:0` before manual
  reset. A role-based appearance click failed during the first playback;
  a subsequent DOM check resolved it after playback ended. No in-play
  appearance-switch pass is claimed.
- Cat appearance and motionOFF were restored. Original JSON/MP3 backups remain
  separate from the two accepted alignment exports. The browser retains all three
  recordings with generation disabled. Independent archive:
  `AI_Yeoni_Original_Voices_2026-10-08.zip`, SHA256
  `885ff7e6ac2bb4eb5a0b8e0e7f86df972657b1c8d0ee0d8a866f38da29de29ee`.
- Final server read-back: IDs unchanged32/52/217; limit326/reserved326/remaining0.
  Production alias still resolves to `62c2141` /`dpl_7sQeDrCAVugwnwhgHkNt6MLkxhfK`
  READY. PR208 Draft/unmerged. General alignmentOFF. PoC16/16 is unchanged.
- Targeted changed-code checks pass. Latest code CI run37798354656 was still
  in progress at this checkpoint, not a pass. No CI rerun requested manually.
- Remaining: establish the numeric recording's actual readings, implement and
  evaluate bounded spoken-number normalization using the same MP3, review
  phonetic boundaries/naturalness and iPhone behavior. Two accepted manifests
  are technical validation only; no phonetic, listening or device acceptance.

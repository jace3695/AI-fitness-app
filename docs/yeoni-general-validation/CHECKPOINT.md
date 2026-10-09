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

## 2026-10-09 — user-confirmed currency pronunciation defect

- User heard the existing numbers recording read `12,500원` as `십이 오백원`,
  rather than `만이천오백원`. This is a TTS pronunciation defect, separate from
  the worker's `UNKNOWN_PHONE` rejection. The readings of `3시`, `30분`, and
  `2개` have not been confirmed by this report.
- The original numbers MP3, request ID and 52-character receipt remain intact.
  Do not relabel this old audio with the corrected transcript or align it against
  the desired reading. This supersedes the previous suggestion to normalize the
  transcript while reusing that recording for a corrected-reading check.
- Added bounded Korean won integer normalization at the server synthesis boundary:
  `12,500원` becomes `만이천오백원`. Valid grouped/plain integers through16 digits
  and a bounded set of Korean currency suffixes are supported. Signs, decimal
  amounts, malformed grouping, time/count units, IDs and unknown suffixes are
  deliberately left unchanged; this is not complete numeric speech normalization.
- One final spoken text is used for character reservation, Google input, returned
  `spokenText`, and optional alignment. Raw and normalized1200-character caps are
  enforced before reservation. Client quota/count/alignment checks use that same
  conversion. Existing raw-text attempt keys are preserved, so updating the reader
  cannot silently regenerate an old numeric answer. Stored audio is not rewritten.
- Mocked provider/worker and local synthetic PGlite tests verify final text/hash,
  quota expansion, no provider call on rejection, duplicate IDs, legacy receipt
  preservation, matching/incorrect alignment transcripts, and replay without retry.
  All34 targeted checks pass after correcting the new test's expected count from
  52 to51. Changed-file ESLint and TypeScript checks pass. These are code checks,
  not actual speech, browser playback or iPhone acceptance for this correction.
- Baseline `b3114fb81cef7f351030a7044ddd251180cc3299` still matched the remote
  branch when work resumed. Its CI run37800120761 completed successfully overnight.
  The local source tree was verified as exactly2ac65f2eb5fdc54112c8025e5ec94cafbba2a0d5
  before edits; missing old worktree metadata did not require overwriting source.
- No real TTS/alignment request, production DB/quota change, receipt reset, voice
  regeneration, general alignment activation or production merge/deployment was
  performed for this fix. PR208 remains Draft; the three one-call approvals have
  already been consumed. Original plan texts and IDs are unchanged.
- Next live pronunciation check requires a new, separately approved recording.
  Minimal proposed Google input: `예상 비용은 만이천오백원이에요.` (17 Unicode
  characters including spaces/punctuation), voice `ko-KR-Chirp3-HD-Zephyr`, once.
  This is a proposal only: no request ID, grant or audio has been created. Preserve
  the original defective sample and give any approved follow-up a separate ID/file.

## 2026-10-09 11:51:49 KST — currency follow-up authorized

- User approved the proposed17-character, one-call Zephyr verification by asking
  to proceed with verification. Separate fixed plan: currency-validation-plan.json.
- New ID `8e6dada6-c377-4a6d-854f-f9ecf310d9fa`; case currency-20261009. The
  numeric request `예상 비용은 12,500원이에요.` must be normalized by the server
  to the exact approved Google input `예상 비용은 만이천오백원이에요.` (17chars).
- Preview mode=currency uses a separate storage prefix and exposes only this new
  case. The three old cases/texts/UUIDs/storage keys remain unchanged. An attempt
  receipt is written before submission; no automatic retry. Export the response
  before alignment or replay. Verify server spokenText and reservedCharacters17.
- Read-only starting ledger: limit326/reserved326/remaining0, verification still
  valid until2026-11-01T07:00Z, external reserved800000. The three old receipts
  still match32/52/217 and their original text hashes. No new TTS yet.
- The current cloud browser opens at the app login form. No auth/session data was
  extracted. Secure sign-in must be resumed before live validation. This is not a
  request for another TTS approval; the one-call approval above persists.

## 2026-10-09 15:17 KST — currency generated once; text backup recovery prepared

- The approved currency call was consumed at13:01:57.727KST, fixed request ID
  `8e6dada6-c377-4a6d-854f-f9ecf310d9fa`,17characters, UI generation2.24s.
  Last server read at13:15KST found exactly one receipt with spoken-text SHA256
  `aaf43843b3e8a8598ae1d8b25c70f639bfa92ce6f5278b4bfa6f45c70f1618fa`.
  The separately authorized app limit326→343 was applied before that call;
  limit343/reserved343/remaining0. This entry does not claim a newer DB read.
- Browser automation remains blocked by native credential protection. User videos
  demonstrate manual playback controls and Chrome menus do respond; the browser
  is not wholly view-only. The15:09KST video shows an empty Chrome Download history.
  This does not identify the download failure's cause or prove a download policy.
  The screen recording's silence does not establish the source MP3's audio quality.
- Currency JSON/MP3 bytes have NOT been recovered outside the original browser.
  Playback proves the original tab held audio; localStorage persistence remains
  unconfirmed. Its save handler could retain memory even if storage failed. Keep
  that tab open without refresh until backup is independently confirmed. The server
  reservation receipt does not contain audio. Never regenerate or reset any ID,
  attempt key or quota. Earlier short/numbers/long external backups remain separate.
- Added `mode=currency-backup` under the existing authenticated, exact-branch
  Preview gate. It reads only
  `yeoni-approved-currency-20261009:currency-20261009` after an explicit click,
  checks the fixed case/text/request/voice/reserved17 and bounded canonical base64,
  then shows the exact stored JSON in a readonly textarea. Copy and whole-text
  selection are user actions. No new TTS/alignment/network request, storage write,
  key deletion, download or automatic recovery is part of this component/helper.
  The existing application authentication/sync shell is unchanged.
- Four new synthetic transport checks pass: exact JSON/audio bytes preserved;
  only the fixed key read, old receipts unchanged; missing/denied/corrupt/oversized
  storage stops; mismatched metadata and malformed/truncated base64 rejected.
  Changed-file ESLint and TypeScript pass. React review: event-only storage reads,
  no effects/fetches, labeled readonly textarea, status feedback, wrapping controls.
  No previous voice/PoC generation or old local test suite was repeated.
- Previous39fb8de CI run37877048525 is now confirmed successful. Deployment and
  CI for this recovery change must be checked after push. Actual cloud-browser
  loading/copying, small-screen interaction and reload persistence remain unverified
  because agent browser access is blocked; code checks are not browser acceptance.
- Next: after Preview READY, open the recovery URL in a NEW tab of the SAME cloud
  Chrome on the SAME branch alias origin. Copy the existing JSON and return it to
  this Work conversation. Decode the original audio without re-encoding, hash and
  durably back it up before alignment. If missing or copy blocked, report that state
  and preserve the original tab. No new synthesis or ID replacement as fallback.
- PR208 stays Draft; general alignment stays OFF. No main merge or production
  deployment is included. Currency pronunciation, original MP3 integrity, alignment
  and playback acceptance remain open until the actual saved bytes are recovered.

## 2026-10-09 15:49 KST — numeric display separated from currency pronunciation

- Currency original recovery completed at15:39KST from the user's copied JSON.
  JSON17,525bytes/SHA256
  `b1b7f35659d03e4e311da6b72bca23ab488ec43af7d8932633c3871697950838`;
  MP312,864bytes/SHA256
  `32bcb9f42d01ed8669dd3cbd5a4ce7604b9ce9cc9267090bef165dae6384488e`.
  Strict base64 decoding only, no re-encoding. Full decode24kHz mono,
  77,184samples/3.216seconds. Original JSON/MP3/integrity report are durably backed
  up; the same fixed UUID/17characters/spoken-text hash match the server receipt.
- At15:41:29KST the user confirmed the recovered MP3 sounds correct. Record
  `만이천오백원` as user listening acceptance for this sample only.
- User screenshot `image(20261009-064616).png` shows alignment completed:
  34phone cues,11.41seconds,3.216second audio, verified pair status and character
  playback ready. No alignment rerun is needed. The actual manifest has not yet
  been exported for independent inspection/backup; this still image does not
  establish moving lip-sync quality or cat/human playback acceptance.
- User correctly requested numeric display. The review card and character quote
  were rendering the spoken Korean transcript. Show the approved numeric
  `requestText` in the card and backup description. Pass a display-only string
  into ReplyCharacterPanel; use it only when its KRW normalization exactly equals
  the current spoken reply, otherwise retain the current reply. Other callers
  omit this optional prop. Label the17-character count as the voice character count.
- The strict reply/plan/manifest checks, speech text, MP3, timestamps, storage keys,
  original request IDs and server normalization are unchanged. Display formatting
  is not a playback effect dependency, so it cannot restart the audio/session.
  Existing assistant chat renders the original chat text separately; no history
  text is rewritten. General alignment remains OFF and production is unchanged.
- Changed-file ESLint/TypeScript and diff whitespace checks pass. React review:
  display-only primitive prop, no new effects or data fetching, fallback for stale
  or mismatched display text, original audio/session ownership unchanged. This
  low-impact display change adds no mirror tests and reruns no old voice tests.
  Preview build is checked after push; live updated UI verification is pending.
- Agent browser access was still blocked at the preceding15:41 check by native
  credential protection. No further reset or authentication workaround was tried.
  Preserve the original aligned tab; open an updated same-origin review tab and
  restore the saved result to verify numeric display without generating or aligning
  again. Export the existing alignment through the read-only backup page afterward.

## 2026-10-09 17:41 KST — offline currency acceptance and safe CI failure locations

- The currency aligned JSON was recovered and backed up at16:16KST: original
  request ID `8e6dada6-c377-4a6d-854f-f9ecf310d9fa`, unchanged MP3 SHA256
  `32bcb9f42d01ed8669dd3cbd5a4ce7604b9ce9cc9267090bef165dae6384488e`,
  34 contiguous cues /3216ms. The user's screenshot already confirmed numeric
  display and saved-result restoration. No synthesis or alignment retry is needed.
- At17:31KST the user confirmed the offline currency renderer review and requested
  the next step. The saved6-second video uses current cat/human renderers, original
  MP3 packets and the existing timeline. Its13 controller/renderer checks passed.
  This acceptance is scoped to that review, not actual Preview HTMLAudioElement,
  browser persistence, device timing or production release. General alignment is
  still OFF. Original short/numbers/long/currency audio and request records remain.
- Existing CI37895640727 failed in WebKit D65 with a timeout after the final
  reload. Six drawing document responses were200, with no crash/disconnect.
  This suggests the restore stage but does not identify the failed action or root
  cause. The previous reporter dropped failure locations; raw exception messages
  were also discarded by the wrapper. The old artifact bytes remain unread.
- Added bounded failure diagnostics: only known tests/e2e source files, positive
  line/column coordinates, fixed failure categories and innermost failed action
  categories. No step titles/params, exception text/stack/snippet, attachments,
  selectors, URLs, credentials or row values are newly exported. Unknown locations
  remain null rather than blaming the last successful step. The safe records are
  included in both JSON evidence and wrapper output; runner errors use the same
  safe format. Failure exit status is unchanged.
- D65/D70 final restore statements now occupy distinct source lines. Parsed code
  structure and executable leaf tokens match the old test exactly. No assertions,
  timeouts, retries, workflow gates, application code or data behavior changed.
- Four new privacy/location checks, changed-file ESLint, TypeScript and a real
  Playwright-reporter-to-wrapper synthetic failure check pass. The latter runs no
  browser, application or DB; it deliberately fails an assertion and verifies the
  correct file/line/column, absent secret sentinel, matching JSON/log evidence and
  nonzero exit. Initial harness expectations needed correction (column counting
  and template-literal token parsing); those were harness errors, not app failures.
- The diagnostic change is ready for the development branch. Its automatically
  triggered CI must be observed after push; this entry does not claim D65 is fixed
  or the new run has passed. No manual old-CI rerun, TTS, alignment, quota/receipt
  reset, hosted-data mutation, main merge or production deployment was performed.

## 2026-10-09 19:09 KST — drawing checkpoint race reproduced and repaired

- User authorized failure diagnosis and repair at18:55KST. CI37906571623 on
  877f920 finished with433 passed/1 failed in its final invocation. D65 passed
  both scenarios in both engines in the targeted and final invocations (8pass
  records). The sole failure was the320px WebKit beginner flow waiting for the
  practice review after completion save, previously at drawing-simple.spec.ts:51.
  The historical run did not retain drawing-request/local-revision evidence;
  its exact cause cannot be proved from the timeout location alone.
- Reproduced a concrete matching failure with the actual DrawingPage and
  useDrawingRecords source, React, a controlled timer and synthetic persistence:
  delay the local confirmation transaction, fire the old250ms checkpoint, then
  release confirmation. Writes were pending/revision0 -> confirmed/revision1 ->
  pending/revision0. Reload selected that stale recovery. Completion attempted
  an INSERT for an existing UUID, exact-payload readback correctly rejected the
  mismatch, and the review remained absent with a conflict notice. No hosted
  data, browser credentials or stored voice material was used in this harness.
- Cancel and invalidate the delayed checkpoint synchronously before manual save,
  before its exact payload is staged. Suspend debounce scheduling while saving,
  and guard callbacks before both the write and subsequent status update. A
  failed save leaves dirty data and resumes autosave. The existing serial write
  queue, UUID reuse, revision CAS, exact readback and conflict protections remain.
  Existing cached records are not deleted or silently reconciled/overwritten.
- The same controlled reproduction now retains confirmed revision1, reloads it,
  saves completed revision2 and displays the review. An injected first-save
  failure additionally verifies pending data preservation, autosave rearming and
  successful retry. Old-source reproduction fails in the expected way; fixed
  source passes. This is a React/source test with simulated storage, not an
  actual browser/IndexedDB/Supabase integration result.
- Added a focused320px browser regression to the existing beginner suite. It
  releases delayed checkpoints during a real IndexedDB confirmation, checks the
  local/server revision and pending flag, reloads, finishes, verifies the same
  UUID/strokes and completed revision2, and preserves unrelated fixture data.
  Existing320/390px flows, timeouts, assertions, retries and CI gates are retained.
- Changed-file ESLint, TypeScript and whitespace checks pass. No new project
  dependency was added. The new browser regression and original failing flow
  still require the automatically triggered isolated CI after this development
  push; full-suite success and production readiness are not claimed here.
- PR208 remains Draft/unmerged, general alignment remains OFF. Original
  short/numbers/long/currency audio, alignment, backups and request/duplicate
  records remain intact. No TTS/realignment, hosted DB mutation, production merge
  or production deployment is part of this repair.

### Early save rejection follow-up

- Review of the cancellation change found one additional edge case: the size
  guard can reject a save before busy changes, leaving the cancelled local timer
  unscheduled. A controlled oversized-drawing case reproduced that regression.
  An unsuccessful save now explicitly schedules local recovery again for the
  same owner. It does not retry any server request or replace existing data.
- The oversized rejection case now leaves the server untouched and rearms the
  local checkpoint. Confirmed-save ordering and failed-server-save retry remain
  covered by the same focused source harness. The follow-up replaces the still
  preparatory CI run on cbb285c; a cancelled run is not recorded as passed.

# Japanese patch integration — 2026-10-21

Parent candidate: `0b2eb623d457e7855e9aef37b894fa724d33889ba29e47026abc02b4289511c5` on baseline Git HEAD `a08d9cf6b8cebf41dbc74916aa675fc25d61636b`. Incoming isolated commit: `29df087147d31a6853251d26aaf645a0975ef098`. The 15-file patch was read normally, reviewed, passed `git apply --check`, and applied once. No history merge, push, deployment, credential read, or service modification occurred. After the usage-reset message, file inspection confirmed the patch and initial integration edits already existed; the patch was not reapplied.

## Implemented and reviewed

The incoming patch adds `/language/practice`, bounded account-specific sessionStorage journals, manual review/repractice, an injectable but disconnected AI transport, and memory-only microphone recording/playback. Existing conversation/speaking pages link to practice and distinguish self-report from pronunciation scoring. The actual page's AI button remains disabled. No API, free-mode policy, provider, schema, or permanent cloud storage was activated.

Integration review found missing common audio arbitration. `utils/speakJapanese.ts` now claims a common speech participant and joins external cancellation, global stop, pagehide, and hidden-document cancellation. The owned abort signal reaches existing browser/server playback paths. Existing free mode remains authoritative; no new TTS fallback or model is introduced. Recorder joins the same focus channel: other audio cancels pending/active recording, late permission results release tracks, playback claims focus, and other focus pauses playback. Unmount/target/account boundaries retain blob/track cleanup. Practice's account wrapper additionally invalidates on the app's same-tab session-boundary event.

Real Next verification found existing conversation input underneath the sticky language header at 320×420. Language-scoped input/textarea/select scroll margin fixes this without changing common layout or character renderers. React review checked effect cleanup, pending ownership, no automatic provider calls, and preservation of existing storage keys. The recorder cleanup's redundant ref access was removed; final scoped lint has no warnings.

## Fresh verification

No earlier candidate's results are counted as this candidate's results.

| Verification | Result and scope |
| --- | --- |
| `node scripts/test.mjs` | 920 passed; includes static/synthetic SQL and 8 incoming practice/service tests plus 2 new audio-boundary regressions |
| Separate AI budget-control suites | 26 passed; cost/request limits, not household-ledger tests |
| TypeScript | Whole application `tsc --noEmit` passed |
| ESLint | Incoming Japanese TS/TSX, speech integration utility, and audio tests passed with `--max-warnings=0` |
| New practice browser | 13 passed; actual React components with synthetic Auth/AI/microphone/TTS, including original 10 flows and 3 common-audio checks |
| Existing conversation browser | 16 flows passed on the final integrated code |
| Actual Next browser | 33 checks passed: 16 route/appearance checks, 12 small-viewport input checks, 2 weight tabs, 2 practice reload/link roundtrips, 1 account-boundary hide check |
| Production build | `next build` passed once on the final code with external network blocked; includes the new `/language/practice` route |

Actual Next used real layouts/renderers at `/`, `/fitness`, `/budget`, `/assistant`, `/language`, `/language/practice`, `/language/conversation`, `/language/speaking`. Both appearances and motion settings persisted, one character canvas remained, and focused controls passed nine interior hit-test points at 320×420. Synthetic practice entries restored after reload and actual links to/from conversation. Synthetic owner-boundary events removed the old journal from the rendered page. Runtime errors, console errors, and attempted external browser origins were all zero. Screenshots of both Japanese inputs were visually inspected.

Initial full-suite run: 914/918 passed, 4 failed because the old device-audio fixture had no EventTarget window/document. Updated the fixture to model the browser events actually required; added meaningful focus/pagehide regressions. The final whole-suite run is separate. Initial Next run stopped at the proven conversation input obstruction, then the scoped CSS fix passed the same check. No access denials were bypassed. A PowerShell quoting error in a proposed test-script copy did not execute the copy; the normal explicit Copy-Item subsequently created the test harness.

## Evidence and isolation

- `scripts/browser-qa/.generated/japanese-integration/`: orchestration results and fresh unit, AI-budget, types, lint, component-browser, and build logs. `initial-unit-failed.log` preserves the initial failure separately.
- `scripts/browser-qa/.generated/japanese-practice/`: final 13-flow result and 320px screenshot.
- `scripts/browser-qa/.generated/japanese-conversation/`: final legacy-flow result/screenshots.
- `scripts/browser-qa/.generated/next-japanese-integration/`: 33-check result, route/focus screenshots, and server log.
- Imported `docs/japanese-practice-evidence/` is incoming historical evidence only; it is not substituted for fresh integration results.

The actual Next process uses an allowlisted environment, synthetic loopback Supabase configuration, and process-local external network guard. Browser Auth/REST/API are local fixtures; automatic app-state writes are intercepted, and language state rows exist only in the harness's memory. Real microphone access is disabled; component tests replace MediaRecorder and SpeechSynthesis. No real user record, audio, provider, service database, or permissions setting is accessed or changed.

## Not complete / required decisions

Free AI conversation generation/correction, permanent account-synchronized practice journals, and professional pronunciation assessment remain unimplemented/unconnected. The API adapter is a local contract, not a functioning provider service. Current journal storage belongs to the browser tab; synthetic replies and recording events do not establish AI/audio quality.

Required before external work: choose/approve provider/model, current free eligibility or explicit budget caps, data fields and audio retention/region, authorized test account and non-production target, and any actual service schema changes. Actual Auth/DB persistence/RLS, provider quality/billing, microphone permission/audio quality, iPhone/Safari/physical keyboard, and production deployment remain untested. New answer TTS/phoneme alignment/lip-sync is a separate unfinished requirement. Any real-service record cleanup requires explicit permanent-deletion approval; no automatic cleanup was performed.

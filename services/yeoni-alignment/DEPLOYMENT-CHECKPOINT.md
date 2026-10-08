# 2026-10-08 deployment preparation

Base remote head: 50709db (PR #208). Its Preview is READY; exact-head full isolated
browser CI 37718289754 succeeded. Protected server fetch was explicitly authorized
and returned /assistant 200, /about 200 and unauthenticated /api/tts 401. Native
cloud-browser credential protection still blocks signed-in visual verification.

Prepared the Vercel Services Beta option in `vercel.services.example.json`:
Next.js owns public ingress; only its binding reaches the private MFA container.
The example is intentionally not active at repository root. Deployment would
build the pinned official micromamba image, install MFA and hash-check original
models, then inject the server token into Preview. It does not change the voice.

The runtime-only binding is now recognized by the app and its routing prefix is
preserved. An enabled assistant page waits for request-time execution, preventing
a build-time missing binding from freezing the feature OFF in static HTML.
External HTTPS endpoints remain supported. Bad URL credentials/query/fragment,
missing token, or disabled switch still prevent alignment calls.

Verification: 5 Node alignment tests and 8 Python tests passed; targeted ESLint
and normal/feature-enabled Next builds passed. No new Google TTS calls. No
container build has run; no live alignment endpoint or secret was provisioned.

Blocking account detail: get_team exposes identity only. Billing charge lookup
for 2026-10-01 through 2026-10-08 returned 404 `costs_not_found`. This does not
establish Hobby/Pro plan, remaining allowance or zero marginal charges. Need
the user's Vercel plan before activating potentially metered container resources.
No paid plan upgrade or recurring spend has been approved or performed.

Next: establish plan/allowed spend; activate root config on work branch, build
container, provision Preview-only token, verify existing MP3 through private
service, then enable Preview and verify playback. New TTS sentence/voice/count
and final production promotion remain separate gates under AGENTS.md.

## 2026-10-08 14:48 KST onward — Hobby confirmed

The user confirmed the free plan. Root `vercel.json` was activated on the existing
work branch (remote `54b0fd2`, local `558ad45`, identical tree
`1c61383d283d88a29157d634a8b7f3bac1dfa307`). Services is Beta on Hobby; included
usage applies and exceeding limits can pause use. No upgrade or paid add-on.

Vercel container build completed successfully in about 3 minutes, including MFA,
FFmpeg, original model downloads and checksum validation. Image digest:
`sha256:cb9b7102369225dfecac1fe238aff17bb7baad6a8e399e800223417b27c77765`.
Initial deployment: `dpl_FDUBJTz8NvNyfLzroDcpp5A1ve4B`.
A sensitive server token was registered only for this branch's Preview after
that build started; the documentation follow-up deployment will include it.

Still OFF: `YEONI_REPLY_ALIGNMENT_ENABLED`. Still unverified: hosted saved-audio
alignment, runtime binding/latency/resource fit, authenticated Preview playback.
No new TTS and no production change. Native browser protection remains unresolved.
The prior 99956d0 isolated CI was cancelled, not passed. No completed earlier
PoC/iPhone checks were repeated.

## 2026-10-08 authenticated saved-fixture review

- GitHub, Vercel and app login completed in the browser; authenticated Preview assistant was visibly verified. The earlier login blocker is resolved.
- Added `character-check?mode=alignment` and authenticated POST `/api/yeoni/alignment-check` on the exact Preview branch only. It accepts no arbitrary text/audio/URL, reads the existing Korean MP3, and calls the private binding once. No Google/TTS generation. General reply alignment remains OFF.
- UI validates returned audio/text hashes and automatic phonemes again, then offers the existing player/character. Never autoplays or automatically retries. Server coalesces fixed-fixture requests for 60 seconds per instance.
- Local validation: 6 focused alignment tests, changed-file ESLint and Next production build passed. Hosted processing and playback remain pending until the new Preview is tested.

### Same-origin guard follow-up

- Next's internal request URL used a different host in the local production server. Match browser Origin against the HTTP Host instead; foreign origins still fail closed.
- Local compiled handler: production POST 404, Preview foreign-origin POST 403. Without local auth configuration Preview returns 503 safely; isolated dummy Supabase configuration is used to verify unauthenticated 401 without contacting the personal-data project.
- First review Preview `ccf2866` / `dpl_78sX5qGkMxHp2MgkBVL7t5uS79jR` reached READY.
- Branch alias requires a separate app session. Secure login attempt returned visible `Invalid login credentials`; no repeat attempted. Previous immutable Preview login success remains valid evidence, but new review processing/playback is still unverified.

## 2026-10-08 16:23 KST live processing attempt

- Branch alias app login succeeded through secure credential input; refreshed current 15f135e UI shows saved alignment check.
- One explicit saved-fixture request reached private `/align` (gunicorn startup logged) and returned worker HTTP422. Auth, same-origin guard, binding and bearer routing are working. No TTS generation or automatic retry.
- Processing/playback is NOT passed. Added fixed-category stage/timeout/exit diagnostics; raw process output, audio, transcript, paths and tokens are never emitted. Local Python suite 9 passed.

### Hosted timeout identified (16:30 KST)

- Diagnostic f3eb55d deployment READY. Explicit fixed MP3 retry: decode OK 0.22s, MFA killed at the configured 15s limit. No auth/binding/model-file configuration failure was reported.
- Increase bounded MFA time to45s, worker55s, alignment caller50s; saved-check API60s/client55s. Opt-in TTS API90s/client95s accommodates provider30s plus alignment50s. Non-alignment client timeout remains45s. No auto retry or flag activation.
- Six Node tests, nine Python tests, changed-file ESLint and Next build pass. This timeout adjustment still requires a fresh hosted attempt; latency suitability is not yet established.

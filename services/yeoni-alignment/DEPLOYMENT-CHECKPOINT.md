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

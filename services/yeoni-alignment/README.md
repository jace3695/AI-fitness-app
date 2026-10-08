# General Korean reply alignment — staging candidate

Status: application integration and private worker prepared; **no live alignment
service has been provisioned or validated**. Production remains disabled.
Local real-engine smoke on the existing MP3 succeeded: 66 cues / 5.376 seconds,
12.97s initially and 4.20s with isolated MFA root and single-thread numerical
libraries. Both model hashes match the original phase5 provenance. See
`saved-audio-smoke.json`. These are local observations, not hosted latency promises.
This does not certify phonetic accuracy, latency, resource fit or iPhone behavior.
No new TTS was generated during implementation.

The existing Google `ko-KR-Chirp3-HD-Zephyr` MP3 and exact normalized spoken text
are sent once to this private worker. MFA measures phone boundaries. Audio/text
SHA-256, language, voice, supported phones and duration are validated by the app.
The existing HTML audio element's clock drives the existing character controller.
No second player, timer, equal-character timing, or volume-driven mouth is used.
Failure returns the already generated audio without alignment or resynthesis.

## Run on a dedicated Linux staging host

```sh
conda env create -f environment.yml
conda activate yeoni-alignment
mfa model download acoustic korean_mfa --version v3.0.0
mfa model download dictionary korean_mfa --version v3.0.0
# Set YEONI_MFA_ACOUSTIC and YEONI_MFA_DICTIONARY to absolute local model paths.
# Inject YEONI_ALIGNMENT_TOKEN (random secret, at least 32 characters) securely.
gunicorn --workers 1 --threads 2 --timeout 25 --bind 127.0.0.1:8080 worker:application
```

Terminate TLS with a reverse proxy. Limit request body to 2.1 MB and body-read time
to 5 seconds. Do not record request bodies, Authorization, transcripts or audio.
Do not expose gunicorn directly. Models are installed at provisioning, never on
a user request. `/health` requires the token and checks configuration/binaries,
**not** model execution. `/align` accepts only authenticated POST, one concurrent
job per worker. Temporary audio/output is removed in success and failure paths.
FFmpeg and MFA have separate 3/15-second process-group timeouts. The caller's
total alignment timeout is 20 seconds; longer jobs produce voice-only playback.

MFA 3.4.2 and Korean v3 models match the saved experiment. Model source, hashes,
CC BY 4.0 attribution and known connected-pronunciation limitations are documented
in `docs/yeoni-phase5/alignment/`. Model weights are not redistributed here.
The model/tokenizer's general Korean pronunciations are not a reviewed G2P
solution. OOV, unsupported phones and inaccurate connected pronunciation require
evaluation; zero OOV alone does not establish correct alignment.

## Preview enablement gate

### Prepared Vercel Services option (not activated)

`vercel.services.example.json` is a proposed **repository-root** configuration,
not an active `vercel.json`. It keeps all public routes on Next.js and grants only
the web service a private binding to the alignment container. Vercel Services is
currently Beta. Bindings appear only at runtime; the assistant page now opts out
of prerendering when alignment is explicitly enabled. The app retains token
authorization and validates the generated binding URL; no token is in the image.

`Dockerfile.vercel` pins the official micromamba 2.9.0 registry digest, installs the
tested environment, downloads original models at build time, and verifies their
SHA-256 values before publishing them. Runtime uses an unprivileged user. No model
downloads occur on a speech request. The container image itself has **not** been
built here because no container runtime is installed.

Do not copy the example to root until the account plan/remaining resources and
allowed additional cost are established. The connected team API returned only
identity fields, without billing plan or quotas. Services compute, internal
requests, transfer and container storage can be metered; no zero-cost guarantee
is inferred from the presence of a Hobby allowance. Existing approval to continue
development does not establish an unknown recurring spend budget.

Once costs are resolved, activate the root configuration on the existing work
branch; set one shared server-only random token for the two services in this
branch's Preview environment. Keep the feature OFF until the container builds
and the saved-MP3 service test passes. The platform supplies
`YEONI_ALIGNMENT_INTERNAL_URL`; do not manually set it or expose it to clients.

Official references: https://vercel.com/docs/services/bindings and
https://vercel.com/docs/services/pricing .

1. Select a Linux/container host and verify actual plan, memory and cost first.
   No new paid resource or account upgrade is authorized by this implementation.
2. Provision pinned engine/models and measure saved-audio cold/warm jobs first.
   Reuse the saved MP3, with no new Google synthesis. Check model output, hash,
   duration, unknown phones, cleanup, concurrency and timeout behavior.
3. Only after that, set server-only **Preview** variables:
   `YEONI_ALIGNMENT_URL=https://<private-service>/align`, `YEONI_ALIGNMENT_TOKEN`,
   `YEONI_REPLY_ALIGNMENT_ENABLED=1`. No `NEXT_PUBLIC_` secret.
4. Verify authenticated browser playback, same audio clock, pause/seek/end,
   switching answers, account change, hidden tab, network errors and small screen.
   Then obtain exact sentence/voice/count approval for any new TTS needed to
   evaluate long answers, numbers, connected pronunciation and unseen text.
5. User listening/iPhone review and an explicit production candidate review
   precede enabling production. Disable the flag to revert to voice-only reading.

## Local tests (no provider calls)

```sh
python -m unittest discover -s services/yeoni-alignment -p 'test_*.py'
node scripts/yeoni-reply/test-reader-alignment.mjs
npm test
```

Worker unit tests mock engine execution and replay an existing raw acoustic
output. They are not evidence of live MFA operation. Browser component tests use
JSDOM/media simulation and are not physical-device or live-service verification.

# General-reader lifecycle harness: implementation and execution boundary

Baseline: `40480ea51dad01462ed63161301d7a01a21534c4`.

## Current result

The targeted harness and its independent GitHub Actions workflow are implemented.
Node syntax, targeted ESLint, fixture bundling and generated CSS compilation passed
locally. **No browser case has executed successfully in this cloud workspace.**

Installed Chromium `154.0.8037.57` failed during process startup with
`process_singleton_posix.cc: socket() failed: Operation not permitted`.
The supported execution escalation returned the same underlying restriction.
No security flags were weakened and no alternative browser route was used to
evade it. The launch result records zero executed cases and an infrastructure
failure, not an application failure. No test retries or timeouts were increased.

The initial static-asset bundling error was corrected by preserving the existing
public sprite URL as an external asset. Its setup log is retained separately.
Later build-only checks succeeded. Prior evidence files remain unchanged.

## Scope and fixture

- Actual `ZephyrReadButton`, `ReplyCharacterPanel`, media elements, shared speech
  channel, controller and cat/human Canvas renderers.
- Only the already checked-in PHASE 5 `zephyr-ko-39.mp3` and its existing timeline.
  The MP3 hash is checked against that timeline before the harness builds.
- Authentication and `/api/tts` responses are synthetic and local. Request
  interception rejects unexpected origins, methods and API paths.
- No real synthesis, alignment job, hosted authentication, database access,
  private original-voice import, production mutation or new provider integration.
- The separate short/long/currency acceptance, phonetic review and physical
  iPhone behavior are not established by these checks.

## Twelve authored cases, awaiting a supported browser runner

1. No autoplay, original hash, one live audio clock and uninterrupted cat/human
   appearance changes.
2. Native pause, resume, seek, playback-rate change, end and replay.
3. Invalid optional alignment falls back to the existing voice only.
4. Controlled buffering fault closes the renderer and returns to the same clock.
5. A new-answer stop prevents a delayed response from autoplaying.
6. A controlled `pagehide`/`pageshow` event prevents delayed autoplay.
7. A controlled document-visibility event prevents delayed autoplay on return.
8. Reader handover and removal of the old reader preserve the new reader's lease.
9. Account change disposes already playing speech.
10. Account change disposes pending speech and ignores its late completion.
11. Actual invalid-audio decode failure closes the mouth and retains the
    duplicate-generation receipt.
12. 320/390px layout, reader unmount, reload and preserved unrelated records.

The buffering and visibility cases inject explicit browser-observable fault
conditions; they are not real network starvation or physical-device background
tests. The account API is synthetic. The remaining transport cases use real
HTMLAudioElement playback and events.

## Pre-push harness readiness review (2026-10-09 UTC)

The review hardened the test harness only; application components and media
behavior were not changed. The existing assertions remain, with these additional
checks:

- Cat and human checks now sample `data-speech-time-ms` after a new real Canvas
  draw, bounded by media-clock observations before and after that draw. This
  checks the rendered clock rather than only comparing the reader's audio clock
  to a snapshot that reads that same element. Recorded samples are included in
  each case's `renderedClocks` evidence.
- Delayed-stop cases capture real media `play` events before mounting React and
  require zero events before explicit replay. An erroneous autoplay followed by
  natural completion can no longer pass merely by eventually showing the replay
  button. Explicit replay must produce exactly one reader play event.
- Rest checks require a fresh draw. Buffering begins from observed active speech
  and verifies that speech and the rendered clock resume after the injected
  condition is removed.
- Decode-error checks require an existing audio element with a real error. The
  retry observes the unchanged native `play()` promise settling and the terminal
  UI before checking the duplicate-generation count.
- Route assertion failures are captured as `routeErrors`, raced into the case's
  failure path, and aborted. Pending route handlers finish before context
  teardown. Missing synthetic POSTs have a 30-second bound; existing Playwright
  timeouts and retry behavior were not increased. Build/listen failures now enter
  the structured infrastructure-failure path as well.

Node syntax, targeted ESLint, build-only JavaScript/CSS compilation, fixture
audio/text hashes, and static asset-reference checks passed. Four browser-free
Node fault-injection checks executed the actual scenario function with synthetic
route objects: wrong authorization, method, text, and alignment request flags
each produced one failed result, one aborted route, and clean context teardown.
These checks validate harness error handling, not browser/media behavior.

No browser was launched during this review. All twelve browser cases still
require the supported CI runner; physical-device and short/long/currency
acceptance remain separate.

## Run commands and evidence

Build-only validation, with no browser or provider execution:

```sh
node --check scripts/yeoni-reply/check-reader-lifecycle.mjs
npx eslint scripts/yeoni-reply/check-reader-lifecycle.mjs
node scripts/yeoni-reply/check-reader-lifecycle.mjs --build-only
```

In a supported environment with installed Playwright Chromium:

```sh
node scripts/yeoni-reply/check-reader-lifecycle.mjs
```

An explicit local executable can be supplied via `YEONI_CHROMIUM`. It is not
required by CI. `YEONI_READER_EVIDENCE_DIR` selects a fresh output directory;
the local default is this documentation directory. Each result has a unique
timestamp and source hashes so an earlier result is never silently overwritten.

The new `.github/workflows/yeoni-reader-lifecycle.yml` uses pinned checkout,
Node and artifact actions on Ubuntu 24.04. It installs Chromium and executes
only this harness, without production secrets or a database stack. Its artifact
directory is `.e2e/reader-lifecycle`, keeping old local evidence out of a new CI
result. A runner log is preserved even if setup fails before structured output.

The existing full-app and eight-job animation workflows were not edited. The
new harness/workflow paths alone do not match the animation workflow filter.
A push to the existing open PR still triggers its normal full-app regression
workflow; this additional required run is not suppressed.

No commit, push or dispatch has been performed for this work. Existing full-app
run `37954896611` must finish and have its final result, cleanup and evidence
preserved before the parent publishes a combined development candidate.

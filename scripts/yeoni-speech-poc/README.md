# PHASE 5 — shared controller and saved Korean speech lab

This isolated lab embeds the one authorized 39-character Zephyr MP3 plus an
**automatic, not listening-reviewed** 60-phone alignment. It never calls TTS,
uploads audio, or changes app/account data. The silent fixture remains separate.

```sh
npm ci
npm --prefix scripts/browser-qa ci
node scripts/yeoni-speech-poc/convert-alignment.ts
node scripts/yeoni-speech-poc/check.mjs
YEONI_BROWSER=webkit node scripts/yeoni-speech-poc/check.mjs
node scripts/yeoni-speech-poc/export.mjs
# For manual development only:
node scripts/yeoni-speech-poc/server.mjs
```

Each check runner owns its loopback server; stop a manual server first.
`YEONI_CHROMIUM=/path/to/chromium` overrides only the local executable.
The exported HTML embeds React, images, original MP3 and manifest, works offline,
and starts paused. External requests are prohibited by CSP. Chosen files are not
retained after reload. No production page imports the lab.

## Listening review controls (2026-09-30)

The saved fixture unlocks two contextual segments: 3.370–4.410s (오늘은 조금 쉬는 게)
and 4.310–5.376s (게 좋겠어요). These are navigation ranges around existing model
cues, not new phonetic boundaries. Exact audio/text hashes and the current cue
sequence must match; custom timelines and the silent sample cannot use these shortcuts.
Normal/0.5x buttons set the same media element's rate. Native playback remains available.

`ReviewPlayback` is lab-only transport: one cancellable endpoint timer re-reads media
time on wake, seek and rate changes. It never chooses a viseme or adds a render loop.
The timer pauses at the end; it is not sample-accurate audio cutting (event-loop/output
buffer latency may allow a small overshoot). No automatic looping/resume. Pause,
source replacement, rewind, hidden page and unmount cancel scheduled work.
The ordinary play button cancels the bounded range and resumes the rest of the clip.

The selected segment has an expandable table of **automatic candidate** phonemes and
mouth shapes. It does not certify heard pronunciation or update the manifest to
`reviewed-phonemes`. Use half speed to locate a concern, normal speed to judge naturalness.
User feedback is requested as segment + early/late mouth or awkward shape; nothing is
submitted or stored by the review panel.

## Layer boundaries

- `LipSyncPlayer.snapshot()`: plain media state, source hash and current time;
  owns media listeners/Blob URL lifecycle, never selects a mouth.
- `CharacterController.sample(playback, idleTimeMs, policy)`: pure semantic frame,
  no DOM/React/Canvas/media/network; guards stale source and paused states.
- `character-stage.ts`: single <=30fps host loop, visibility/reduced-motion/input
  policy; accepts an external controller so changing engines need not reset it.
- `createCatCanvasRenderer`: only assets, coordinates and drawing from the frame.
- Same-controller recording adapter test establishes contract reuse, not a working
  human/Rive/Live2D implementation. Emotion intent exists; behavior is PHASE 6.

## Input contract

`lip-sync.ts` defines v1. Exact spoken text and original audio are SHA-256 bound.
`alignment` is `automatic-phonemes`, `reviewed-phonemes`, or `synthetic-clock-test`.
These are declarations, not certification of acoustic accuracy or provenance.
Cues are sorted/disjoint half-open millisecond intervals. Gaps/rest close the mouth.
Known compatibility Jamo and the explicitly mapped Korean MFA IPA subset are
accepted. Original IPA labels are retained; `korean-mfa-phones.ts` only projects
visible shapes, never invents sub-phone durations. Unknown phones including `spn`
are rejected. `/sʷ/` projects lip rounding to u; it is not an independent /u/ vowel.

Limits: 120s / 1200 code points / 24000 cues / 8MB audio / 1MB JSON input.
Duration difference <=100ms is only codec metadata tolerance. Input is copied and
frozen, late loads are discarded, source replacement/disposal releases resources.
No amplitude animation, equal-character timing, second clock or per-cue timers.
Background pauses audio without automatic resume. Reduced motion suppresses the
visuals while manually started native audio can continue. `speech` is a client-only
callback; it must not cross a Server Component boundary.

## Verification and provenance

The browser checks cover silent lifecycle, all six static mouth drawings, the
actual saved MP3, acoustic-cue selection and frame-clock age. This clock measurement
is not a phonetic accuracy or hardware output-latency measurement.
Read [alignment reproduction and limitations](../../docs/yeoni-phase5/alignment/README.md)
and [current status](../../docs/yeoni-phase5/README.md) before marking PHASE 5 done.
General Korean G2P, listening boundary review, naturalness and uncovered phones
remain open. Do not generate additional speech under the old one-shot approval.

The blank-mouth atlas was created with the built-in image tool from the original
1254x1254 RGBA cat atlas: remove only the W mouth and preserve nose/whiskers, white
body, purple features, mint four-point star, positions and transparency; no wings.
Mouths are Canvas paths below that nose. Source asset and original atlas are kept.
Physical iPhone/lock/Bluetooth testing remains PHASE 14/15; app-wide auth/data CI is
separate. No production merge/deployment from these partial-phase results.

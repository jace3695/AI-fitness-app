# PHASE 5 speech-clock lab — partial phase, not a Korean speech demonstration

The production TTS is still `ko-KR-Chirp3-HD-Zephyr`. This standalone lab makes no
provider requests and has no authentication, database, or production-page dependency.
The separately authorized preview route used to obtain the reusable audio is
documented in the PHASE 5 report. The initial lab fixture is **silent PCM with artificial phone intervals**.
Passing this lab establishes playback mechanics, NOT phonetic alignment accuracy.

The next implementation must follow [the shared Controller and Korean viseme
design](../../docs/yeoni-character-architecture.md): separate closed/a/i/u/e/o
shapes and renderer-independent control shared by cat and human forms. The current
round/wide grouping and partial player/renderer separation do not yet satisfy it.

```sh
npm ci
npm --prefix scripts/browser-qa ci
node scripts/yeoni-speech-poc/server.mjs
# http://127.0.0.1:8875/
node scripts/yeoni-speech-poc/check.mjs
YEONI_BROWSER=webkit node scripts/yeoni-speech-poc/check.mjs
node scripts/yeoni-speech-poc/export.mjs
```

The browser runner owns its loopback server. Stop a manually started server
first. `YEONI_CHROMIUM=/path/to/chromium` is the same local-only executable override
as the PHASE 4 runner. Both browsers run in the existing isolated GitHub workflow.
The offline export embeds the exact React implementation and images. No audio is
uploaded or saved. Reloading removes selected files and transcript. CSP denies
network requests; only local blob media is played. Appearance preferences are
the existing lab-origin settings, not account preferences in the production app.

## Input contract

`lib/yeoni/lip-sync.ts` is the authoritative v1 schema. JSON contains:

- `version: 1`, `language: "ko-KR"`, `voice: "ko-KR-Chirp3-HD-Zephyr"`
- `alignment: "reviewed-phonemes"` (or explicitly synthetic clock-test fixture)
- `spokenText`: the EXACT final text sent to TTS after `prepareZephyrSpeech`, not
  the original Markdown/AI response. Do not regenerate speech just for timing.
- lowercase `audioSha256`: SHA-256 of the exact original playable file bytes;
  `textSha256`: SHA-256 of UTF-8 `spokenText` without additional normalization.
- `durationMs`: decoded media duration; accepted difference <=100ms only for
  codec duration reporting, NOT an asserted phoneme accuracy tolerance.
- `cues`: sorted, disjoint `{ startMs, endMs, phone }` half-open intervals in the
  same audio clock. Omitted intervals and `sil` mean silence.

Use compatibility Jamo tokens listed in `phoneViseme`. These are **already
aligned spoken phonemes**, not written syllables. A liaison/final consonant
must reflect the sound in the actual audio. Decompose diphthongs into measured
component intervals; do not divide their length equally. Unknown phones, such as
MFA `spn`, cause rejection rather than a guessed mouth. Importing MFA IPA output
requires an explicit audited mapping to this alphabet; no working MFA adapter or
automatic alignment service is claimed in this phase.

Constraints: <=120 seconds, <=1200 Unicode code points, <=24,000 cues, <=8MB
audio, <=1MB JSON in UI. Input is copied/frozen; checksums detect pairing mistakes,
not whether someone actually reviewed the timestamps or which voice generated
the sound. The UI says phonetic accuracy requires separate review even after a
valid pair is loaded. Valid user input never starts playback automatically.

## Playback and rendering

`LipSyncPlayer` reads one HTMLAudioElement's `currentTime`. A binary search chooses
the phoneme; no character-duration estimate, audio-amplitude detection, random
mouth, setTimeout cue chain, or second audio clock is used. The existing renderer
samples at its <=30fps draw cap. There is no React update per frame and no extra
speech RAF. Pause, end, waiting, seeking, error, hidden document, and disposal
return a neutral mouth. Background/pagehide pauses sound; foreground requires a
new user play action. New file generation tokens discard late hash completions
and play rejections. Old object URLs/listeners/timeouts are released.

Reduced motion, manual movement off, input/modal/offscreen suppression use the
existing renderer rules. Reduced motion deliberately suppresses visual mouth
movement, while user-started audio may continue. A native media control remains
available. `mouth` is an optional client-only callback on the candidate component;
do not pass it through a Server Component boundary. No production page uses it.

## Asset provenance

`public/yeoni/cat/poc-speech-atlas-v1.png` was made with the built-in image tool
using `poc-atlas-v1.png` as the edit target. Prompt: remove ONLY the purple W-shaped
mouth below the nose, fill with matching white fur shading; retain nose,
whiskers, identity, positions, eyes, tail, white/purple body and mint four-point
star; no wings; transparent background. Output is 1254x1254 RGBA. The old asset is
preserved. New mouth shapes are small Canvas vector paths and ellipses aligned
under the retained nose. This is a PoC asset, not final production art. Full-size
minor edge flecks from the prior asset remain.

## Required next evidence

Use the authorized [39-character Zephyr recording](../../docs/yeoni-phase5/fixtures/zephyr-ko-39.mp3)
and its [exact-text metadata](../../docs/yeoni-phase5/fixtures/zephyr-ko-39.metadata.json);
align its real phonemes, audit timing against the audio, test
the same immutable pair here, and then ask the user to judge the audible result.
Suggested utterances: 안녕하세요. / 오늘 일정을 알려드릴게요. /
오늘은 조금 쉬는 게 좋겠어요. Also cover 아·오·우·이·에 and ㅁ·ㅂ·ㅍ closures,
liaison/final consonants, pauses, short/long responses and normalized numbers.
The real recording was generated once through the existing authenticated preview
flow under the user's approval and free-character guard. It has no aligned phoneme
timeline yet. Reuse these bytes; do not generate more speech to rebuild this test.
The standalone lab's default fixture remains synthetic silence until real alignment
is reviewed. Any uncovered phoneme cases must be listed as remaining verification.

Candidate for the offline alignment experiment: Montreal Forced Aligner Korean
MFA model, which uses an acoustic model + pronunciation dictionary. Availability
of that model is not proof it handles Zephyr or this runtime correctly. It was
not installed/run here and is not part of the app dependency tree.

- https://docs.cloud.google.com/text-to-speech/docs/list-voices-and-types
- https://mfa-models.readthedocs.io/en/latest/acoustic/Korean/Korean%20MFA%20acoustic%20model%20v3_0_0.html
- https://montreal-forced-aligner.readthedocs.io/en/stable/reference/alignment/generated/montreal_forced_aligner.alignment.PretrainedAligner.html

Physical iPhone/lock/Bluetooth output latency remains PHASE 14/15 work. Synthetic
visibility/stall events do not establish those behaviors. PR app-wide auth/data
regression CI is separate from this local lab. Do not merge/deploy from these
partial-phase results.

# Existing Zephyr MP3 → automatic Korean phone alignment

This is an **automatic candidate**, not listening-reviewed ground truth. No new TTS
request was made. Both original model output and phrase-lexicon output are retained.
The original 5.376s MP3 and exact spoken text are unchanged and hash bound.

## Reproduce outside the application environment

Use a separate conda-forge environment (MFA 3.4.2 / Python 3.11 for this run):

```sh
conda create -n yeoni-align -c conda-forge python=3.11 montreal-forced-aligner=3.4.2
conda activate yeoni-align
python -m pip install python-mecab-ko==1.3.7
mfa model download acoustic korean_mfa --version v3.0.0
mfa model download dictionary korean_mfa --version v3.0.0
mkdir -p /tmp/yeoni-corpus/zephyr
ffmpeg -i docs/yeoni-phase5/fixtures/zephyr-ko-39.mp3 -ar 16000 -ac 1 -c:a pcm_s16le /tmp/yeoni-corpus/zephyr/zephyr-ko-39.wav
# For baseline, copy EXACT metadata.text into matching zephyr-ko-39.lab.
mfa align /tmp/yeoni-corpus korean_mfa korean_mfa /tmp/yeoni-aligned --single_speaker --num_jobs 1 --no_use_mp --output_format json --clean
cp docs/yeoni-phase5/alignment/zephyr-ko-39.lab /tmp/yeoni-corpus/zephyr/zephyr-ko-39.lab
mfa align /tmp/yeoni-corpus docs/yeoni-phase5/alignment/zephyr-ko-39.dict korean_mfa /tmp/yeoni-aligned-phrase --single_speaker --num_jobs 1 --no_use_mp --no_tokenization --output_format json --clean
# Review raw output before replacing mfa-phrase.raw.json, then:
node scripts/yeoni-speech-poc/convert-alignment.ts
```

Model hashes, exact command flags and input/output hashes: [provenance.json](provenance.json).
MFA is an offline development dependency, not an app/server/browser dependency.
The converter rounds measured seconds to integer milliseconds (model step 10ms),
keeps original IPA, verifies audio/text hashes and rejects invalid/unknown intervals.
It makes no acoustic corrections, equal-duration allocation or silence guesses.

## Why keep two alignments?

The default model uses Korean tokenization (python-mecab-ko). It reported no OOVs,
but the resulting phone sequence did not express several cross-morpheme changes:
오늘은 (liaison), 일정을 / 알려드릴게요 (tensification), 좋겠어요 (aspiration/liaison).
`zephyr-ko-39.dict` records a provisional standard-pronunciation hypothesis at the
phrase-token level, then the same acoustic model measures their boundaries again.
This small, explicit test lexicon is not a general G2P engine or proof of exactly
how the TTS spoke. No audio boundary is manually invented to make it look aligned.

## Waveform audit and connected-token correction

The separated-word candidate (`mfa-separated.raw.json`, `zephyr-ko-39-separated.dict`)
assigned 3980–4120ms to silence. Waveform/RMS inspection found substantial energy:
-21.9dBFS versus -50.3dBFS for the 2.9–3.3s sentence pause. See
[waveform and spectrogram](../evidence/alignment-waveform.png).

Combine only 조금 쉬는 → 조금쉬는 in the **analysis transcript** (`zephyr-ko-39.lab`)
and dictionary, then rerun acoustic alignment. No original MP3 or actual TTS text
changes. Conversion checks that removing whitespace gives identical characters.
The new output measures /m/ 3940–4020ms, /sʷ/ 4020–4090ms, /i/ 4090–4190ms,
removing the optional silence and making closure/rounding visible at normal speed.
No phoneme time was manually stretched, shifted or allocated from character count.
The figure uses 16kHz PCM, 256-sample FFT, 224-sample overlap, and the model intervals.

## Remaining review

- Connected-token alignment is still an automatic candidate, not listening-reviewed
  ground truth. Check all boundaries, especially 쉬는 and 좋겠어요.
- Waveform continuity rejects the old silence candidate; it does not certify the
  new individual phone boundaries. Frication/vowel transitions still need review.
- Very short /j/ transitions may still be skipped at a <=30fps render cap.
- This phrase has no independent /u/ vowel or /p, pʰ/ closure. Visible /sʷ/ rounding
  is not proof of an independent /u/ vowel. Numbers/longer speech are untested.
- Browser clock-age checks are not phonetic boundary error or physical speaker/
  Bluetooth delay. Naturalness remains human review.

## Attribution

Korean MFA acoustic model and dictionary v3.0.0: Michael McAuliffe and Morgan
Sonderegger, 2024, CC BY 4.0. Model weights/dictionary are not redistributed here.

- [Acoustic model](https://mfa-models.readthedocs.io/en/latest/acoustic/Korean/Korean%20MFA%20acoustic%20model%20v3_0_0.html)
- [Dictionary](https://mfa-models.readthedocs.io/en/latest/dictionary/Korean/Korean%20MFA%20dictionary%20v3_0_0.html)
- [Korean phonological rules and IPA](https://mfa-models.readthedocs.io/en/latest/mfa_phone_set.html#korean)

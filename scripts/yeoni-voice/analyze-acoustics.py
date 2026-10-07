"""Descriptive acoustic comparison only; no gender or speaker-identity classifier.

Requires numpy, scipy, praat-parselmouth and ffmpeg. Original audio is read-only.
Usage: python analyze-acoustics.py --originals-dir PATH --output-dir PATH
"""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path

import numpy as np
import parselmouth
from scipy.signal import stft

REPO = Path(__file__).resolve().parents[2]
PLAN = REPO / "docs/yeoni-voice-comparison/plan.json"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def summary(values):
    a = np.asarray(values)
    a = a[np.isfinite(a)]
    if not len(a):
        raise ValueError("No valid measurements")
    return {"count": len(a), "median": float(np.median(a)),
            "p10": float(np.percentile(a, 10)), "p90": float(np.percentile(a, 90))}


def nearest(times, source_times, source_values):
    indices = np.rint((times - source_times[0]) / (source_times[1] - source_times[0])).astype(int)
    valid = (indices >= 0) & (indices < len(source_values))
    out = np.zeros(len(times))
    out[valid] = source_values[indices[valid]]
    return out


def analyze(item):
    path = REPO / item["path"]
    assert digest(path) == item["sha256"], f"Recorded hash mismatch: {path}"
    probe = json.loads(subprocess.check_output([
        "ffprobe", "-v", "error", "-show_streams", "-of", "json", str(path)]))
    stream = next(s for s in probe["streams"] if s["codec_type"] == "audio")
    sr = int(stream["sample_rate"])
    assert int(stream["channels"]) == 1, "This comparison expects original mono clips"
    # Decode at original sample rate; no pitch/rate/normalization filters.
    raw = subprocess.check_output(["ffmpeg", "-v", "error", "-i", str(path),
                                   "-f", "f64le", "-acodec", "pcm_f64le", "pipe:1"])
    samples = np.frombuffer(raw, dtype="<f8")
    sound = parselmouth.Sound(samples, sampling_frequency=sr)
    args = dict(time_step=0.01, pitch_floor=60, pitch_ceiling=600,
                very_accurate=True, voicing_threshold=0.45)
    ac = sound.to_pitch_ac(**args)
    cc = sound.to_pitch_cc(**args)
    f0 = ac.selected_array["frequency"]
    cc_f0 = cc.selected_array["frequency"]
    cc_at_ac = nearest(ac.xs(), cc.xs(), cc_f0)
    common = (f0 > 0) & (cc_at_ac > 0)
    agreement = np.abs(12 * np.log2(f0[common] / cc_at_ac[common]))
    sensitivity = sound.to_pitch_ac(**{**args, "pitch_floor": 50, "pitch_ceiling": 800})
    sensitivity_f0 = sensitivity.selected_array["frequency"]
    harmonicity = sound.to_harmonicity_cc(time_step=0.01, minimum_pitch=60,
                                         silence_threshold=0.1, periods_per_window=4.5)
    hnr = harmonicity.values[0]
    hnr_voiced = nearest(harmonicity.xs(), ac.xs(), f0) > 0
    valid_hnr = hnr[(hnr > -100) & hnr_voiced]

    # Spectral descriptors describe this utterance, not immutable speaker traits.
    # Restrict to AC-voiced frames, 100–8000 Hz, no pre-emphasis or level adjustment.
    nperseg, hop = round(sr * .04), round(sr * .01)
    frequencies, times, z = stft(samples, fs=sr, window="hann", nperseg=nperseg,
                               noverlap=nperseg-hop, nfft=2048, boundary=None, padded=False)
    voiced = nearest(times, ac.xs(), f0) > 0
    band = (frequencies >= 100) & (frequencies <= 8000)
    magnitude = np.abs(z[band][:, voiced])
    power = magnitude ** 2
    freq = frequencies[band]
    centroids = (freq[:, None] * magnitude).sum(axis=0) / magnitude.sum(axis=0)
    band_power = {}
    for lo, hi in [(100, 500), (500, 1000), (1000, 2000), (2000, 4000), (4000, 8001)]:
        ratio = power[(freq >= lo) & (freq < hi)].sum(axis=0) / power.sum(axis=0)
        band_power[f"{lo}-{min(hi, 8000)}Hz"] = float(np.median(ratio))
    result = {
        "id": item["id"], "title": item["title"], "path": item["path"],
        "sha256": digest(path), "bytes": path.stat().st_size,
        "codec": stream["codec_name"], "sample_rate": sr,
        "decoded_duration_seconds": len(samples) / sr,
        "pitch_ac_hz": summary(f0[f0 > 0]), "pitch_cc_hz": summary(cc_f0[cc_f0 > 0]),
        "pitch_ac_50_800_hz": summary(sensitivity_f0[sensitivity_f0 > 0]),
        "pitch_ac_voiced_fraction": float(np.mean(f0 > 0)),
        "cross_method_common_voiced_frames": int(np.sum(common)),
        "cross_method_difference_semitones": summary(agreement),
        "cross_method_within_one_semitone_fraction": float(np.mean(agreement <= 1)),
        "voiced_hnr_db": summary(valid_hnr),
        "voiced_magnitude_spectral_centroid_hz": summary(centroids),
        "voiced_band_power_median_fractions": band_power,
    }
    trace = [{"seconds": float(t), "f0_hz": float(p) if p else None}
             for t, p in zip(ac.xs(), f0)]
    assert digest(path) == result["sha256"]
    return result, trace


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--originals-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    opts = parser.parse_args()
    plan = json.loads(PLAN.read_text())
    items = plan["baselines"] + plan["candidate"]["clips"]
    verified = []
    for clip in plan["candidate"]["clips"]:
        original = opts.originals_dir / clip["filename"]
        assert digest(original) == digest(REPO / clip["path"]) == clip["sha256"]
        verified.append({"id": clip["id"], "latest_original_matches_repo": True,
                         "sha256": clip["sha256"]})
    results, traces = [], {}
    for item in items:
        result, trace = analyze(item)
        results.append(result)
        traces[item["id"]] = trace
    report = {
        "kind": "descriptive-acoustics-not-listening-or-identity-verification",
        "parselmouth_version": parselmouth.__version__, "praat_version": parselmouth.PRAAT_VERSION,
        "pitch_settings": {"time_step_seconds": .01, "floor_hz": 60, "ceiling_hz": 600,
                           "very_accurate": True, "voicing_threshold": .45},
        "original_checks": verified, "clips": results,
        "limitations": [
            "No direct listening or audio-understanding model was used.",
            "No gender, age, speaker identity, or perceptual similarity classifier was run.",
            "One short sentence per condition cannot isolate language and model causality.",
            "Korean and Japanese contain different phonemes and meanings; spectra/HNR depend on these.",
            "Cloud baselines are MP3; user candidates are PCM WAV. Codec differences confound spectra.",
            "Pitch is not timbre. Spectral summaries are not speaker embeddings or similarity percentages.",
            "Japanese candidate model/voice settings were not independently verified at generation.",
        ],
        "new_tts_calls": 0, "external_audio_uploads": 0,
    }
    opts.output_dir.mkdir(parents=True, exist_ok=True)
    (opts.output_dir / "measurements.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    (opts.output_dir / "pitch-traces.json").write_text(json.dumps(traces, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

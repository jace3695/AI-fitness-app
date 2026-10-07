"""Describe saved speech and validate diagnostic media, without relabeling phones."""
import hashlib
import json
from pathlib import Path
import subprocess

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle
import numpy as np
from scipy.signal import correlate, correlation_lags, stft

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs/yeoni-phase5/boundary-review-20261007"
AUDIO = ROOT / "docs/yeoni-phase5/fixtures/zephyr-ko-39.mp3"
RATE = 24000


def decode(path):
    raw = subprocess.check_output([
        "ffmpeg", "-v", "error", "-i", str(path), "-vn", "-ar", str(RATE),
        "-ac", "1", "-f", "f64le", "pipe:1",
    ])
    return np.frombuffer(raw, dtype="<f8")


def db(value):
    return float(20 * np.log10(max(float(value), 1e-12)))


def span(data, start, end):
    return data[round(start * RATE / 1000):round(end * RATE / 1000)]


def describe(data, start, end, label):
    values = span(data, start, end)
    return {"label": label, "startMs": start, "endMs": end,
            "rmsDbfs": round(db(np.sqrt(np.mean(values ** 2))), 3),
            "peakDbfs": round(db(np.max(np.abs(values))), 3)}


timeline = json.loads((ROOT / "docs/yeoni-phase5/fixtures/zephyr-ko-39.timeline.json").read_text())
trace = json.loads((OUT / "mouth-trace.json").read_text())
technical = json.loads((OUT / "technical-review.json").read_text())
digest = hashlib.sha256(AUDIO.read_bytes()).hexdigest()
assert digest == timeline["audioSha256"]
source = decode(AUDIO)
descriptions = [describe(source, a, b, label) for a, b, label in [
    (2720, 3370, "reference inter-sentence gap"),
    (3940, 4020, "automatic /m/: mouth closed, not a silence assertion"),
    (3980, 4120, "old separated-token false-silence interval"),
    (4020, 4090, "automatic /s-w/ rounded onset"),
    (4090, 4190, "automatic /i/"),
    (4670, 4820, "automatic tense /s/"),
    (4820, 4960, "automatic /eo/"),
    (4970, 5200, "automatic final /o/"),
    (5200, 5376, "final gap: display is rest"),
]]

states = ["rest", "closed", "small", "a", "i", "u", "e", "o"]
colors = ["#b8bec8", "#44405b", "#9075a6", "#d3595f", "#e59d3b", "#408bce", "#52a583", "#8764d3"]
media = []
for region in technical["exports"]:
    start, end = region["startMs"], region["endMs"]
    x = span(source, start, end)
    times = start / 1000 + np.arange(len(x)) / RATE
    rows = [r for r in trace if start <= r["timeMs"] <= end]
    weights = np.zeros((len(states), len(rows)))
    for i, row in enumerate(rows):
        weights[states.index(row["from"]), i] += 1 - row["mix"]
        weights[states.index(row["to"]), i] += row["mix"]
    fig, axes = plt.subplots(4, 1, figsize=(12, 8), sharex=True,
                             gridspec_kw={"height_ratios": [0.65, 1.2, 2, 1.3]})
    fig.suptitle(f"Segment {region['id'].upper()} | saved Korean speech + current mouth timing", fontsize=15)
    fig.text(0.5, 0.934, "Automatic phone labels are hypotheses; energy is not phoneme ground truth.", ha="center", fontsize=10)
    axes[0].set_ylim(0, 1)
    axes[0].set_yticks([])
    axes[0].set_ylabel("Auto\nphones")
    for cue in timeline["cues"]:
        a, b = max(start, cue["startMs"]), min(end, cue["endMs"])
        if b <= a:
            continue
        axes[0].add_patch(Rectangle((a / 1000, 0), (b - a) / 1000, 1,
                                   facecolor="#e3daf0", edgecolor="white"))
        if b - a >= 20:
            axes[0].text((a+b)/2000, 0.5, cue["phone"], ha="center", va="center", fontsize=9, rotation=90)
    axes[1].plot(times, x, color="#524579", linewidth=0.5)
    axes[1].set_ylabel("PCM\namplitude")
    peak = float(np.max(np.abs(x))) * 1.05
    axes[1].set_ylim(-peak, peak)
    freq, t, z = stft(x, RATE, nperseg=512, noverlap=416, boundary=None, padded=False)
    spectrum = 20 * np.log10(np.maximum(2 * np.abs(z), 1e-8))
    axes[2].pcolormesh(t + start / 1000, freq / 1000, spectrum, cmap="magma", vmin=-80, vmax=-15, shading="auto")
    axes[2].set_ylim(0, 8)
    axes[2].set_ylabel("Frequency (kHz)\nfixed -80 to -15 dB")
    axes[3].stackplot([r["timeMs"]/1000 for r in rows], *weights, labels=states, colors=colors)
    axes[3].set_ylim(0, 1)
    axes[3].set_ylabel("Mouth blend\nweight")
    axes[3].set_xlabel("Original audio time (seconds)")
    axes[3].legend(ncol=8, loc="upper center", bbox_to_anchor=(0.5, -0.32), frameon=False)
    markers = [3.940, 4.020, 4.090, 4.190] if region["id"] == "a" else [4.670, 4.820, 4.960, 5.200]
    for ax in axes[1:]:
        for marker in markers:
            ax.axvline(marker, color="#8fa1ad", linewidth=0.7, linestyle="--", alpha=0.8)
    axes[-1].set_xlim(start/1000, end/1000)
    fig.subplots_adjust(left=0.1, right=0.98, top=0.89, bottom=0.14, hspace=0.15)
    fig.savefig(OUT / f"segment-{region['id']}-analysis.png", dpi=140)
    plt.close(fig)

    path = ROOT / region["path"]
    probe = json.loads(subprocess.check_output([
        "ffprobe", "-v", "error", "-show_entries",
        "stream=index,codec_name,start_time,duration,avg_frame_rate:format=duration,size", "-of", "json", str(path)
    ]))
    output = decode(path)
    normal = output[:len(x)]
    corr = correlate(normal, x, mode="full", method="fft")
    lags = correlation_lags(len(normal), len(x), mode="full")
    nearby = np.abs(lags) <= RATE // 10
    lag = int(lags[nearby][np.argmax(corr[nearby])])
    agreement = float(np.corrcoef(normal, x)[0, 1])
    assert lag == 0 and agreement > 0.98, (region["id"], lag, agreement)
    assert all(float(s["start_time"]) == 0 for s in probe["streams"])
    assert probe["streams"][0]["avg_frame_rate"] == "30/1"
    media.append({"region": region["id"], "probe": probe,
                  "normalAudioCrossCorrelationLagSamples": lag,
                  "normalAudioCorrelationAtZeroLag": agreement,
                  "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                  "limitations": "Offline 30fps reconstruction, not browser latency measurement. Slow pass is diagnostic only; atempo may alter local timing."})

result = {"sourceAudioSha256": digest, "decodeSampleRate": RATE,
          "decodeSamples": len(source), "descriptiveIntervals": descriptions,
          "plotMethod": "Decoded unchanged source MP3. STFT: 512-sample Hann window, 96-sample hop, amplitude 2*abs(Zxx). Mouth weights are renderer outputs, not inferred from energy.",
          "exportChecks": media, "manualPhoneBoundaryChanges": 0,
          "directListeningByCodex": False,
          "status": "Acoustic descriptors and export timing checked; perceptual phone boundaries pending."}
(OUT / "acoustic-review.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({"intervals": descriptions, "exportChecks": media}, ensure_ascii=False, indent=2))

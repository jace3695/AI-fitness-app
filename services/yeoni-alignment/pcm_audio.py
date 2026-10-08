"""Exact fast path for the worker's FFmpeg-normalized PCM16 mono 16kHz WAV."""
import math
import wave

import numpy as np


def load_pcm_audio(segment):
    begin = segment.begin
    end = segment.end
    if begin is None or not math.isfinite(begin) or begin < 0:
        raise ValueError('INVALID_PCM_SEGMENT')
    if end is not None and (not math.isfinite(end) or end < begin):
        raise ValueError('INVALID_PCM_SEGMENT')
    if segment.channel not in (None, 0):
        raise ValueError('INVALID_PCM_CHANNEL')
    with wave.open(str(segment.file_path), 'rb') as stream:
        if (stream.getframerate() != 16000 or stream.getnchannels() != 1
                or stream.getsampwidth() != 2 or stream.getcomptype() != 'NONE'):
            raise ValueError('UNSUPPORTED_PCM_FORMAT')
        # Same offset and duration truncation as librosa's soundfile reader.
        stream.setpos(int(begin * 16000))
        frames = stream.getnframes() if end is None else int((end - begin) * 16000)
        samples = np.frombuffer(stream.readframes(frames), dtype='<i2').astype(np.float32)
    samples *= np.float32(1 / 32768)
    if end is None:
        segment.end = samples.shape[0] / 16000
    return samples

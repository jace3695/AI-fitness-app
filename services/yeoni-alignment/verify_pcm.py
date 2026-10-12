"""Build gate: compare the installed MFA reader with the PCM fast path."""
from pathlib import Path
import tempfile
import wave

import numpy as np
from montreal_forced_aligner.command_line.align_one import Segment
from pcm_audio import load_pcm_audio

with tempfile.TemporaryDirectory(prefix='verify-pcm-') as temporary:
    path = Path(temporary) / 'synthetic.wav'
    # All 65,536 PCM16 values, including both extremes; no recorded user audio.
    samples = np.arange(-32768, 32768, dtype=np.int32).astype('<i2')
    with wave.open(str(path), 'wb') as stream:
        stream.setnchannels(1)
        stream.setsampwidth(2)
        stream.setframerate(16000)
        stream.writeframes(samples.tobytes())
    for begin, end in ((0, None), (0, 4.096), (0.00009, 0.12349),
                       (1.0123, 2.0789), (4.0, 4.2), (0.25, None), (0, 0)):
        old = Segment(path, begin, end, 0)
        new = Segment(path, begin, end, 0)
        expected = old.load_audio()
        actual = load_pcm_audio(new)
        assert expected.dtype == actual.dtype == np.float32
        assert np.array_equal(expected, actual), 'PCM_SAMPLE_MISMATCH'
        assert old.end == new.end, 'PCM_DURATION_MISMATCH'
print('PCM reader verified: 7 cases, exact samples and duration')

import tempfile
from pathlib import Path
from types import SimpleNamespace
import unittest
import wave

import numpy as np
from pcm_audio import load_pcm_audio


class PcmTests(unittest.TestCase):
    def test_signed_pcm_samples_offsets_and_end(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'test.wav'
            samples = np.array([-32768, -1, 0, 1, 32767], dtype='<i2')
            with wave.open(str(path), 'wb') as stream:
                stream.setnchannels(1); stream.setsampwidth(2); stream.setframerate(16000)
                stream.writeframes(samples.tobytes())
            segment = SimpleNamespace(file_path=path, begin=0, end=None, channel=0)
            actual = load_pcm_audio(segment)
            np.testing.assert_array_equal(actual, samples.astype(np.float32) / 32768)
            self.assertEqual(segment.end, 5 / 16000)
            segment.begin = 1 / 16000; segment.end = 4 / 16000
            np.testing.assert_array_equal(load_pcm_audio(segment), actual[1:4])
            segment.channel = 1
            with self.assertRaisesRegex(ValueError, 'CHANNEL'):
                load_pcm_audio(segment)

    def test_rejects_unexpected_format(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'test.wav'
            with wave.open(str(path), 'wb') as stream:
                stream.setnchannels(1); stream.setsampwidth(2); stream.setframerate(8000)
                stream.writeframes(b'\x00\x00')
            with self.assertRaisesRegex(ValueError, 'FORMAT'):
                load_pcm_audio(SimpleNamespace(file_path=path, begin=0, end=None, channel=0))

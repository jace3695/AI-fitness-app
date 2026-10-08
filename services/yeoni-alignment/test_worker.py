import base64
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch
import worker

ROOT = Path(__file__).resolve().parents[2]


class WorkerTests(unittest.TestCase):
    def call(self, **overrides):
        env = dict(REQUEST_METHOD='POST', PATH_INFO='/align', CONTENT_LENGTH='2',
                   HTTP_AUTHORIZATION='Bearer ' + 'x' * 32, **{'wsgi.input': io.BytesIO(b'{}')})
        env.update(overrides)
        status = []
        with patch.object(worker, 'configuration', return_value=('x' * 32, Path('/dict'), Path('/model'))):
            body = b''.join(worker.application(env, lambda s, h: status.append(s)))
        return status[0], json.loads(body)

    def test_auth_precedes_alignment(self):
        with patch.object(worker, 'align') as align:
            self.assertEqual(self.call(HTTP_AUTHORIZATION='Bearer wrong')[0], '401 Unauthorized')
            align.assert_not_called()

    def test_size_and_invalid_length(self):
        for size, status in [('0', '413'), ('2100001', '413'), ('no', '400')]:
            self.assertTrue(self.call(CONTENT_LENGTH=size)[0].startswith(status))

    def test_busy(self):
        worker.SLOT.acquire()
        try:
            self.assertTrue(self.call()[0].startswith('429'))
        finally:
            worker.SLOT.release()

    def test_failure_releases_slot_and_suppresses_details(self):
        with patch.object(worker, 'align', side_effect=ValueError('private transcript')):
            self.assertEqual(self.call(), ('422 Unprocessable Entity', {'error': 'ALIGNMENT_UNAVAILABLE'}))
        self.assertTrue(worker.SLOT.acquire(blocking=False))
        worker.SLOT.release()

    def test_saved_acoustic_output_hashes_and_times(self):
        audio = (ROOT / 'docs/yeoni-phase5/fixtures/zephyr-ko-39.mp3').read_bytes()
        raw = json.loads((ROOT / 'docs/yeoni-phase5/alignment/mfa-phrase.raw.json').read_text())
        result = worker.manifest_from_raw(audio, '검증 문장', raw)
        self.assertEqual(result['audioSha256'], 'f598b457e49734e75a83a04e57b28f47f7a8d98ceb1aff1549942a5264b9ef2d')
        self.assertEqual(result['cues'][0]['startMs'], round(raw['tiers']['phones']['entries'][0][0] * 1000))
        self.assertEqual(result['alignment'], 'automatic-phonemes')
        raw['tiers']['phones']['entries'][0][2] = 'spn'
        with self.assertRaises(ValueError):
            worker.manifest_from_raw(audio, '검증 문장', raw)

    def test_invalid_voice_never_runs_engine(self):
        with patch.object(worker, 'run_bounded') as run:
            with self.assertRaises(ValueError):
                worker.align({'voice': 'different'}, Path('/dict'), Path('/model'))
            run.assert_not_called()

    def test_engine_failure_cleans_temporary_audio(self):
        directories = []
        def fail(command, seconds, cwd):
            directories.append(Path(cwd))
            self.assertTrue((Path(cwd) / 'speech.mp3').exists())
            raise ValueError('engine unavailable')
        with patch.object(worker, 'run_bounded', side_effect=fail):
            with self.assertRaises(ValueError):
                worker.align({'voice': worker.VOICE, 'language': 'ko-KR', 'spokenText': '안녕',
                              'audioContent': base64.b64encode(b'fixture').decode()}, Path('/dict'), Path('/model'))
        self.assertTrue(directories)
        self.assertTrue(all(not p.exists() for p in directories))


if __name__ == '__main__':
    unittest.main()

import base64
import io
import json
import hashlib
import os
import tempfile
from pathlib import Path
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch
import worker

ROOT = Path(__file__).resolve().parents[2]


class WorkerTests(unittest.TestCase):
    def test_rejected_new_phone_results_are_diagnosable_without_private_output(self):
        cases = [('spn', 0, .1, 'UNKNOWN_PHONE'), ('', 0, .1, 'EMPTY_PHONE'),
                 ('sil', .2, .1, 'INVALID_PHONE_TIMING')]
        for phone, start, finish, category in cases:
            raw = {'end': 1, 'tiers': {'phones': {'entries': [[start, finish, phone]]}}}
            with self.assertRaises(ValueError) as error:
                worker.manifest_from_raw(b'audio', 'private transcript', raw)
            self.assertEqual(worker.result_category(error.exception), category)
        output = io.StringIO()
        with redirect_stdout(output), patch.object(worker, 'align', side_effect=ValueError('private transcript token /private/path')):
            self.assertEqual(self.call(), ('422 Unprocessable Entity', {'error': 'ALIGNMENT_UNAVAILABLE'}))
        self.assertEqual(output.getvalue().strip(), 'alignment-result=INVALID_RESULT_OR_INPUT')

    def test_diagnostic_categories_do_not_return_private_output(self):
        self.assertEqual(worker.failure_category('private transcript Permission denied /private/path'), 'PERMISSION_DENIED')
        self.assertEqual(worker.failure_category('private transcript and token'), 'PROCESS_FAILED')

    def test_precompiled_lexicon_is_verified_and_only_links_are_job_local(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            source = base / 'cache'; source.mkdir()
            dictionary = base / 'korean.dict'; dictionary.write_text('dictionary')
            acoustic = base / 'korean.zip'; acoustic.write_text('acoustic')
            files = {}
            for name in ('L.fst', 'L_align.fst', 'words.txt', 'phones.txt'):
                (source / name).write_text(name)
                files[name] = hashlib.sha256(name.encode()).hexdigest()
            provenance = {'mfa':'3.4.2', 'models':{
                'dictionary':['korean.dict',hashlib.sha256(dictionary.read_bytes()).hexdigest()],
                'acoustic':['korean.zip',hashlib.sha256(acoustic.read_bytes()).hexdigest()]},'files':files}
            (source / 'provenance.json').write_text(json.dumps(provenance))
            with patch.dict(os.environ, {'YEONI_MFA_LEXICON': str(source)}):
                with tempfile.TemporaryDirectory(dir=base) as job:
                    self.assertTrue(worker.seed_lexicon(Path(job),dictionary,acoustic))
                    self.assertTrue((Path(job)/'mfa/extracted_models/dictionary/korean/L.fst').is_symlink())
                self.assertTrue((source/'L.fst').exists())
                worker.verify_lexicon.cache_clear()
                (source/'L.fst').write_text('corrupt')
                with self.assertRaisesRegex(ValueError, 'LEXICON_HASH_MISMATCH'):
                    worker.seed_lexicon(base/'job2',dictionary,acoustic)
            worker.verify_lexicon.cache_clear()

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

import hashlib
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import download_models


class ModelProvisionTests(unittest.TestCase):
    def test_acoustic_and_g2p_archives_do_not_overwrite_each_other(self):
        models = {kind: (name, hashlib.sha256(kind.encode()).hexdigest())
                  for kind, (name, _) in download_models.MODELS.items()}
        def upstream(url, timeout):
            kind = url.split('/download/')[1].split('-korean_mfa-')[0]
            self.assertEqual(url.rsplit('/', 1)[1], 'korean_mfa.dict' if kind == 'dictionary' else 'korean_mfa.zip')
            return io.BytesIO(kind.encode())
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(download_models, 'MODELS', models), patch('urllib.request.urlopen', side_effect=upstream):
                download_models.provision(Path(directory))
            self.assertEqual((Path(directory) / 'korean_mfa.zip').read_bytes(), b'acoustic')
            self.assertEqual((Path(directory) / 'korean_mfa_g2p.zip').read_bytes(), b'g2p')

    def test_publishes_only_matching_model(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            model = {'acoustic': ('model.zip', hashlib.sha256(b'model').hexdigest())}
            with patch.object(download_models, 'MODELS', model), patch('urllib.request.urlopen', return_value=io.BytesIO(b'model')):
                download_models.provision(root)
            self.assertEqual((root / 'model.zip').read_bytes(), b'model')
            with patch.object(download_models, 'MODELS', model), patch('urllib.request.urlopen', return_value=io.BytesIO(b'wrong')):
                with self.assertRaisesRegex(ValueError, 'MODEL_HASH_MISMATCH'):
                    download_models.provision(root)
            self.assertEqual((root / 'model.zip').read_bytes(), b'model')
            self.assertFalse(list(root.glob('*.partial')))

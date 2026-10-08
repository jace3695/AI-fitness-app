import hashlib
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import download_models


class ModelProvisionTests(unittest.TestCase):
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

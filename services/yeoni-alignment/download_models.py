"""Build-time provisioning only. Download fixed upstream files and verify hashes."""
import hashlib
from pathlib import Path
import urllib.request

MODELS = {
    'acoustic': ('korean_mfa.zip', '46f7a73ab46828c679562b160e0577beecfb4a9a827efe5ab392aee947451a4d'),
    'dictionary': ('korean_mfa.dict', '75683f4dc2a7dd95295a068206d248a30bd2f4f2231fd4449210c91d1e78150b'),
}


def provision(destination):
    destination.mkdir(parents=True, exist_ok=True)
    for kind, (name, expected) in MODELS.items():
        url = f'https://github.com/MontrealCorpusTools/mfa-models/releases/download/{kind}-korean_mfa-v3.0.0/{name}'
        target = destination / name
        temporary = target.with_suffix(target.suffix + '.partial')
        digest, count = hashlib.sha256(), 0
        try:
            with urllib.request.urlopen(url, timeout=60) as response, temporary.open('wb') as stream:
                while block := response.read(1_048_576):
                    count += len(block)
                    if count > 80_000_000:
                        raise ValueError('MODEL_TOO_LARGE')
                    digest.update(block)
                    stream.write(block)
            if digest.hexdigest() != expected:
                raise ValueError('MODEL_HASH_MISMATCH')
            temporary.replace(target)
        finally:
            temporary.unlink(missing_ok=True)


if __name__ == '__main__':
    provision(Path('/opt/yeoni/models'))

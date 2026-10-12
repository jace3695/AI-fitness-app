"""Build-only lexicon compilation, matching pinned MFA 3.4.2 align_one_function.

No recordings or transcripts are used. Only the hash-verified public models.
Upstream algorithm: MontrealCorpusTools/Montreal-Forced-Aligner v3.4.2,
montreal_forced_aligner/command_line/align_one.py (MIT).
"""
import hashlib
import json
from pathlib import Path
import tempfile

FILES = ('L.fst', 'L_align.fst', 'words.txt', 'phones.txt')


def prepare(models, destination):
    from kalpy.fstext.lexicon import LexiconCompiler
    from montreal_forced_aligner.models import AcousticModel
    from download_models import MODELS

    for name, digest in MODELS.values():
        if hashlib.sha256((models / name).read_bytes()).hexdigest() != digest:
            raise ValueError('MODEL_HASH_MISMATCH')
    destination.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='yeoni-model-') as temporary:
        acoustic = AcousticModel(models / 'korean_mfa.zip', Path(temporary))
        parameters = acoustic.parameters
        compiler = LexiconCompiler(
            disambiguation=False,
            silence_probability=parameters['silence_probability'],
            initial_silence_probability=parameters['initial_silence_probability'],
            final_silence_correction=parameters['final_silence_correction'],
            final_non_silence_correction=parameters['final_non_silence_correction'],
            silence_phone=parameters['optional_silence_phone'],
            oov_phone=parameters['oov_phone'],
            position_dependent_phones=parameters['position_dependent_phones'],
            phones=parameters['non_silence_phones'], ignore_case=True,
        )
        compiler.load_pronunciations(models / 'korean_mfa.dict')
        compiler.create_fsts()
        compiler.clear()
        compiler.fst.write(str(destination / 'L.fst'))
        compiler.align_fst.write(str(destination / 'L_align.fst'))
        compiler.word_table.write_text(destination / 'words.txt')
        compiler.phone_table.write_text(destination / 'phones.txt')
    hashes = {}
    for name in FILES:
        file = destination / name
        if file.stat().st_size == 0:
            raise ValueError('EMPTY_LEXICON')
        hashes[name] = hashlib.sha256(file.read_bytes()).hexdigest()
        file.chmod(0o444)
    (destination / 'provenance.json').write_text(json.dumps({
        'mfa': '3.4.2', 'models': MODELS, 'files': hashes,
    }, indent=2))
    print('Prepared immutable Korean lexicon: four verified nonempty files', flush=True)


if __name__ == '__main__':
    prepare(Path('/opt/yeoni/models'), Path('/opt/yeoni/lexicon'))

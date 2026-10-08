"""Private Korean alignment worker; no TTS, database access or audio persistence.

Run behind a TLS reverse proxy with gunicorn, ONE worker and two threads.
Provision MFA 3.4.2, ffmpeg and Korean v3 model/dictionary before starting.
This file does not download models or send recordings to another provider.
"""
import base64
import hashlib
import json
import re
import math
import os
from pathlib import Path
import secrets
import shutil
import signal
import subprocess
import tempfile
import threading
import time
import sys
from functools import lru_cache


def failure_category(message):
    # Fixed categories only: never emit subprocess output or exception values.
    for marker, category in [('Read-only file system', 'READ_ONLY_FILESYSTEM'),
                             ('Permission denied', 'PERMISSION_DENIED'),
                             ('No space left', 'DISK_FULL'),
                             ('No module named', 'MISSING_MODULE'),
                             ('cannot cache function', 'NUMBA_CACHE'),
                             ('ImportError', 'IMPORT_ERROR'),
                             ('MemoryError', 'OUT_OF_MEMORY')]:
        if marker in message:
            return category
    return 'PROCESS_FAILED'

VOICE = 'ko-KR-Chirp3-HD-Zephyr'
SLOT = threading.BoundedSemaphore(1)
MAX_BODY = 2_100_000
SAFE_RESULT_ERRORS = frozenset({
    'INVALID_DURATION', 'INVALID_PHONES', 'UNKNOWN_PHONE', 'EMPTY_PHONE',
    'INVALID_PHONE_TIMING', 'INVALID_PHONE_LABEL', 'ALIGNMENT_FAILED',
    'ALIGNMENT_TIMEOUT', 'UNSUPPORTED_VOICE', 'INVALID_TEXT', 'INVALID_AUDIO',
    'INVALID_BODY', 'LEXICON_VERSION_MISMATCH', 'LEXICON_MODEL_MISMATCH',
    'LEXICON_HASH_MISMATCH', 'LEXICON_NOT_CONFIGURED',
})


def result_category(error):
    # Only our fixed validation codes are safe to log. Never emit raw exceptions.
    if (isinstance(error, ValueError) and len(error.args) == 1
            and isinstance(error.args[0], str) and error.args[0] in SAFE_RESULT_ERRORS):
        return error.args[0]
    return 'IO_ERROR' if isinstance(error, OSError) else 'INVALID_RESULT_OR_INPUT'


@lru_cache(maxsize=1)
def verify_lexicon(source, dictionary, acoustic):
    provenance = json.loads((source / 'provenance.json').read_text())
    if provenance.get('mfa') != '3.4.2':
        raise ValueError('LEXICON_VERSION_MISMATCH')
    for kind, path in (('dictionary', dictionary), ('acoustic', acoustic)):
        if hashlib.sha256(path.read_bytes()).hexdigest() != provenance['models'][kind][1]:
            raise ValueError('LEXICON_MODEL_MISMATCH')
    names = ('L.fst', 'L_align.fst', 'words.txt', 'phones.txt')
    for name in names:
        if hashlib.sha256((source / name).read_bytes()).hexdigest() != provenance['files'][name]:
            raise ValueError('LEXICON_HASH_MISMATCH')
    return names


def seed_lexicon(root, dictionary, acoustic):
    source = os.environ.get('YEONI_MFA_LEXICON')
    if not source:
        return False
    source = Path(source).resolve()
    names = verify_lexicon(source, dictionary, acoustic)
    # The image builds these from the same pinned model/dictionary. No request
    # input controls paths. Missing/partial provisioning fails closed.
    if not all((source / name).is_file() and (source / name).stat().st_size > 0 for name in names):
        raise ValueError('LEXICON_NOT_CONFIGURED')
    destination = root / 'mfa' / 'extracted_models' / 'dictionary' / dictionary.stem
    destination.mkdir(parents=True)
    for name in names:
        (destination / name).symlink_to(source / name)
    return True


def configuration():
    token = os.environ.get('YEONI_ALIGNMENT_TOKEN', '')
    dictionary = Path(os.environ.get('YEONI_MFA_DICTIONARY', '/missing')).resolve()
    acoustic = Path(os.environ.get('YEONI_MFA_ACOUSTIC', '/missing')).resolve()
    if len(token) < 32 or not dictionary.is_file() or not acoustic.is_file():
        raise ValueError('NOT_CONFIGURED')
    if not shutil.which('mfa') or not shutil.which('ffmpeg'):
        raise ValueError('NOT_CONFIGURED')
    return token, dictionary, acoustic


def run_bounded(command, seconds, cwd):
    # No shell, no user-supplied command/filename; kill the entire process group.
    environment = dict(os.environ, MFA_ROOT_DIR=str(Path(cwd) / 'mfa-root'),
                       OMP_NUM_THREADS='1', OPENBLAS_NUM_THREADS='1')
    stage = 'decode' if command[0] == 'ffmpeg' else 'align'
    started = time.monotonic()
    with tempfile.TemporaryFile() as diagnostic:
        with subprocess.Popen(command, cwd=cwd, stdout=diagnostic,
                              stderr=diagnostic, start_new_session=True, env=environment) as process:
            try:
                code = process.wait(timeout=seconds)
                if code != 0:
                    diagnostic.seek(max(0, diagnostic.tell() - 16_384))
                    category = failure_category(diagnostic.read(16_384).decode('utf-8', errors='replace'))
                    print(f'alignment-stage={stage} result={category} exit={code}', flush=True)
                    raise ValueError('ALIGNMENT_FAILED')
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
                print(f'alignment-stage={stage} result=TIMEOUT limit={seconds}', flush=True)
                raise ValueError('ALIGNMENT_TIMEOUT') from None
    print(f'alignment-stage={stage} result=OK elapsed={time.monotonic() - started:.2f}', flush=True)


def manifest_from_raw(audio, text, raw):
    duration = round(raw['end'] * 1000)
    if not math.isfinite(duration) or not 0 < duration <= 120_000:
        raise ValueError('INVALID_DURATION')
    entries = raw['tiers']['phones']['entries']
    if not 0 < len(entries) <= 24_000:
        raise ValueError('INVALID_PHONES')
    cues, end = [], 0
    for start, finish, phone in entries:
        start, finish = round(start * 1000), round(finish * 1000)
        if not isinstance(phone, str):
            raise ValueError('INVALID_PHONE_LABEL')
        if phone in ('spn', '<unk>'):
            raise ValueError('UNKNOWN_PHONE')
        if not phone:
            raise ValueError('EMPTY_PHONE')
        if start < end or finish <= start or finish > duration:
            raise ValueError('INVALID_PHONE_TIMING')
        cues.append({'startMs': start, 'endMs': finish, 'phone': phone})
        end = finish
    return {'version': 1, 'language': 'ko-KR', 'voice': VOICE, 'spokenText': text,
            'audioSha256': hashlib.sha256(audio).hexdigest(),
            'textSha256': hashlib.sha256(text.encode('utf-8')).hexdigest(),
            'durationMs': duration, 'alignment': 'automatic-phonemes', 'cues': cues}


def align(body, dictionary, acoustic):
    text, encoded = body.get('spokenText'), body.get('audioContent')
    if body.get('voice') != VOICE or body.get('language') != 'ko-KR':
        raise ValueError('UNSUPPORTED_VOICE')
    if not isinstance(text, str) or not 0 < len(text) <= 1200 or not text.strip() or '\x00' in text:
        raise ValueError('INVALID_TEXT')
    if not isinstance(encoded, str) or len(encoded) > 2_000_000:
        raise ValueError('INVALID_AUDIO')
    audio = base64.b64decode(encoded, validate=True)
    if not audio:
        raise ValueError('INVALID_AUDIO')
    # Runtime input/output and MFA workspace are removed even after failure.
    with tempfile.TemporaryDirectory(prefix='yeoni-align-') as directory:
        root = Path(directory)
        (root / 'speech.mp3').write_bytes(audio)
        (root / 'speech.lab').write_text(text, encoding='utf-8')
        cached = seed_lexicon(root, dictionary, acoustic)
        print(f'alignment-lexicon={"precompiled" if cached else "per-request"}', flush=True)
        run_bounded(['ffmpeg', '-nostdin', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-f', 'mp3', '-i', str(root / 'speech.mp3'),
                     '-t', '121', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', str(root / 'speech.wav')], 3, directory)
        run_bounded([sys.executable, str(Path(__file__).with_name('profile_mfa.py')), 'align_one', str(root / 'speech.wav'), str(root / 'speech.lab'),
                     str(dictionary), str(acoustic), str(root / 'aligned.json'),
                     '--output_format', 'json', '--temporary_directory', str(root / 'mfa'),
                     '--num_jobs', '1', '--no_use_mp', '--no_use_postgres',
                     '--no_clean' if cached else '--clean', '--quiet'], 45, directory)
        timings = json.loads((root / 'phase-times.json').read_text())
        for name in ('importMs', 'commandMs', 'alignmentMs'):
            value = timings.get(name)
            if isinstance(value, int) and 0 <= value <= 50_000:
                print(f'alignment-phase={name} milliseconds={value}', flush=True)
        for item in timings.get('hotspots', [])[:15]:
            # Profile output contains only allowlisted package code identities and numbers.
            if (isinstance(item, dict) and isinstance(item.get('code'), str)
                    and re.fullmatch(r'(?:montreal_forced_aligner|kalpy)/[A-Za-z0-9_./:]{1,150}', item['code'])
                    and all(type(item.get(k)) is int and 0 <= item[k] <= 10_000_000
                            for k in ('totalMs', 'selfMs', 'calls'))):
                print('alignment-hotspot=' + json.dumps(item, separators=(',', ':')), flush=True)
        raw = json.loads((root / 'aligned.json').read_text(encoding='utf-8'))
        return manifest_from_raw(audio, text, raw)


def application(environ, start_response):
    def respond(status, body):
        data = json.dumps(body, ensure_ascii=False, allow_nan=False).encode('utf-8')
        start_response(status, [('Content-Type', 'application/json'), ('Cache-Control', 'no-store'),
                                ('Content-Length', str(len(data)))])
        return [data]
    try:
        token, dictionary, acoustic = configuration()
    except ValueError:
        return respond('503 Service Unavailable', {'error': 'NOT_CONFIGURED'})
    if not secrets.compare_digest(environ.get('HTTP_AUTHORIZATION', '').encode(), ('Bearer ' + token).encode()):
        return respond('401 Unauthorized', {'error': 'UNAUTHORIZED'})
    if environ.get('REQUEST_METHOD') == 'GET' and environ.get('PATH_INFO') == '/health':
        return respond('200 OK', {'ready': True, 'language': 'ko-KR'})
    if environ.get('REQUEST_METHOD') != 'POST' or environ.get('PATH_INFO') != '/align':
        return respond('404 Not Found', {'error': 'NOT_FOUND'})
    try:
        length = int(environ.get('CONTENT_LENGTH') or '0')
        if not 0 < length <= MAX_BODY:
            return respond('413 Payload Too Large', {'error': 'BODY_TOO_LARGE'})
    except ValueError:
        return respond('400 Bad Request', {'error': 'INVALID_LENGTH'})
    if not SLOT.acquire(blocking=False):
        return respond('429 Too Many Requests', {'error': 'BUSY'})
    try:
        body = json.loads(environ['wsgi.input'].read(length))
        if not isinstance(body, dict):
            raise ValueError('INVALID_BODY')
        result = align(body, dictionary, acoustic)
        return respond('200 OK', result)
    except Exception as error:
        # Do not log transcripts, audio, tokens, model output or sensitive paths.
        category = result_category(error)
        print(f'alignment-result={category}', flush=True)
        return respond('422 Unprocessable Entity', {'error': 'ALIGNMENT_UNAVAILABLE'})
    finally:
        SLOT.release()

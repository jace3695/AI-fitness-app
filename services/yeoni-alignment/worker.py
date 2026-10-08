"""Private Korean alignment worker; no TTS, database access or audio persistence.

Run behind a TLS reverse proxy with gunicorn, ONE worker and two threads.
Provision MFA 3.4.2, ffmpeg and Korean v3 model/dictionary before starting.
This file does not download models or send recordings to another provider.
"""
import base64
import hashlib
import json
import math
import os
from pathlib import Path
import secrets
import shutil
import signal
import subprocess
import tempfile
import threading

VOICE = 'ko-KR-Chirp3-HD-Zephyr'
SLOT = threading.BoundedSemaphore(1)
MAX_BODY = 2_100_000


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
    with subprocess.Popen(command, cwd=cwd, stdout=subprocess.DEVNULL,
                          stderr=subprocess.DEVNULL, start_new_session=True, env=environment) as process:
        try:
            if process.wait(timeout=seconds) != 0:
                raise ValueError('ALIGNMENT_FAILED')
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
            raise ValueError('ALIGNMENT_TIMEOUT') from None


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
        if not isinstance(phone, str) or phone in ('spn', '<unk>', '') or start < end or finish <= start or finish > duration:
            raise ValueError('UNALIGNED_PHONE')
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
        run_bounded(['ffmpeg', '-nostdin', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-f', 'mp3', '-i', str(root / 'speech.mp3'),
                     '-t', '121', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', str(root / 'speech.wav')], 3, directory)
        run_bounded(['mfa', 'align_one', str(root / 'speech.wav'), str(root / 'speech.lab'),
                     str(dictionary), str(acoustic), str(root / 'aligned.json'),
                     '--output_format', 'json', '--temporary_directory', str(root / 'mfa'),
                     '--num_jobs', '1', '--no_use_mp', '--no_use_postgres', '--clean', '--quiet'], 15, directory)
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
    except Exception:
        # Do not log transcripts, audio, tokens, model output or sensitive paths.
        return respond('422 Unprocessable Entity', {'error': 'ALIGNMENT_UNAVAILABLE'})
    finally:
        SLOT.release()

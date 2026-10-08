"""Measure pinned MFA startup vs alignment without logging inputs or changing it."""
import cProfile
import importlib
import pstats
import re
import json
from pathlib import Path
import time

started = time.monotonic()
from montreal_forced_aligner.command_line.mfa import mfa_cli

timings = {'importMs': round((time.monotonic() - started) * 1000)}
output = Path.cwd() / 'phase-times.json'
output.write_text(json.dumps(timings))
module = importlib.import_module('montreal_forced_aligner.command_line.align_one')
original = module.align_one_function


def measured(*args, **kwargs):
    beginning = time.monotonic()
    profile = cProfile.Profile()
    profile.enable()
    try:
        return original(*args, **kwargs)
    finally:
        profile.disable()
        timings['alignmentMs'] = round((time.monotonic() - beginning) * 1000)
        # Only code identities from these two installed packages, never arguments,
        # locals, transcripts, exception text, or full paths. Cumulative times overlap.
        hotspots = []
        for (filename, _line, function), stats in pstats.Stats(profile).stats.items():
            for package in ('montreal_forced_aligner', 'kalpy'):
                marker = '/' + package + '/'
                if marker not in filename:
                    continue
                relative = filename.rsplit(marker, 1)[1]
                label = package + '/' + relative + ':' + function
                if len(label) <= 160 and re.fullmatch(r'[A-Za-z0-9_./:]+', label):
                    hotspots.append({'code': label, 'totalMs': round(stats[3] * 1000),
                                     'selfMs': round(stats[2] * 1000), 'calls': stats[1]})
                break
        timings['hotspots'] = sorted(hotspots, key=lambda item: item['totalMs'], reverse=True)[:15]


module.align_one_function = measured
command_started = time.monotonic()
try:
    mfa_cli(standalone_mode=False)
finally:
    timings['commandMs'] = round((time.monotonic() - command_started) * 1000)
    output.write_text(json.dumps(timings))

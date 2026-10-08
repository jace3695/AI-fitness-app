"""Measure pinned MFA startup vs alignment without logging inputs or changing it."""
import importlib
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
    try:
        return original(*args, **kwargs)
    finally:
        timings['alignmentMs'] = round((time.monotonic() - beginning) * 1000)


module.align_one_function = measured
command_started = time.monotonic()
try:
    mfa_cli(standalone_mode=False)
finally:
    timings['commandMs'] = round((time.monotonic() - command_started) * 1000)
    output.write_text(json.dumps(timings))

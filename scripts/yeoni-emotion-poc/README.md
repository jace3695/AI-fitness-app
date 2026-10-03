# PHASE 6 — emotion and gesture lab

Uses the existing shared Controller, Canvas adapter and one saved Zephyr MP3.
No provider calls, account access, uploads, production routes or new dependencies.

```sh
node scripts/yeoni-emotion-poc/check.mjs
YEONI_BROWSER=webkit node scripts/yeoni-emotion-poc/check.mjs
node scripts/yeoni-emotion-poc/export.mjs
```

The check owns port 8876; the exported HTML embeds all assets and runs offline.
Initial state: neutral, motion off, muted, no audio loaded. Expression controls
work statically; enable motion for a single nod, tilt, greeting bow or small cheer.
The optional saved voice controls use the existing player; never regenerate it.

`character-expression.ts` defines 12 normalized presets and 4 gesture durations.
`CharacterController` owns 240ms smoothstep retargeting and gesture phase on the
host animation clock. A new gesture replaces the current one; gates/disposal
cancel it permanently. No timers, RAF, Canvas, React or DOM in the Controller.
Nested expression frames are immutable; gaze is normalized X/Y in `expression`.

The Canvas renderer maps these values to pixels/angles. Its opt-in `expressive`
path uses overlapping body/head regions of the existing atlas, opaque eyes,
closed-mouth curves, head nod/tilt, a small body lift and tail attitude. It never
selects phonemes. Speech closures/vowels retain their shapes; a silent rest can
carry a closed smile/frown. Legacy PHASE 4/5 rendering remains the default.

No separate ear/paw rig exists in this atlas; independent ear motion or waving
paws require further asset work. Do not label the bow as a paw wave. The lab's
manual inputs are not real AI emotion inference (PHASE 13), nor do they validate
human/Rive/Live2D rendering. User listening of PHASE 5 is explicitly deferred.

Browser tests cover 12 distinct static images, four finite motions, replacement,
emotion changes during motion, reduced motion, synthetic background events,
existing muted voice + all emotions, source retention, 10 mount/unmount cycles,
320x568 through desktop layouts, dark background, reload and no external requests.
The existing phase 4/5 suites remain required regression gates.

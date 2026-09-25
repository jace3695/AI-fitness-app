# WebKit navigation and PIN status repair — 2026-09-25

## Findings

PR #205's preceding full run `36109076837` failed: 712 passed, one WebKit
internal navigation error before selecting D63. The failure's artifact digest
was independently verified as
`fd4f21b369f8f0eba11f32f29ae7f826e4a232a605abc3384aa486dcc1719427`.
This failure remains a failure; earlier focused passes do not certify release.

Playwright 1.63.0/WebKit 2359 actually loads libsoup 3.6.5 in our Linux runner.
The upstream network-process use-after-free report matches the version and
symptom, but we have not captured that crash in our failing runner:
https://github.com/microsoft/playwright/issues/42803
https://github.com/WebKit/WebKit/pull/74619

Run `36129022071` compared the bundled library and official libsoup 3.6.6
source commit `25eac153004f777581ca2d95e31a02ca96844332`. Both variants passed
15 cases and 135 document requests (HTTP 200). `/proc` comm/maps and binary
hashes verified the actual library loaded by each network process:

| Variant | Version | Binary SHA256 |
| --- | --- | --- |
| Bundled | 3.6.5 | 03d635a54478e3aefd5fb202e53c8897431a6c9aaaad0408698c4b2c3a1275a3 |
| Fixed source | 3.6.6 | 7d710313cbf463acfd1c4deaee4cdd9b03b9281d3d1e0b7214418efb2e8a44bd |

The downloaded ZIP digests were independently checked:
- Bundled: `a571f9bd6830c3cbbe4195176b3f048a293f47d279087d01282765151f645a08`.
- Fixed: `c0017305d6631a75a300dc81df56344c34c0a736edc18eb77b9b37a0a4122909`.

The original intermittent internal error did not reproduce in either short
sample. This supports compatibility of the fixed library, not a causal proof
that it resolves the original full-suite failure. It is injected only into
CI's WebKit process; app production dependencies and runtime are unchanged.

Both samples still emitted page errors (70 bundled, 79 fixed). Resource-failure
events crowded the bounded history (92/33 entries dropped), so subsequent
diagnostics aggregate resource failures separately. Total error counters were
retained, but those samples cannot establish a complete per-event chronology.

## Confirmed application defect

An unhandled rejection pointed to the compiled `hasDevicePin` status lookup.
AuthGate did not catch its rejection and could render protected children before
the asynchronous PIN status completed. A non-200 or malformed status could also
be interpreted as no PIN. The repair:

- Accept only successful JSON with a boolean `configured` field.
- Keep protected children closed until the current owner is checked.
- Catch errors, show explicit retry, and ignore/cancel obsolete owner requests.
- Keep already verified same-owner focus/token refresh from unmounting an editor.
- Handle cancelled initial PIN settings-panel reads without an unhandled rejection.

No PIN bypass, permission expansion, schema migration, hosted data writes or paid
AI calls are included. This is a UI gate repair, not a claim that a client-side
PIN gate replaces server-side authentication/authorization.

Run `36130392258`, candidate `000631edc597e78530e940cdb3cbe7c44467f40f`:
21/21 browser tests passed (Chromium PIN tests, WebKit PIN/navigation tests).
All 21 fixture cleanups passed, no external origins were contacted, the actual
loaded library was 3.6.6, and unhandled PIN promises were zero. Fault tests
inject status failure/delay only; recovery uses the real local API. Original
synthetic state is checked after recovery and logout/relogin.
ZIP SHA256 verified:
`d3b84534b08f84cbae38e9f789ba00035a052e40a7ace1c74d7e10eb243690af`.

73 remaining page events classify as WebKit fetch access-check messages, mostly
at Next's RSC prefetch code, alongside cancelled subresources. They were not
silenced or counted as no errors. Their causal relationship to the original
internal navigation failure remains unproven. The repaired probe had no dropped
diagnostic entries and all 143 document responses were received.

## Release gate

The release candidate retains every pre-existing unit/SQL, sync, lint, type,
build, targeted and full browser check, with retries zero. PIN fault/race checks
are added in both browsers. Each Playwright invocation records its own result,
sanitized native counts and actual network-library identity; missing/wrong
library evidence fails CI. Authentication loading/error screenshots are
synthetic CI evidence. The complete new candidate must pass before merge.
Physical iPhone/Apple Pencil behavior is not certified by these emulated tests.

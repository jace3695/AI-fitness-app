# Candidate drawing failure and next diagnostic

## Exact candidate result

- Remote source: `125bacf3ce4e183ddaa0c8147259ca772aa6d79b`.
- [Run 37967291701](https://github.com/jace3695/AI-fitness-app/actions/runs/37967291701),
  job `113944714421`, failed in step 14, drawing save/restore.
- The last focused drawing invocation reported **93 passed / 1 failed**.
  It is not the full aggregate; step 20 never ran. Earlier focused counts remain
  separate and are not added to a replacement full-suite result.
- The sole failure was Chromium **D27: revise a copy of a saved drawing, restore
  the original reference and preserve the original**.
- D33/D34 source-preservation/deletion-snapshot passed in both browsers; this
  does not prove the historical baseline failure's cause was fixed.
- WebKit D27 passed. Beginner drawing, PIN status and repeated D06/D33 steps
  passed. Typing, handwriting, spoken ranges, assistant flows, repeat-WebKit,
  and the final full aggregate (steps 15–20) were skipped.
- New Live/calendar/typing acceptance coverage remains unverified by this run.

## Observed boundary, not an inferred root cause

The primary failure is `tests/e2e/drawing-tools.ts:9:74`, `toggle.click()` after
the D27 reload. The earlier baseline failure was `:9:20`, `getAttribute` in
D33/D34. Both happened after reload, but these are different actions and tests.

D27 already waits for `클라우드 저장 확인 완료` before reloading. It then confirms
the original server row is unchanged. The line-270 poll diagnostic is an
intermediate expectation entry: execution reached the later reload and helper,
so it is not proof that the row-count barrier ultimately failed.

The reload document was requested 1,876 ms after fixture observation began and
returned HTTP 200 at 1,880 ms. The server received it at
`2026-10-09T17:58:55.816Z` and finished at `.817Z`, in 1 ms. There was no recorded
page crash, browser disconnect, page error or failed resource before teardown.
Those observations do not prove the renderer, layout, or browser protocol was
responsive at the later click. No raw trace, exception text or failed-screen
snapshot was exported.

At `17:59:11.065Z`, the failure-only cleanup markers show:

1. `traffic-drain start` and `traffic-drain end`, both at 0 ms.
2. `unroute start`, with no `unroute end`.
3. No subsequent context-close or account-cleanup boundary.

Installed Playwright 1.63.0 updates `Network.setCacheDisabled` and `Fetch.disable`
when removing Chromium request interception. Existing evidence does not show
which internal command, if any, stalled. A route callback could also arrive
after the explicit drain. The source inspection alone does not establish a
Playwright, application-rendering, database, or storage root cause.

No application or test-flow fix was justified. In particular, adding another
save barrier would not address a demonstrated missing condition in D27.

## Cleanup and preserved artifact

Across this run, **255 emitted row-cleanup records** reported `rowsRemaining: 0`.
The failing D27 fixture did not emit its row cleanup, so that case's row-level
cleanup remains unverified. The job's whole disposable stack, containers,
volumes and local keys were successfully removed at `18:07:46.405Z`.

[Artifact 11634854046](https://github.com/jace3695/AI-fitness-app/actions/runs/37967291701/artifacts/11634854046)
was successfully uploaded and downloaded intact:

- Name: `browser-verification-125bacf3ce4e183ddaa0c8147259ca772aa6d79b`
- Size: `24,145,763` bytes
- SHA-256: `d436201bb4e305afa8b0700bb243b93eabca362a420d7b86df93bf52838de636`

The original ZIP, decoded full log, artifact metadata, job steps, failure extract
and server-reload extract are preserved separately from the repository. Earlier
baseline evidence and its failed status are unchanged.

## Opt-in diagnostic, not a runtime fix

`QA_DRAWING_PROTOCOL=1` enables a bounded protocol collector in the existing
Playwright wrapper. It records allowlisted method/event labels, command
send/resolve/reject boundaries and timings, with snapshots at failures, cleanup
boundaries and process exits. This can show whether a subsequent stall leaves
`Runtime.callFunctionOn`, a mouse/layout action or interception command pending.

Raw protocol lines are parsed only in memory and always discarded before normal
wrapper output. Parameters, results, URLs, headers, tokens, exception text and
raw correlation IDs never enter the diagnostic artifact. Unknown, oversized or
malformed envelopes fail closed. Correlation is bounded, session-local and reset
when another browser process starts. Supported top-level method names can be
observed in either engine; unsupported nested WebKit messages are ignored.
Empty diagnostics must not be called a browser success or proof of no stall.
An unmatched command means no matching reply was observed, not proof that the
browser is still executing it. Dropped or malformed-message counters must be
considered when interpreting an incomplete snapshot.

The collector adds no browser commands, sleeps, assertions, retries, test timeout
changes or cleanup suppression. It is off unless explicitly enabled. It does
add debug serialization/pipe parsing when enabled, so reproduction under it is
separate evidence, not proof of unchanged browser timing.

The next official isolated focused invocation can use:

```sh
QA_DRAWING_PROTOCOL=1 node scripts/qa-playwright.mjs tests/e2e/drawing.spec.ts \
  --project=chromium --project=webkit-small --grep 'drawing D(27|33)'
```

All existing focused and full-suite gates still need to pass on the exact
published candidate. Local browser execution is blocked by the established
socket restriction; no alternate launch or bypass was attempted. No commit,
push, rerun, hosted-data mutation, preview/account change, merge or deployment
was performed as part of this diagnosis.

## Local validation

- Drawing model, source-preservation, save-confirmation, migration and diagnostic
  contract tests: **73 passed / 0 failed**, including nine new diagnostic tests.
- New tests check secret-bearing command parameters, response bodies, errors,
  identifiers, malformed/oversized lines and unsupported WebKit messages; no
  original content appears in snapshots. They also check bounds, session-local
  correlation, process reset and the wrapper's raw-line discard path.
- Changed JavaScript syntax checks, focused ESLint, TypeScript
  (`tsc --noEmit --incremental false`) and whitespace checks: passed.
- Browser behavior and the opt-in collector's real protocol transport: not run
  locally. These source-level tests do not certify D27 or a complete CI pass.

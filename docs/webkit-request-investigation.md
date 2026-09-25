# WebKit request investigation — 2026-09-25

Release remains blocked. This branch is a bounded diagnostic experiment, not a
replacement for PR #205's full release verification.

## Verified failure

- PR candidate: `fb5d28aee201ec4f12d71d2e5cf478b662df936b`.
- Run `36109076837`, job `107988171892`: 712 passed / 1 failed across
  14 invocations; final regression 417 passed / 1 failed (418 total).
- C01–C04: 16 passed; all 713 synthetic cleanup records reported zero rows.
- D63 failed before lesson selection, navigating to `/growth/drawing`.
  `/diet/settings` returned 200. The drawing document request failed about
  2152 ms later with WebKit's internal error and no observed response event.
  No page crash, browser disconnect or page error was observed. A separate
  WebKit network process failure is not excluded by those observations.
- Downloaded artifact `10854612013` was independently hashed:
  `fd4f21b369f8f0eba11f32f29ae7f826e4a232a605abc3384aa486dcc1719427`.
  All 14 invocation reports identify the exact candidate above.
- Earlier failures moved between D06 and D33. Successful focused repeats do
  not establish that the intermittent failure is fixed.

## Experiment

The same app, production build, isolated Auth/Postgres, request allowlist and
route.continue behavior are retained. Thirty cases (15 per engine) each log
in freshly and make four round trips between settings and drawing. No retries.
Assertions cover HTTP 200, drawing readiness, authenticated sync and unchanged
synthetic original state. Existing fixture cleanup assertions remain active.

Correlate four observations by wall-clock time: browser document request,
route.continue start/resolution, passive Node HTTP receipt/completion, and
browser response/failure. Node's built-in diagnostics channels observe the
standard Next server without a proxy or replacement server. Browser native
output is reduced immediately to fixed classifications; raw lines are dropped.
No query strings, headers, bodies, credentials, traces or HAR are uploaded.

A continue resolution only shows that the automation command returned; it
does not prove the server received the request. Server completion does not
prove the browser received the body. Absence of page crash/disconnect cannot
rule out a subprocess failure. A passing probe establishes only this bounded
sample, not the full long-running regression or physical iPhone/Apple Pencil.

## References

- https://nodejs.org/api/diagnostics_channel.html — HTTP request/response channels.
- https://playwright.dev/docs/api/class-route#route-continue — continuation contract.
- https://github.com/microsoft/playwright/issues/34450 — older Linux report with
  similar symptom and native libsoup/GLib/heap messages; not proof of the cause
  in our different Playwright/WebKit version.

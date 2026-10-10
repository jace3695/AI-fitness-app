# D33/D34 save-completion barrier

## Preserved failure

Baseline `40480ea51dad01462ed63161301d7a01a21534c4`, existing
[run 37954896611](https://github.com/jace3695/AI-fitness-app/actions/runs/37954896611),
finished its final aggregate with **437 passed / 1 failed**. The sole failure was
the Chromium D33/D34 source-preservation and deletion-snapshot test.

The primary sanitized location is `tests/e2e/drawing-tools.ts:9:20`, the
`getAttribute` call before the tools-button click. The source-copy test reached
its reload: its third document request began 1,945 ms after the fixture started,
and the response was HTTP 200. The server completed that document in 2 ms.
The two line-358 polling entries are intermediate expectation diagnostics;
they do not establish that either server-row-count barrier ultimately failed.

The recorded navigation has no crash, browser disconnect, page error, or failed
resource. Raw traces, exception text, and failure screenshots were deliberately
not exported. Screenshots from other successful drawing cases do not show this
failure. This evidence does not prove a storage-loss, menu-readiness, or
checkpoint-race root cause.

The fixture subsequently timed out at `context.unrouteAll({ behavior: 'wait' })`
after its explicit traffic drain. Installed Playwright also updates Chromium
network interception at that boundary, so the location alone cannot distinguish
an active callback from an unresponsive browser command. The failed test's
row-level cleanup is unverified. The job's whole disposable stack/container/
volume/key removal succeeded. Existing cleanup evidence and boundaries are
preserved; no teardown error is suppressed.

## Demonstrated synchronization gap

The test previously advanced once an independent DB read observed the expected
row count. The actual `useDrawingRecords.save` implementation writes that row
before awaiting its local confirmed checkpoint and before returning to
`DrawingPage`, which then clears dirty state and displays its confirmation.
The final D34 path could therefore delete the source and reload while client
save completion was still pending.

`tests/drawing-save-confirmation.test.ts` executes the shipping hook source with
deterministic hook-state and synthetic service/storage adapters. It holds only
the final local confirmation, without a timing sleep. For D33 and D34:

1. The original expected DB row count is already satisfied.
2. The save is unsettled, busy is true, and local recovery is pending at revision 0.
3. Releasing confirmation finishes the same operation, clears busy, and preserves
   the exact saved row with pending false and matching revision/baseRevision 1.
4. The original D31 source remains byte-for-byte equivalent as an object.

This establishes the ordering gap. It is a source-level contract test with
synthetic boundaries, not React rendering, IndexedDB, browser, or Supabase E2E.
It does **not** prove that this gap caused the historical `getAttribute` timeout.

## Narrow correction and validation

The existing D33/D34 E2E now requires the cloud-confirmed UI after each save and
checks its exact local confirmed revision/base revision, plus the saved source
reference. All original row-count, source-preservation, deletion, snapshot,
and unrelated-record assertions remain. No application code, timeout, retries,
failure suppression, fixture cleanup, workflow gates, credentials, or data-reset
behavior changed.

For failed tests only, the fixture additionally emits Node-side start/end markers
around its existing traffic drain, unroute, context close, and account cleanup.
The wrapper retains these fixed phase/boundary labels and elapsed milliseconds.
No new browser command, wait, raw error, URL, identity, or row data is collected.
The markers distinguish which boundary returned; they do not inspect or claim
to distinguish individual internal Chromium commands within `unrouteAll`.

- Targeted drawing contract, model, and migration checks: **57 passed / 0 failed**.
- Changed-file ESLint and whitespace validation: passed.
- TypeScript (`tsc --noEmit --incremental false`): passed.
- Browser execution: not run locally; the existing browser socket restriction
  was respected. No alternate launch or workaround was attempted.
- The next official isolated CI must test the corrected ordering and the full
  drawing flow. This is not a claim that the baseline browser failure is fixed
  or that the candidate has passed browser validation.

No old-CI rerun or cancellation, hosted mutation, merge, or deployment was made.

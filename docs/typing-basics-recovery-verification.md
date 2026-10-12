# Typing basics interruption recovery

Date: 2026-10-09 UTC / 2026-10-10 KST. Local candidate changes; no commit, push, hosted operation, schema change, or browser execution in this slice.

## Implemented boundary

- The physical-key basics page has an authenticated, owner-keyed child. A late response for account A cannot mark B saved or remove A's checkpoint.
- One bounded owner-scoped local snapshot stores the selected lesson content, attempt position, key-press count, per-target-key mistakes, first/last key timestamps, two explicit self-checks, and an optional immutable save request. Valid earlier lesson text/sequence snapshots survive an app content update.
- Key and check changes checkpoint synchronously with prior-byte comparison and read-back. Quota failures retain the visible attempt, block further mutation/save, and offer a checkpoint retry. A stale tab never knowingly overwrites a newer checkpoint. Initialization rechecks the stored bytes after its asynchronous reads, so a late response cannot unlock a snapshot another tab has replaced.
- A save stages its UUID and complete payload under the existing same-origin growth synchronization lock before any network write. Recovery retries query first; only confirmed absence permits the same request to be sent. Success requires a matching independent server readback.
- Existing `save_sentence_typing_session` is reused without changing its SQL. Despite its original name, the existing contract admits `source='typing'`, completed/partial status, bounded minutes and timestamps, and object metrics up to 4,000 bytes; the existing basics course payload fits. Production SQL/RLS tests exercise the actual basics payload. No direct INSERT fallback is present.
- Reset generation is checked on restore and again before saving; the RPC's existing transaction lock remains the authoritative cross-device reset fence. A reset observed while initialization is pending cannot be undone by the late initialization response.
- Unsaved reset/lesson changes retain the explicit discard confirmation; cancellation changes no attempt or timer. Pending/uncertain saves remain locked. Modifier, repeat, Shift, Tab, blur, physical key code, and Korean IME behavior is preserved.
- Repeating a historical lesson preserves its snapshot even if the current course has removed or reordered that lesson. Explicit course selection uses the current content. A saved removed lesson remains a valid cloud record but does not inflate the current-course completion count.
- Time remains wall-clock elapsed time from the first key through the last key, including pauses. It is not invented active practice duration. Attempts exceeding the RPC minute bound stay recoverable and show an explanatory notice; they are not silently shortened or sent.

## Verification executed

- Focused unit / shipping-hook / shipping-component / real SQL-and-RLS PGlite checks: **85 passed, 0 failed** after independent review.
- Command: `node --experimental-strip-types --test app/data/typingBasics.test.ts lib/typing-basics-draft.test.ts lib/sentence-typing-draft.test.ts tests/typing-basics-recovery.test.ts tests/typing-basics-ui.test.ts tests/typing-basics-rpc.test.ts tests/sentence-typing-recovery.test.ts tests/sentence-typing-ui.test.ts tests/sentence-typing-migration.test.ts tests/sentence-typing-fixture.test.ts`
- Focused ESLint on changed typing source and tests: passed.
- `npx tsc --noEmit --incremental false`: passed on the author baseline. The coordinating task owns the final aggregate rerun after independent-review changes.
- `git diff --check`: passed.
- Existing sentence exported helper names and behavior are retained. Only the immutable save/readback implementation and shared session type moved to `lib/typing-session-recovery.ts`.

## Independent review

- Demonstrated and fixed the initialization race with a newer-tab checkpoint, both with and without a delivered storage event. Both regressions failed before the fix.
- Demonstrated and fixed a reset exception for a valid historical lesson index absent from the current course, plus stale historical IDs inflating the completion count after save. The historical reset and count regressions failed before their fixes.
- Added shipping-component coverage distinguishing same-snapshot repetition from explicit current-course selection, and shipping-hook coverage proving that an RLS-empty read under another authenticated account cannot authorize an absent-row retry while the UI still shows the old owner.
- All six added regressions pass. Existing sentence tests, the shared recovery implementation, and SQL remained unchanged during this review. No browser, hosted/API, deployment, commit, push, or shared workflow/config action was performed by the reviewer.

## Authored browser acceptance, not executed here

`tests/e2e/typing-basics-recovery.spec.ts` contains nine cases:

1. 320px partial lesson/mistake/timer/check reload, discard cancellation, save readback, original preservation.
2. The same flow at 390px.
3. Committed write with both response/read confirmation unavailable, reload, read-first recovery without another POST.
4. Absent write with the same failures, reload, confirmed absence, byte-equivalent request retry.
5. Delayed A response across account B and return to A.
6. Other-device reset between marker GET and RPC; no old-row resurrection.
7. Missing RPC deployment; no unsafe fallback; later exact retry.
8. A newer second-tab checkpoint cannot be overwritten by the stale tab.
9. Local quota failure, visible input retention, successful checkpoint retry before save.

The existing `tests/e2e/typing-basics.spec.ts` response-loss interception now targets the fenced RPC. Parent-owned workflow/config registration includes the new spec in Chromium and small WebKit.

Actual browser acceptance remains pending because the session's browser-access restriction is still in force. These unit/PGlite and authored E2E checks do not establish browser, hosted deployment, physical-keyboard, iPhone/PWA process-kill, long-background, or real-version-rollout acceptance. Required full-candidate CI/build and deployment gates remain owned by the coordinating task; no unrelated component was changed by this slice.

## Default transport retries accounted for · 2026-10-09 20:05 UTC

The sentence recovery CI diagnosis also exposed the same assumption in the two newly authored basics uncertain-write cases: one logical failed read was expected to produce one HTTP GET. The installed PostgREST 2.110.8 client instead retries HTTP 503 three times, with `X-Retry-Count` 1, 2, 3 and the original 1s/2s/4s backoff.

- Updated only the basics E2E observer to assert each request's exact growth_sessions path, owner and frozen row ID, then require the full sequence `GET`, `GET:retry:1`, `GET:retry:2`, `GET:retry:3`. No additional POST is allowed. Successful committed recovery still requires one GET; confirmed absence still requires exactly GET → the same POST → GET.
- Added identifier-free `QA_BASICS_RECOVERY_TRANSPORT` diagnostic output. Requests are neither hidden nor dropped from the assertions; application retries, timeouts and persistence behavior are unchanged.
- Extended `tests/sentence-typing-transport.test.ts` with committed and absent basics payloads created by `makeTypingBasicsSession`, exercising the shipping shared confirmation function and real installed Supabase client against an in-memory fetch boundary. This proves one logical read, four same-ID HTTP attempts and zero writes during uncertainty, followed by the original exact recovery order. No server or browser is launched.
- Read-only inspection found no equivalent GET-count assumption in handwriting recovery E2E. Its offline progress route passes ID-filtered recovery reads through, and its response-loss counts concern POST requests, which this SDK does not automatically retry. No handwriting file was changed.
- Combined typing basics/sentence focused suite: **89 passed, 0 failed** (the preceding 85 plus four real-client transport cases). Changed-test ESLint, full `tsc --noEmit --incremental false` and `git diff --check` passed. Evidence: `typing-combined-transport-final.log` in the coordinating task's validation output.

Fresh Chromium/WebKit acceptance of both basics uncertain-write cases remains pending.

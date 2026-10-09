# Live P2/P3 independent verifier authentication correction

2026-10-09 19:22 UTC (2026-10-10 KST). Local candidate on
`3a36a3951dad625d94a65e607cb3a16ca8c99733`; no publication by this task.

## Observed CI evidence

The real disposable-browser [run 37975602088](https://github.com/jace3695/AI-fitness-app/actions/runs/37975602088)
finished its early handoff suite with 64 passed and 18 failed. Within Live P2,
seven scenarios passed in each browser. These two scenarios failed in both
Chromium and WebKit:

- Source excerpts/four independent skills/reload/relogin.
- In-flight account A receipt/account B isolation/same-request A recovery.

The allowlisted reporter classified all four as `other`, with no source location
or failing Playwright step. Navigation diagnostics recorded no crash, disconnect,
or page error. The log does not contain the raw exception, so it cannot prove the
specific failed expression by itself. The artifact metadata exists, but ZIP
materialization was denied; its bytes, screenshots, and hash were not locally
verified. No alternative download route was used.

## Evidence-backed root-cause candidate

`CloudSyncPanel` uses `supabase.auth.signOut()` without a scope override. The
installed `@supabase/auth-js` 2.110.8 implementation defaults to `global` and sends
`/logout?scope=global`. The fixture originally signs in an independent Node
Supabase client for each synthetic account. Browser global logout revokes this
client's Auth session too; signing back into the browser does not refresh that
separate client.

Both failed P2 scenarios call `readLearning()` on the original Node client after
browser logout/relogin. This repository intentionally verifies `auth.getUser()`
before and after its RPC. In contrast, the passing P1 post-relogin helper reads
history directly through PostgREST; an unexpired JWT does not prove that its Auth
session still exists. The P3 account-switch scenario had the same stale-verifier
pattern.

Official references agree with the installed implementation:

- [Supabase signOut documentation](https://supabase.com/docs/reference/javascript/auth-signout)
- [Auth global-logout implementation](https://github.com/supabase/auth/blob/master/internal/api/logout.go)
- [Auth session lookup and session_not_found rejection](https://github.com/supabase/auth/blob/master/internal/api/auth.go)

This explains the failure pattern and is reproduced at the SDK/transport unit
boundary. It remains a root-cause candidate for the exact CI failures until the
new real-Auth regression and unchanged failing flows run on a fresh commit.

## Minimal correction and regressions

- Added `tests/e2e/fixture-account-auth.ts`. Explicitly re-signs in the synthetic
  verifier with its existing fixture credentials, checks both returned owner IDs,
  then performs an authoritative `getUser()` exact-owner check. Errors contain
  fixed text rather than provider payloads or credentials.
- P2 and P3 relogin helpers invoke it only after browser login reaches the normal
  ready state. Browser storage/session state is never injected or replaced.
- Existing assertions, application `getUser()` checks, global logout behavior,
  repository ownership checks, timeouts, and retry counts are unchanged. There
  is no privileged-client fallback or implicit retry of a failed repository read.
- Added a P2 real-browser scenario explicitly asserting that global logout makes
  the old verifier return `session_not_found`, and that fresh owner-verified
  authentication restores repository access while the browser stays logged out.
  This is authored coverage, not an executed browser result.
- Added two unit regressions. The installed SDK executes against a fully
  in-memory synthetic transport that distinguishes revoked Auth sessions from
  issued access tokens. It proves rejection before the repository RPC, fresh
  sign-in before `getUser()`, successful owner-scoped verification afterward,
  preservation of the independently signed-in browser session, and rejection of
  sign-in errors, absent sessions, wrong owners, or failed identity checks.

## Verification and remaining gate

Executed after the local runtime restart:

```text
node --experimental-strip-types --test tests/fixture-account-auth.test.ts lib/language-live/learning-repository.test.ts lib/language-live/preparation-repository.test.ts tests/language-live-learning-ui.test.ts tests/language-live-preparation-ui.test.ts
```

43/43 passed: 2 fixture-auth, 9 P2 repository, 7 P3 repository, 8 P2 component,
17 P3 component tests. Component tests execute shipping logic at synthetic React
and storage boundaries; they are not rendered browser or visual checks.

Scoped ESLint for the helper, its unit tests, and both browser spec files passed.
`git diff --check` passed. A local aggregate TypeScript invocation was deliberately
stopped to avoid concurrent integration checks; no pass is claimed from it.

Current authored browser inventory: 10 P2 scenarios and 13 P3 scenarios, each
selected for Chromium and WebKit. This correction changes only the P3 relogin
helper, not its other independently authored scenarios.

No browser was launched in this task; the prior EPERM restriction was respected.
Fresh exact-commit CI, final aggregate typecheck/tests/build, visual review, and
real authenticated browser verification remain integration gates. No hosted
database/API, paid service, production resource, commit, push, or deployment was
used or changed by this correction.

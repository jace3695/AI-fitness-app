# PR189 local browser lab

This lab renders the actual calendar, cloud sync panel and PWA manager with the
app's CSS. It uses synthetic authentication and a loopback-only in-memory server.
It never reads environment files or personal backups. Do not put real data here.
The application build does not import these files.

From the repository root, install the normal dependencies with `npm ci`, then:

```sh
npm --prefix scripts/browser-qa ci
npm --prefix scripts/browser-qa start
```

Open http://127.0.0.1:8870/ in the desktop browser. Ports 8871 and 8872 provide
independent origin storage and 320px/390px iframe viewports, sharing one fixture
server. The displayed dimensions are measured in each actual document. This is
not a device emulator, real Supabase authentication/RLS, or the full Next router.
All logical GET/PATCH operations travel as POST JSON envelopes over real HTTP.
The evidence file records the envelope, computed response and delivery result.
It does not capture production Supabase SDK traffic.

The next-request fault is global across both sessions. Check its request origin;
a background poll may consume a GET fault before your intended action. A delayed
PATCH commits before holding the response. A lost PATCH commits then destroys
the socket; a browser may retry the same request. Conditional `updated_at` checks
still reject stale writes. GET errors return HTTP 503. Release pending responses
before finishing. Service worker version changes alter only a trailing comment
in the actual app worker, so the browser performs a real update lifecycle.

## Reproducible browser sequence

1. A: create September 7, completed, one `QA189 스쿼트` set of 9 reps, memo
   `QA189-delayed-first`; hold its PATCH response. While held, edit the memo to
   `QA189-delayed-LAST`, save, switch to the other screen, then release. Check
   the server's final memo and preservation of the four fixture dates.
2. B: sync and edit September 7 memo to `QA189-B-response-lost`. Arm response
   loss before saving. Check recovery and no duplicate exercise detail.
   Arm GET failure, manually sync, observe the error, then retry.
3. A: edit September 7 memo to `QA189-A-concurrent`. B: prepare September 6,
   completed, one `QA189 B 런지` set of 8 reps. Hold A's GET after saving A,
   save B and wait for its PATCH, then release A. Inspect the rejected stale
   PATCH, re-read and successful merged PATCH. Sync both and inspect both dates.
4. A: open an edit and enter an unsaved memo. Prepare a new worker version and
   check for updates. Confirm update is disabled and the draft remains; cancel
   editing, apply the update, and inspect the saved records after reload.
5. Delete September 7 in A and immediately switch screens. Delete September 6
   in B and immediately switch screens. Confirm the server equals its fixture.
6. Use **합성 세션 정리** in both frames, then **서버 합성 데이터 정리** in the
   controller. This clears only disposable local origins and in-memory data.
   Run `node scripts/browser-qa/audit.mjs` to audit the captured requests.

Generated bundles and synthetic evidence are ignored by Git. Copy evidence
elsewhere before restarting: a new run replaces it. Stop the server with Ctrl+C.
Close all old lab tabs before starting a fresh run. Browser cleanup must happen
before server cleanup so mounted sync panels cannot repopulate an empty server.
Real background suspension, installed mobile PWA behavior, authenticated preview
session conflicts and full-app HTTP bodies remain separate verification tasks.

The committed synthetic capture can be audited without starting a browser:

```sh
node scripts/browser-qa/audit.mjs scripts/browser-qa/evidence/2026-09-09.json
```

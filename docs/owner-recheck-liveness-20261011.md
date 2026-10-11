# Exact-ready owner recheck

Development candidate, 2026-10-11 UTC. This is a bounded same-document liveness change, not browser acceptance or production approval.

## Observed failure and reproduced gap

General CI run `38138340511` at `e637999c15db0026695a00f8fb062f4764ea4edc` completed the first browser group with 289 passes and one WebKit owner-switch failure. After B login, the first tab had coherent B owner/readiness, exact B local records and a session-changed sync error; the holder was synced. Three real reads and no writes occurred, and both synthetic accounts were cleaned up. No navigation/resource/continue failure, crash or page error explained the timeout. The log does not contain the internal proof/registration event order.

A shipping-code synthetic probe reproduced one missing ordering: Gate emits its fresh B proof before the panel subsequently exhausts a coherent-snapshot read during a peer write. Gate retains a valid B lease and editor while the panel retires. Replaying the earlier proof is deliberately forbidden, and generic storage/focus/polling wakes cannot restore the retired loop. This source-level reproduction is consistent with the observed state but does not establish the exact historical WebKit ordering.

## Bounded handshake

- An actual active-to-retired panel transition may schedule one deferred recheck attempt. The retired and current desired owner and raw epoch must agree. Coherent ready storage, no pending transaction/reset, and the existing `languageMetadataReadyForEpoch` predicate are required before issuance and Gate acceptance.
- A request is a frozen same-document object registered against storage, retirement identity and exact epoch. It is not a lease. Gate claims it once, and a module-local verification-start serial rejects completed or pending pre-request leases as responses.
- Gate performs fresh `getUser`, exact-owner checks and PIN readiness. The request-specific path never calls `prepareLocalCloudState`, `clearLocalCloudState` or a storage writer. It cannot adopt a newer epoch or cancel the only normal preparer when readiness is missing.
- The requested proof is correlated in the private registry and uses a dedicated completion event. Ordinary READY events cannot substitute it. The panel independently calls `getUser` and starts a new read only after guarded activation; the retired closure stays dead.
- Authentication callbacks, explicit retry, sign-out, reset, unmount and epoch change cancel pending work. Automatic replacement bindings inherit the consumed request budget, so storage/focus/timer events cannot create a recovery chain. Existing unsolicited fresh post-retirement READY recovery remains separately guarded.
- Successful consumption detaches pending cancellation without aborting the new Gate lease. Later route Gate unmount does not stop the independent global panel loop. Failed requests remain explicit retry cases.

## Same-owner draft preservation

Only an authenticated editor that was actually committed as the current Gate branch can be preserved during a bounded request. A layout-effect ref records that committed branch. The owner-keyed Fragment, nullable owner Provider and permanent wrapper retain the same ancestor/child slot during normal, hidden and recovered states. While suspended, the old lease is revoked, the Provider has no lease, and the wrapper is explicitly `display: none`, hidden, inert and aria-hidden.

This is not suspension of descendant effects. Lease-backed actions must reject revoked authority; existing storage-owner guards remain mandatory. A password-recovery/PIN/error branch never mounts authenticated children merely to preserve them. Authentication failure, owner/epoch change, reset, sign-out and cancellation return to the existing fail-closed unmounted UI. The global dialog focus hook checks live visibility, connection and hidden/inert ancestors before focus containment or restoration. The handwriting image dialog closes its native modal on revoked/null authority without unmounting or replacing its node, and reopens only for a registered lease matching its immutable original pane owner and epoch. Its original trigger is captured once; suspension never invokes the React user-close path. A delayed native close event cannot destroy the restored dialog. Actual global keyboard, native top-layer and browser accessibility behavior still needs approved browser evidence.

## Selected-key capability audit

The only storage capability added to `authenticatedStorageOwner.ts` is read/guard composition: desired owner, coherent snapshot, transaction state, current ownership and language metadata readiness. The challenge path does not prepare, repair, clear, mutate or publish selected language keys. Normal AuthGate preparation and CloudSyncPanel acknowledgement paths are unchanged. The nullable Provider matches the already-nullable context/hook; the calendar consumer clears language projection on null/revoked authority. The handwriting comparison consumer adds only a registered lease assertion for native modal presentation. It does not add storage mutation or authentication/preparation authority. Capability inventory hashes for changed external callers are rebound only after this inspection; the reviewed selected-key boundary is not expanded.

## Verification

The focused suites cover the previous proof negatives plus exact-ready deferred eligibility, old/pending proof rejection, duplicate/wrong-channel responses, foreign/copied/consumed requests, one-shot lineage budget, nested Gates, pending normal preparation, correlated Gate/PIN/panel/activation cancellation, explicit retry/new callback supersession, failures, revoked captured authority and same-owner draft ancestor preservation. These are synthetic React/host/lock tests, not actual browser runs or a claim that real React reconciliation was exercised.

Required next evidence is the final reviewed-tree aggregate and approved GitHub Chromium/WebKit execution of the original queued-owner-switch scenario, with its existing isolation/reload assertions and no test-side recovery. Local browser launch remains unavailable by an explicit access restriction. The independent Next route-cache harness change is preserved separately.

## Browser coverage prepared for approved CI

Four new cases are in the existing `storage-protocol.spec.ts` / `handwriting-comparison.spec.ts` selection for Chromium and small-screen WebKit, with the existing retries, timeouts and assertions unchanged:

1. Unsaved diet textarea value and exact DOM identity survive the hidden recheck; hidden input is inaccessible to keyboard/focus, then an explicit save is checked against the actual database and after reload.
2. An open custom navigation dialog retains its exact DOM node and resumes visible focus containment and Escape/trigger restoration; while hidden, it cannot capture outside retry/logout focus.
3. An open handwriting native dialog retains its exact node, drops `open` and `:modal` during recheck, and permits outside recovery control focus/actionability. A fresh exact-epoch lease reopens that node; a delayed close event is harmless and user Escape restores the original trigger.
4. Actual sign-out during a held native recheck removes the old node before the late auth response. Re-signing into the same account creates a new epoch and cannot revive the old dialog; a fresh explicit image selection creates a different node.

The browser-only trigger wraps registration of the uniquely identified real panel session callback, preserving listener/capture/once/abort removal semantics and refusing zero/multiple matches. It invokes only that callback under exactly six changing protocol reads, scoped to the local-storage object and exact protocol key, restoring the complete getter descriptor in `finally`. It neither broadcasts a session change nor publishes a proof/readiness value. Complete storage bytes are compared privately in-page; only fixed boolean/count results leave the page. One genuine successful owner-authentication response is held without changing its body. Authenticated pending hidden state must actually be observed. Matcher/read-contract drift fails the case without fallback.

Pure extracted-source tests cover the focus hook, actual native-dialog lifecycle with registered leases, and the trigger contract. The existing outer handwriting account-gate fixture gained only closed-map import stubs that throw if editor authority is unexpectedly used; its assertions remain unchanged. The new browser cases are authored and statically discoverable, but not executed locally. Actual draft retention, focus/accessibility, native modal inertness and original owner-switch acceptance are still pending approved CI.

## Aggregate 57 host reconciliation

The first aggregate found two incomplete synthetic-host bindings, rather than failed runtime preservation assertions: all 13 diet VM cases stopped while loading the owner registry before its real language-boundary dependency, and 49 of 50 extracted-effect sync cases stopped at the missing `requestOwnerRecheck` ref. The diet host now loads that same real boundary module first; both hosts expose their existing deterministic window timers as browser-global aliases, and the sync host supplies the actual ref. No authority/proof stub, real timer, runtime change or assertion relaxation was introduced. Every original case body in both hosts remains byte-for-byte unchanged. Focused reruns pass 13/13 diet cases and 50/50 sync cases; a fresh complete aggregate is required against the rebound inventory.

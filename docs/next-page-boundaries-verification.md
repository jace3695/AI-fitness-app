# Actual Next page boundary verification — 2026-10-21

This supplements the frozen 936-test candidate `a51ec24e8f27a26a0d54fb983fc7f02ec42b4b6bf738bc5a28e9308d6daddbdc`. No publication, service changes, real account access, provider calls, or real record writes/deletions occurred.

## Isolation and scope

`node scripts/next-page-boundaries.mjs` runs the actual Next development renderer in headless Edge. The process receives an allowlisted environment, a synthetic loopback Supabase URL/key, and a process-local network guard. Browser routes fulfill synthetic Auth/REST/API responses; all other external origins are aborted. No security settings or dependencies were installed or changed. Automatic app-state POST requests are intercepted locally; they are not real service writes or persistence verification.

Both cat and human appearances traverse `/`, `/fitness`, `/budget`, `/assistant`, and `/language`. The fitness page opens its real record view and weight-management tab. The budget page opens its actual record form. These are full browser navigations/reloads, not a claim of Next client-link transition testing. Appearance and motion-off preference survive all routes. Each page has exactly one character canvas and no legacy duplicate mascot. Horizontal overflow, runtime exceptions, and browser console errors are checked.

At 320×420, the first visible editable field on home, weight management, budget, and assistant is focused, scrolled into view, and hit-tested at nine interior points (top/middle/bottom × left/center/right, inset 16px to avoid rounded corners). The host enters quiet mode and the floating scroll-to-top button must be absent. Japanese landing has no editable field; Japanese conversation input is not covered by this full-page run. Viewport reduction is a keyboard-space simulation, not physical keyboard/device verification. Actual account-switch/private-state reset coverage remains the preceding isolated component tests, not this single-account full-page run.

## Found and fixed

The weight input initially landed at y=95.47–132.47 under the sticky fitness header. `elementFromPoint` identified `.app-module-header-inner`, not the character, as the covering element. Explicit centered scrolling still reproduced the issue with existing bottom scroll margins. Added `scroll-mt-36` to inputs and textareas within `app/components/BodyRecordCard.tsx`.

Screenshot review then exposed the budget record textarea's top being covered although its center passed. Strengthened the test to top/middle/bottom, reproduced its failure at y=96.45–229.45, and added the same utility to `#ai-record-input` in `app/budget/page.tsx`.

Further visual review identified the floating scroll-to-top button over the lower-right textarea. `components/ScrollTopButton.tsx` now suppresses itself while an input, textarea, select, or contenteditable element is focused. Its existing animation-frame visibility scheduler handles focus events, with listeners removed on unmount. The final browser check covers nine interior points and asserts the button is absent during editing. No common layout, character renderer, or Japanese implementation file changed. React review: no fetching/account/save behavior changes; existing effect cleanup and passive scroll listener preserved.

The first fixture run also exposed a missing synthetic budget profile and deliberately unavailable history API response. Those were corrected to the existing response contracts in the test harness, not by altering application behavior. They are not production API verification.

## Results and evidence

- Actual Next: 10 page/appearance checks, 2 weight-tab checks, 8 reduced-viewport field checks passed. Runtime errors 0, console errors 0, attempted external browser origins 0. See final `result.json` for the authoritative outcome.
- Same revised runtime: main unit/static/synthetic SQL suite 910/910; separate AI budget-control suite 26/26; TypeScript and changed-file ESLint passed. The latter 26 are AI cost/request-limit tests, not household-ledger tests.
- Production build passed for the prior frozen candidate; not rerun for this small scrolling/focus runtime revision. Actual Next dev compilation and browser rendering exercised the revised components.
- Evidence: `scripts/browser-qa/.generated/next-page-boundaries/` contains result, server/test logs, route screenshots, focused 320×420 screenshots, and the last pre-fix budget occlusion screenshot.

## Remaining external decisions

Real Auth/DB save-and-reload, RLS isolation, physical devices/keyboard/audio, and deployment remain untested/unapproved. Confirm a dedicated test account and non-production target before service testing. Any cleanup requires explicit permanent-deletion approval; the app cannot restore deleted analysis history. The active project ref is known, but protected deployment URL values were not read and Preview/Production database sharing remains unconfirmed.

Historical model choices are recorded in `docs/app-boundaries-followup.md`: free Gemini advice/photo and saved Zephyr audio. Current eligibility, monthly allowance/expiry, Japanese audio provider/retention, and new-response speech/alignment still need decisions. This run does not authorize or verify new paid/free provider calls, and does not mark remaining agreed advanced features complete.

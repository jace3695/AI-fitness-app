# Record navigation and plain-language UI (local candidate)

## Scope

- Record view: top-level Integrated summary / Weight management / Workout records tabs (Korean UI labels). Summary contains only four monthly indicators and recent weight.
- Weight management retains photo import/review/save, manual body records, goal and weight chart, body trends and diet/water/fasting/meal details.
- Workout records retains dated general/cardio/pull-up/foam-roller entries and their editors, workout times, recovery/condition, notes, monthly summary and detailed analytics/coach access.
- Shared calendar is collapsed behind a date-selection disclosure by default. All editor panels stay mounted when hidden. Tab clicks never save. Keyboard arrows/Home/End operate tabs.
- Photo flow uses plain Korean for select photo, check contents and save. Failure and unsaved messages avoid OCR/candidate terminology. No parser accuracy change is included.
- Same-date manual body drafts survive unrelated record refreshes, including saving a daily note in another tab. Successful save/delete and date/account changes reset this manual dirty state. OCR drafts retain their existing ownership/date protection.
- Every listed home exercise has separate method disclosure and explicit add button near the card top. Opening methods does not write settings. Add still saves immediately and says so; already-added entries disable their add button. No global apply/cancel transaction was introduced.
- Exercise prescriptions, exclusions, pain filters, data keys, schema and paid-AI rules are unchanged. This is simpler usability, not a child exercise program.

## Verification

- PASS: 747/747 unit tests.
- PASS: 20 component-browser checks covering reviewed-date save/conflicts, delayed OCR/account changes, rollback, exercise guidance/source IDs, all five additions, exclusions, demo controls and responsive widths.
- PASS: 10 record-navigation browser checks: collapsed calendar, manual and OCR drafts across tabs, OCR completion while hidden, no implicit saves, explicit save/reload with memo preservation, unrelated note save, hidden account invalidation, unreadable-photo/cancel state, workout/note drafts, keyboard tabs, and 390px layout. Some related assertions are grouped in one check.
- PASS: changed-file ESLint, TypeScript noEmit and local production build.
- Browser evidence is generated under ignored scripts/browser-qa/.generated/fitness-priority (record-navigation-result.json, record-nav-*.png). Screenshots were visually inspected. Synthetic data and mocked OCR only; no shared cloud DB writes.
- Reproduce navigation: PowerShell `$env:FITNESS_RECORD_NAV='1'; node scripts/fitness-priority-browser.mjs` in a fresh shell. Run baseline without that environment variable.
- NOT VERIFIED: original-image OCR accuracy, authenticated deployed app/remote synchronization, physical device use. The known 7614707 zero-candidate regression is not claimed fixed.

## Release hold

No push or deployment for this UI work. Actual original-image OCR verification remains a prerequisite before another Preview rollout. Main/Production, security settings, alignment images and private health files were not changed. The separate OCR diagnosis script/document remain distinct from this UI change.

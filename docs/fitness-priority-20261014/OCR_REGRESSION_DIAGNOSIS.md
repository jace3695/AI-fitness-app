# OA OCR crop correction — local verification

## Finding and change

The Preview parser at 7614707 recognized the date but returned zero numeric candidates on the user's original OA long report. After the user copied that original into the permitted private workspace, a local baseline reproduced zero candidates. Broad crops included card borders and status-pill/unit text; the complete-number validator correctly rejected those mixed strings. Earlier blank-background synthetic tests had missed this interference.

The correction isolates weight, score, ordinary values, the unbadged value and segment values separately. Ordinary rows stop before the colored status-pill boundary. The score crop includes three digits and removes smaller trailing unit glyphs; internal/leading punctuation is retained. Confidence >=60, two agreeing reads, complete numeric tokens, required decimals, numeric ranges and exclusion of age categories remain unchanged. No decimal guessing, character substitution or derived health values was added.

The parser remains specific to the OA long-report layout. One original image does not establish support for other InBody formats or general OCR accuracy.

## Private-original evidence

Only the explicitly supplied original was inspected and exercised. Original image, expected values, raw traces and file metadata stay outside the repository. A manually transcribed comparison is performed inside an isolated browser and returns field IDs/counts only. No actual values or measurement date are included here.

- Before correction: date recognized, zero numeric candidates.
- After correction: date matches; 25 numeric values match; zero missing, mismatched or unexpected values.
- Age category intentionally remains blank and is outside the 25-value comparison.
- Temporary browser context, local worker/model assets, loopback server; zero external requests and no application/database record writes.

`OA_LOCAL_IMAGE` must explicitly name an absolute local JPG/PNG. Optional `OA_EXPECTED_JSON` enables assertions for date and all expected values. Private reports are written outside Git. No source image is embedded in the test or deploy output.

## Regression evidence

`node scripts/oa-ocr-diagnostic.mjs <mode>` uses actual Tesseract with synthetic fixtures and local assets:

| Case | Expected accepted values | Purpose |
|---|---:|---|
| clean | 4 | Clear numeric tokens |
| labels | 2 | Mixed uncolored status text remains rejected |
| badges | 3 | Numeric region isolated; one low-confidence integer remains blank |
| score-limit | 4 | Shifted three-digit score 100 is preserved |
| score-decimal | 4 | Internal decimal is preserved, never changed from 9.5 to 95 |
| low-resolution | 2 | Lost decimal and uncertain integer stay blank |

Initial assertions expecting all four badge values and three low-resolution values failed. Diagnostics confirmed confidence 52 for one badge read and invalid/disagreeing low-resolution integer reads. Tests now explicitly verify conservative omission, rather than weakening acceptance gates. The score crop's initial narrow alternative was replaced to prevent three-digit clipping; independent review also identified internal punctuation deletion, now guarded and covered by the score-decimal case.

The actual RecordCalendarView browser harness uses synthetic data only. Clear and low-resolution cases cover OCR, editing date/values, manual completion of uncertain values, existing-record confirmation, memo/age preservation, explicit save, reload and calendar re-query. Low-resolution expectations were changed from three candidates to two after observing the rejected integer. This is a documented recognition limitation, not an assertion of perfect OCR.

## Release boundary

This parser correction is separate from local record-tab UI commit 0342214. No new remote push, Preview deployment, main merge or Production deployment has occurred for either change. The prior READY Preview still runs 7614707. No shared Supabase writes, paid AI calls, health-data uploads, service/security changes or alignment-image operations were performed. Parent review is required before the next push/deployment.

## Final checks (local)

- PASS: TypeScript without incremental cache; scoped ESLint; production build; git diff whitespace check.
- PASS: 747/747 unit tests; 20/20 baseline browser checks; 10/10 record-navigation browser checks.
- PASS: 6/6 synthetic actual-OCR diagnostic cases, including score 100 and internal decimal 9.5.
- PASS: clear and low-resolution actual-OCR browser save/reload cases (2/2).
- PASS: private original comparison, 25/25 values and date; no missing/mismatched/unexpected fields.
- Resolved failures: initial crop/fixture recognition assertions and a temporary diagnostic script scope error, diagnosed and rerun successfully. No final failing checks remain.
- NOT RUN: new protected Preview/Production smoke tests and cloud persistence tests; no new deployment and shared cloud writes are prohibited.

Independent review confirmed the internal-punctuation issue is closed in code. The subsequent real Tesseract decimal regression also passed. Local browser tests use isolated synthetic storage and do not verify Supabase persistence.

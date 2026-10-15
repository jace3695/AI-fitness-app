# OA OCR follow-up (2026-10-15)

## Scope

Follow-up to Preview 7268af9; only OA long-report OCR, review messaging, and regression fixtures changed. Other report formats are not claimed supported. No real report, identifying filename, health values, videos, credentials or transfer URLs are included in this commit.

## Cause and change

- Header previously used a narrow single-line crop and digit whitelist. It now reads a broader multiline header, extracts a unique date, and validates the actual calendar date.
- Value crops previously could clip trailing characters. Wider crops, dark-background inversion, content contrast normalization and foreground trimming improve synthetic low-resolution reads.
- The parser formerly substituted letter-like digits, selected numeric fragments and guessed missing decimal positions. It now requires a complete numeric token, a visible decimal for decimal fields, an allowed range, and agreement between two crop/scale reads with confidence >= 60. Agreement is only a screening rule, not proof of accuracy.
- Body score zero is rejected. Age categories are never converted to numeric years. Derived body percentages no longer silently replace unread fields.
- Review UI reports actual finite numeric candidates and missing fields, preserves existing values/memo, and permits manual review even when no numeric candidate is recognized.

## Validation

- PASS: full unit suite 747/747; changed-file ESLint; Next.js production build; TypeScript noEmit.
- PASS: browser component regression 19/19, including date editing, conflict confirmation/cancellation, account changes, late OCR, rollback, persistence, catalog/guide identity and 320/390/1280 widths.
- PASS: actual local Tesseract with a synthetic 320x2048 dark OA-layout report reads date, weight, score and visceral fat. A deliberately small decimal is left empty instead of filled as an integer; manual correction, save/reload, original memo/age preservation and calendar re-query pass.
- PASS: actual local Tesseract with a clear synthetic high-resolution report reads the decimal correctly, then passes the same reviewed save flow.
- Both actual-OCR cases serve worker/model locally and send zero external requests. They are synthetic regression fixtures, not evidence of accuracy on the user's original image.
- Independent review's letter-to-zero finding is fixed with 7O, 1O points and 83,O kg rejection cases. Reviewer reran parser tests 5/5.
- NOT RUN: original uploaded image/video decoding and actual-image OCR. Library transfer helper requires Python; the available Windows alias cannot launch. No alternate transfer bypass was used.
- NOT RUN: authenticated Preview app/cloud write checks. Existing Preview protection and shared production backend remain unchanged. No production records were written.

Reproduction: `npm test`; `npx tsc --noEmit`; `npx eslint app/lib/oaReportParser.ts app/lib/oaReportParser.test.ts app/components/BodyRecordCard.tsx scripts/fitness-priority-browser.mjs`; `npm run build`; `node scripts/fitness-priority-browser.mjs`. For real synthetic OCR set FITNESS_REAL_OCR=1; additionally set FITNESS_OCR_CLEAR=1 for the clear-decimal case. Test assets use the existing ignored local OCR model described in STATUS.md.

## Follow-up UX

Existing catalog items currently expose immediate-add buttons without a pre-add guide disclosure. New catalog items have a disclosure. Unifying pre-add guide viewing is a separate follow-up; no workout-selection change is included here.

## Release boundary

Only the approved fitness-record-priority Preview branch may be updated. No main merge, production deploy, security/environment changes, new services, paid AI or alignment image operations.

# OA long-report OCR recovery (local review)

The original two enlarged crops sometimes disagree because a decimal becomes punctuation, an extra digit appears, or one enlargement has low OCR confidence. The parser now retries only unfilled numeric rows at two smaller scales. Both retry readings must pass the existing confidence and numeric validation and agree. Any parseable conflicting original number, even at low confidence, vetoes recovery. No voting, character-to-digit substitutions, invented decimals, filename-specific rules, or derived health values are used.

When the multi-line header fails to yield a clock, two crops of the timestamp line must contain the same complete clock and the already recognized date. Existing recognized dates and clocks are preserved. This remains specific to the supported OA long-report layout.

## Same-input comparison

All 36 supplied originals were run locally before and after the patch. Raw images, OCR output, private expectations, filenames, and health values remain outside the repository. No records were saved and no external OCR requests were sent.

| Check | Before | After |
| --- | ---: | ---: |
| Numeric fields matching the originals | 952 / 972 | 967 / 972 |
| Missing numeric fields | 20 | 5 |
| Incorrect returned numeric values | 0 | 0 |
| Correct dates | 36 / 36 | 36 / 36 |
| Correct clocks | 35 / 36 | 36 / 36 |
| All 30 fields complete | 21 / 36 | 31 / 36 |

All 952 previously recognized numeric values, dates, shape labels and age units were preserved. The remaining five BMI rows have contradictory original OCR readings and deliberately remain unfilled for user confirmation. Fifteen missing numeric fields and the missing clock were recovered, not all missing fields.

Correction to the earlier private review: its four reported truncated clocks were inspection errors; the saved OCR JSON already matched the originals. The corrected pre-patch all-field completeness is 19 of the newly reviewed 34, or 21 of all 36. The original 16-of-34 figure must not be reused.

## Validation

- Full unit suite: 792 passed, including new synthetic retry-conflict, confidence and complete-clock tests. Initial sandbox run had five loopback access failures; the authorized local-server rerun passed all tests.
- TypeScript, full ESLint and production Next.js build passed. Changed diagnostic scripts were linted again after test updates.
- Seven synthetic real-OCR cases passed across clean, labels, badges, score limit, decimal score, semantic mapping and low resolution. Badge/low-resolution fixtures now recover their known drawn integer; assertions verify two passing retry readings and exact expected output. The decimal-loss fixture still stays unfilled.
- Two actual-parser browser UI cases passed (clear and low-resolution synthetic reports): date/value editing, existing-date confirmation, memo preservation, save, reload and calendar re-query. Real user records were not accessed.
- Raw private comparison evidence: sibling private-ocr/recovery-comparison-36.json. No private fixture or numeric expectation is committed here.

No deployment, push, real-account save, paid call or exercise-motion change is included. Local browser checks do not establish physical-phone or other report-format support.

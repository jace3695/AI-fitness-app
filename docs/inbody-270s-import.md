# Additional result-sheet import: InBody270S English (partial)

## Source and supported scope

- Official manufacturer-distributed [InBody270S English catalogue](https://www.inbody.cz/270s_catalogue_eng_a.pdf), PDF page 4 (index 3), inspected on 2026-10-28. Reference PDF SHA-256: `a22ec37c3f236d1bf789381e71df87eaafa070af94d95aba67d387d55a2dc6b4`.
- The sheet separates current composition, muscle-fat and obesity measurements, research parameters, historical graphs, target controls and segmental measurements. The implementation uses only generic section/metric labels and explicit units. The public sample image, identity and measurements are not fixtures or bundled assets.
- This is a separate, explicitly selected **English InBody270S portrait result-sheet image** reader. It does not add PDF ingestion, other models/languages, arbitrary photographed layouts or general InBody accuracy claims. Existing OA long-report parsing remains unchanged.

## Behavior

Select the result-sheet format before choosing the image. Recognition remains on the device using the existing Tesseract dependency. Two differently scaled reads must independently identify the model, layout and a complete labeled numeric row with a matching unit. Numeric fragments, inferred decimals, missing units and conflicting/duplicate candidates are not accepted.

Candidate fields are Weight, Body Fat Mass, Skeletal Muscle Mass, Percent Body Fat, Body Mass Index, Fat Free Mass and Basal Metabolic Rate. Split composition-table OCR blocks may be rejoined only by same-row word geometry bounded by independently recognized composition, muscle-fat and research headings. Missing/uncertain layout anchors yield no automatic candidates. Reference intervals are not measurements; chart tick runs, target weights, history and segmental lean mass are excluded. Chart labels split across rows may remain unread, even on a supported sheet.

Generic muscle mass is never converted to skeletal muscle. Body Fat Mass is stored separately from OA total fat and trunk fat fields. Each accepted field keeps its original row text/unit and distinct `inbody-270s-en-v1` provenance. Editing a recognized value preserves its original evidence and marks it edited.

A measurement date is **always entered manually** for this format; no current-day, ambiguous date-order or historical-date fallback exists. The user must compare source labels, units, numbers and date and tick the review confirmation. Editing fields/date revokes confirmation. Save still uses existing-date confirmation, latest-store/owner checks and atomic two-store writing. Declining confirmation, canceling and unread fields preserve existing records and unrelated dates. A reader error never falls back to the OA positional reader.

## Evidence and limitations

- Pure synthetic labeled-line tests cover all seven candidates, unknown models/units, low confidence, duplicate/conflicting reads, reference/history/target exclusion, metric separation, provenance, save and JSON reload.
- New routing and mandatory-review tests fail against the prior component and pass against this implementation.
- A newly authored two-column synthetic image, with no public-example or user values, was recognized through local Tesseract.js with an already installed English model and the shipped OCR/label adapter. Weight, Body Fat Mass, Fat Free Mass and Basal Metabolic Rate matched. Split chart labels for SMM/PBF/BMI were left blank, not guessed. This is partial-layout regression evidence, not a real-result-sheet accuracy benchmark.
- New Chromium/WebKit cases are authored for explicit format selection, review/date requirements, cancel/decline, distinct fields, retained old fields, provenance and save/reload. Their reader is explicitly synthetic; those UI cases do not measure image OCR accuracy.
- Browser canvas/image decoding, real additional-format images, authenticated cloud persistence and physical devices require separate verification. Do not claim the entire B3 goal complete from this partial format or from already-supported OA inputs. No production deployment or record migration is part of this change.

## Real-image pipeline verification lane

A separate synthetic PNG lane now exercises the default reader with pinned, local copies of its worker/core and default English `best_int` data. Its required image coverage is only the four clear text/table rows (weight, body fat mass, fat-free mass, basal metabolic rate); the three split graph fields remain unrecognized and old records must survive. Existing seven-label text-adapter/mock-reader tests are not replaced or reclassified as image evidence. See [asset and verification boundaries](inbody-local-ocr-assets.md). Exact CI native execution and independent pixels remain distinct from local Node/pure checks and personal-photo accuracy.

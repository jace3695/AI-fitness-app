# Isolated InBody270S image pipeline: pinned local OCR assets

## Boundary

The `body-import-real-ocr` fixture passes only a code-fixed, same-origin static asset directory to the actual `BodyRecordCard` default InBody reader. It does not replace that reader, image decoding, canvas drawing, worker, OCR text, confidence, layout adapter or result. There is no asset URL/query/environment control in the browser UI. Ordinary application callers still use the existing Tesseract defaults, and OA remains unchanged.

The added native case uploads an authored PNG, rejects invalid image bytes and an invalid image ratio before worker creation, observes delegated real canvas draws at 1800×2550 and 2100×2975, and observes a real worker start/close. It requires four values (Weight79.6kg, Body Fat Mass17.4kg, Fat Free Mass62.2kg, Basal Metabolic Rate1623kcal), leaves the three ambiguous graph fields unrecognized, requires manual date/source review, declines an existing-record save before accepting, and checks reload/provenance/other records. All numbers and the printed date2025-04-07 are invented. No user or manufacturer sample measurements are copied.

This is a synthetic pipeline test, **not personal-report accuracy, seven-field image accuracy, authenticated DB save, or whole B3 acceptance**. The existing injected-observation UI tests remain separate and unchanged. Native execution and PNG review must be reported for the exact CI commit; pure tests or Node OCR are not browser proof.

## Fixed sources and licences (checked 2026-10-28)

- Existing lockfile: `tesseract.js`6.0.1, Apache-2.0, [local asset documentation](https://github.com/naptha/tesseract.js/blob/v6.0.1/docs/local-installation.md).
- Existing lockfile: `tesseract.js-core`6.1.2, Apache-2.0, [official repository](https://github.com/naptha/tesseract.js-core). The four `.wasm.js` distributions include their WASM bytes; no engine code is compiled or downloaded from an unknown site.
- Official data package `@tesseract.js-data/eng`1.0.0, `4.0.0_best_int/eng.traineddata.gz`. The [maintainer's data documentation](https://github.com/naptha/tessdata) identifies this as the default LSTM-only data and allows a self-hosted copy. The upstream model repository has an [Apache-2.0 licence](https://github.com/naptha/tessdata/blob/gh-pages/LICENSE); npm package metadata says MIT. Both facts are retained, rather than silently treating the model as MIT-only. The prepared cache retains Apache licence text, worker bundled MIT/BSD notices, and this provenance note.
- The exact npm archive was read with scripts disabled and verified against public integrity `sha512-mbTumm6KQPUHyzTPQaF3ObXYnx0SqqfV2nabqFVQBwD6Kl7PhGSLSzOlfFTWy0P3BjghaSKA2W9GB19Jk+ZcTg==`. Only the model bytes were extracted; the package's JavaScript was not executed.
- Fixed setup download: `https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int/eng.traineddata.gz`, 2,952,873bytes, SHA256 `45b4cb346724ac1774f1c36f42f182b887bcdb28ebe63e6fff90ac41f3fcff91`. Decompressed model SHA256 `5dc5d8d640a212c9d6184921ba103b186f50e0fed9ee716c53e6b312b400d747` (5,199,098bytes).

All worker/core/data byte lengths and SHA256 hashes are in `scripts/browser-qa/cloud/ocr-assets.mjs`. The route/cache identifier includes package versions and a digest of **all six asset hashes**. `prepare-ocr-assets.mjs` verifies versions, sizes and hashes before use. Missing model bytes download only during the explicit CI setup step, with a30-second deadline, exact size limit, redirects refused and no alternate source/model/retry. A corrupt existing cache fails rather than being replaced silently. The fixture server performs verification only and serves an exact static GET/HEAD allowlist; it never downloads or proxies arbitrary paths. OCR paths with queries are rejected. Responses remain `no-store`, and the worker's traineddata cache is disabled.

The browser's existing external-origin denial is unchanged. The local worker is loaded directly (`workerBlobURL:false`) so its URL is auditable. Passing `undefined` for OEM preserves Tesseract's default LSTM-only mode; no recognition parameters, confidence/unit/duplicate/range/model guards are relaxed. The production default with no asset configuration remains `createWorker('eng')`.

## Input and verification limits

An initial synthetic image with a tightly joined model marker was correctly rejected because the unchanged60-confidence cutoff was not reached with `best_int`. The final synthetic image makes the model name clearer as `InBody 270S`; the pre-existing `InBody\s*270S` recognition rule already accepts that spacing. Only synthetic input typography changed; the failed attempt and input identity remain in private engineering evidence. A clear synthetic success cannot establish real-photo accuracy.

PNG bytes and the optional Pillow/DejaVu authoring script are tracked fixtures; CI does not install Pillow or generate a substitute image. The source upload uses the PNG file, not a string labelled as PNG. Node preflight uses the same default best_int model but a separately resized buffer, so it is not substituted for browser canvas verification.

The one new native case has a90-second budget (60seconds for real two-scale OCR readiness); existing case timeouts, assertions, browser isolation and workflow permission settings are unchanged. Asset/model caches are ignored build outputs and are not included in published screenshot artifacts. No paid OCR/AI service, real user image, secret or production deployment is involved.

# Cloud browser QA candidate — not yet executed or published

## Scope and current status

This candidate adds a bounded GitHub-hosted browser lane; it does not recover or bypass the assistant's unavailable native browser runtime. No personal PC, hosted account, API credential, real microphone or external speech provider is required. No branch, PR, workflow dispatch, deployment or production change was made while preparing these files.

- `focused-components`: 10 scenarios in actual Chromium and WebKit, **20 browser tests authored/listed, not run**. Source components run in a standalone bundled fixture, not the authenticated Next application. Native media uses the existing Korean MP3 and generated WAV; assessment transport and account labels are synthetic.
- Existing `browser` job: one additional diagnostic-denial scenario runs in Chromium and a dedicated small-screen WebKit project against the actual isolated Next build. Its hosted-only page and HEAD gate must remain 404; no Preview, account or hosted-project gate is loosened.
- Existing full-suite 105-minute budget, disposable Supabase, fixed libsoup, retries-zero policy and evidence retention are preserved. The separate focused job is capped at 25 minutes, with a 12-minute test-run limit, and reuses the existing pinned WebKit-library build.

## Focused scenarios and limits

| Area | Browser assertions authored | Not established by this fixture |
|---|---|---|
| Home list | Empty/relevant failure distinction, retry/add callbacks, 320px, reload | Full authenticated AssistantClient data loading/saving |
| AB preparation | Static labelled SVG, no playback, 320/390px and enlarged text | Motion completion, personal suitability or medical review |
| Deadbug | Explicit disclosure, two variants, keyboard seek, play, close/reset, reduced motion | Naturalness/expert review or completed exercise recommendation |
| Roller | Nine informational stages, stage-change stop, close/reset, narrow/reflow layout | Original routine completion, timing/repetition prescription or personal safety |
| Assessment | Wrong reference/6s local rejection, local-input cancellation, explicit renewed consent, request cancellation/late response/owner reset | Real mic, hosted Auth/ledger, Azure response/quality/cost/retention. Held input bytes are not claimed as a native-decoder race |
| Reply | Existing MP3 native decoding, no autoplay, explicit play/pause/rewind/reload, resolver replacement/abort/stale output, reset/unmount, unknown-source text-only | New utterance generation/alignment, subjective listening/lip-sync quality, all physical devices |
| Diagnostic | Actual isolated Next page and body-free HEAD denial, no external browser request | Authorized hosted diagnostic acceptance or hosted schema safety |

The standalone HTTP server binds only `127.0.0.1:3107` and serves an exact allowlist: generated HTML/JS/CSS, existing MP3, existing two cat image assets. It has no proxy, generic file endpoint or environment endpoint. Browser contexts deny requests outside that origin and service workers are blocked. This is a browser-origin guard, not a universal runner firewall.

## Public evidence boundaries

Only `.e2e/component-browser/evidence/results.json` and its synthetic PNGs are uploaded, retained seven days. No raw trace/HAR/video, storageState, audio, source bundle, fixture credentials or environment values are artifacts. Results carry the exact candidate SHA and clearly label standalone-component scope. Korean review fonts are installed on the runner. Screenshot existence and automated assertions are not a substitute for direct visual review.

## Publication preflight — pending final review

- Repository: `jace3695/yeoni-ai`, stable ID `1231597253`; project and service display names are now `yeoni-ai`.
- Vercel project ID `prj_UDkVoWjM3D1EMRJk9hcBaFvq2sj3` remains connected. Root coordinator verified the actual Build and Deployment UI: **Root Directory input empty** (`./` was only a placeholder), Ignored Build Step **Automatic**. No settings were changed. Thus this project's config belongs at repository root.
- Root `vercel.json` disables automatic Git deployments **only** for `agent/yeoni-cloud-browser-qa-20261027`. Other branches are unspecified and retain their default/existing behavior. Unit tests enforce the exact map; this is not a global deployment disable.
- Prepare/review the complete final commit, including this suppression file, **before creating any remote ref**. Never first create the QA branch at an unsuppressed parent. Publish the new branch directly at the reviewed final commit only after root authorization.
- Open a draft PR to the confirmed development base if authorized. Keep production merging/deploying blocked. Verify the exact remote tree/SHA, CI terminal result, cleanup, screenshots, and absence of a Vercel deployment. No existing Preview alias should be changed.
- Standard public-repository runner minutes are free, but artifact/cache storage quotas and account billing have not been inspected. Do not promise zero total costs. Source/PR/logs/artifacts are public: exclude personal data and secrets. Durable development backups stay in private Google Drive.

Supported configuration references: [Vercel branch deployment controls](https://vercel.com/docs/project-configuration/git-configuration#git.deploymentenabled), [Vercel default Git deployment behavior](https://vercel.com/docs/git/vercel-for-github#a-deployment-for-each-push), [Playwright GitHub CI](https://playwright.dev/docs/ci-intro), [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions).

## Local preflight commands

`npm --prefix scripts/browser-qa ci` installs the existing locked esbuild dependency (no browser download). This workspace required a writable `/tmp` npm cache; no system/home path was modified.

```sh
node scripts/browser-qa/cloud/build.mjs --build-only
node --experimental-strip-types --test tests/cloud-browser-qa-config.test.ts
YEONI_COMPONENT_QA=1 npx playwright test --config tests/browser-cloud/playwright.config.ts --list --reporter=list
npx eslint scripts/browser-qa/cloud tests/browser-cloud tests/e2e/diagnostic-denial.spec.ts tests/cloud-browser-qa-config.test.ts playwright.config.ts --max-warnings 0
npx tsc --noEmit --incremental false
```

`--list` only enumerates tests; it is not execution.

### Completed local preflight (2026-10-27)

- **1356/1356 Node tests passed**, failures/skips zero (existing 1353 + 3 CI configuration regressions).
- Focused ESLint `--max-warnings 0`, full TypeScript `--noEmit --incremental false`, and whitespace checks passed.
- Standalone harness production bundle/CSS built successfully; Playwright listed **20** component/browser combinations without launching a browser. An initial CSS absolute-asset resolution failure was fixed with an exact checked-in sprite allowlist; assessment-only language CSS scope was restored after independent review.
- Full Next production build passed with an explicit loopback Supabase URL and a **fake build-only** anon string; no hosted credentials or DB were used.
- HTTP-only bootstrap check passed: all six allowlisted static assets returned 200; `/.env` and the standalone provider-like API path returned 404. Actual built Next diagnostic page returned 404, and the diagnostic HEAD returned 404 with `private, no-store` and an empty body. These HTTP checks are **not browser interaction/Auth/DB verification**.
- Ignored local logs: `.e2e/component-browser/preflight/{unit-tests.log,next-build.log,http-only.json}`. These preflight logs and source bundles are not in the public artifact allowlist.

Actual browser execution, screenshots and direct visual review remain **unrun/pending** until authorized CI publication. Local preparation is not a production-ready or full UI-QA pass.

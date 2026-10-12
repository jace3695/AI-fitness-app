# Independent analysis: PHASE D local mock preparation

Status: **PHASE D is not activated or complete.** This is an isolated test contract,
not an AI API connection. It has no application entry point and is not exported by
the PHASE C public index. There is no live provider implementation, credential,
HTTP endpoint, database migration, scheduler, app UI, notification or deployment.
The existing Work analysis, paid/free AI routes and Zephyr quota remain unchanged.
All tests use synthetic records, consent, model identifiers, prices and budgets.

## Files and boundary

- `lib/independent-analysis/ai-contracts.ts`: mock input, consent, selection, budget
  reservation, usage and candidate interfaces.
- `lib/independent-analysis/ai-mock-adapter.ts`: dependency-injected local simulation.
- `lib/independent-analysis/ai-response.ts`: strict candidate shape/evidence/numeric
  checks. This is **not** a medical, financial or semantic safety classifier.
- `lib/independent-analysis/ai-adapter.test.ts`: adjacent synthetic contract tests.

The runner accepts only `mode: mock_only`, a mock provider and a mock budget dependency.
Its dependencies are trusted local test code, not a sandbox: an arbitrary injected
JavaScript function could perform side effects. No real transport is supplied or
permitted by this development slice. A `kind: mock` label is not a security boundary
or production authorization. No consent or budget setting is persisted by this code.

## What is checked

1. Exact owner/request binding, provider, model, tier, selected domains and reason for
   analysis. No-change/insufficient-data decisions stop before reservation. They do
   not claim the user is healthy, inactive or free of issues. Complex review requires
   explicit complex selection; there is no automatic fallback or upgrade.
2. Explicit mock consent for this owner/request, provider/model, purpose, minimum
   metric schema, domains and single-attempt frequency. Missing, revoked, future,
   expired or changed-revision consent blocks. Existing manual/free-AI consent is
   not imported. Consent is re-read before claiming, after claiming and after usage.
3. PHASE C validates and computes the snapshot. Mixed owners, invalid, incomplete or
   stale source state blocks. A conservative global source-quality gate can block
   even when the broken source was not selected; it never sends that source's state.
   The mock-only freshness window is one hour, inclusive, with future cutoffs rejected.
4. Only selected domains' `projectAnalysisFacts` output is passed to the mock provider.
   Workout scope includes plan-status/denominator evidence. Unselected source warnings
   are removed from outgoing quality. Owner/source/row identifiers, memos, raw records,
   labels and unknown configuration fields are absent. Aggregated facts remain sensitive.
5. Explicit integer micro-KRW overall and per-call envelopes. Enabled category caps
   require a value; disabling a category cap never disables the overall cap. Zero is
   zero, unset is blocked. Only synthetic price bounds are accepted, matching exact
   provider/model/tier, currency and per-call ceiling with a valid time window and
   a complete-payload/all-billable-units declaration. These are fixture contracts,
   not verified current provider prices or proof of a real provider-enforced bound.
6. Reservation must acknowledge the **exact full serialized mock request**, consent,
   price and policy versions, owner/request and envelope after an atomic overall and
   category check. Changed/unknown reservations cannot dispatch. The fixture allocator
   counts simultaneous outstanding reservations and spent liabilities. Production
   atomicity, account-wide liabilities and persistent idempotency are not implemented.
7. A one-way claim precedes generation. Duplicate or uncertain claims do not generate.
   Consent, freshness and provider target are checked again. No retry or fallback is
   performed, including after timeout or a missing response.
8. Missing/coerced/incomplete/invalid usage leaves the maximum liability held and the
   actual amount unknown, never zero. Known usage is settled even if candidate JSON,
   completion status or content is invalid. Observed overruns retain/record the full
   cost without clamping and request a future-dispatch block. Even incomplete usage
   can disprove the cost/output ceiling: valid same-currency observed cost raises the
   unresolved hold, without being mislabeled as a confirmed actual charge. A required
   `holdUnknown` mock-ledger operation preserves at least
   `max(reservation, observed cost)` and blocks new reservations/claims on an overrun.
   Settlement uncertainty also records that full hold and exposes no candidate.
   An unacknowledged/failed hold returns uncertain accounting and requests dispatch
   shutdown; its returned flag alone is not a persistent or production kill switch.
9. Response validation requires fixed sections/kinds, nonempty unique existing evidence
   references and exact numeric value/unit matches. Unknown facts can support questions,
   not facts/inferences/recommendations. Stale/blocked evidence is rejected. Facts must
   include numeric references. Prose with numeric characters is rejected, and unknown
   evidence/partial periods/inferences limit confidence rather than accepting a model's
   HIGH declaration unconditionally.

Reservations are deliberately never automatically released in this prototype, even on
pre-generation holds. A future durable ledger must distinguish proven pre-dispatch
failure from unknown dispatched liability and reconcile it with evidence. Lease expiry
alone is not a refund. `payloadJson` equality is a local fixture check, not a cryptographic
identity, secure deduplication key, provider idempotency guarantee or owner authorization.
Lost settlement acknowledgement may temporarily count both confirmed spending and an
unresolved hold conservatively. The fixture must retain both until reconciliation,
rather than erase already-recorded spending or assume that an exception means no charge.

## Output is always held for review

Successful structure/number validation returns `review_required` with
`semantic_and_safety_review_required`. It does not return publishable success and there
is no persistence or notification path. Natural-language numbers spelled out in words,
unsupported causal explanations, diagnostic/treatment language, financial advice,
privacy leakage in generated prose and semantic contradictions cannot be fully ruled
out by structural validation. No regex or model self-attestation is claimed to solve
these issues. The PHASE E comparison and later semantic/safety/confidence evaluation
remain required. Unreviewed prose must never be shown as approved daily advice.

The injected ledger's acknowledgement is also not proof of real accounting. A live
system must implement its documented authority and concurrency guarantees, recheck
current lowered limits and consent at dispatch, and fence stale workers. Revocation
after a real provider has already received data cannot retract that transmission.

## Activation decisions and blockers

Before any real provider connection, separately establish:

- The exact provider/account and routine/complex model IDs, access availability and
  official current prices, retention/data-use terms, region and applicable agreement.
  No model or price is selected or verified by these fixtures.
- Explicit user consent identifying the provider, sensitive weight/workout/pain or
  financial fields, analysis purpose, schedule/frequency, retention and revocation.
  A single synthetic attempt never authorizes daily real-data transfer.
- User-entered overall monthly and optional category budgets, currency, billing period
  and timezone, fixed/shared-account liabilities, tax/FX bounds and any one-time exception.
- An authoritative source loader with authentication/owner isolation, coherent cutoff,
  complete counts/revisions and freshness policy; exact provider serialization and
  enforceable bounds for input/output, reasoning, cached units, tools and all paid SKUs.
- A durable atomic ledger/idempotency/claim implementation, unknown-billed reconciliation,
  full overrun recording and account blocking, current-policy rechecks and recovery tests.
  The existing AI router/budget are deliberately not repurposed: their fixed prices,
  estimation, cancellation and finalization behavior do not satisfy this contract.
- Official provider response/usage/error/idempotency contracts, explicit server-only
  credentials, minimal permissions, mock-to-live implementation and relevant approvals.
- PHASE E matching-evidence comparison, semantic safety/quality evaluation, and separate
  approvals for hosted SQL, secrets/access, Cron, Push, production and Work cutover.

No hosted-schema access or previously canceled query was retried here. No current pricing
research is needed for synthetic values; official verification is mandatory immediately
before selecting/activating a live model. Existing API/TTS/STT or Zephyr approvals are not
reused or enlarged.

## Verification and stage report

Commands:

```sh
node --experimental-strip-types --test lib/independent-analysis/*.test.ts
node_modules/.bin/eslint lib/independent-analysis/ai-*.ts
node_modules/.bin/tsc --noEmit --incremental false --pretty false
```

The final exact results are recorded below and in the implementation handoff. The
repository's existing `npm test` discovers the new tests without script/config changes.
C's static no-I/O test also covers the new source files. Network traps assert zero calls
in both successful and blocked local runs; no browser or hosted/provider validation
occurred.

Independent review completed 2026-10-09 18:24 UTC (2026-10-10 KST):

- Focused C+D suite: **110/110 passed** (56 C, 54 D; no skips).
- Focused D ESLint: **passed**, exit 0, no diagnostics.
- Repository TypeScript check with `--incremental false`: **passed**, exit 0,
  no diagnostics. This shared working tree also contains unrelated parallel work.
- Four new accounting regressions first reproduced the missing larger hold/overrun
  block and failed before the correction; all pass afterward. Additional cases cover
  unavailable reconciliation, settlement acknowledgement loss, workout/plan scope,
  revoked consent during settlement and always-held unreviewed prose.
- No imports/app entry points outside this isolated namespace were found. This is
  local contract verification, not a full build, end-to-end, browser, provider,
  hosted-database, real-charge, schedule, Push or production acceptance result.

Stage report: (1) C projection and existing router/budget constraints inspected;
(2) only the four new D files and this document added; (3) mock gates, contracts and
validation added; (4) no runtime architecture or existing feature changed; (5) synthetic
tests, focused lint and repository type check run; (6) exact results in handoff;
(7) all live decisions/authorities and semantic review remain open; (8) obtain activation
decisions and implement/verify real boundaries before any live test; (9) no operational
activation or deployment; (10) approvals above remain outstanding. This is not a claim
that all of PHASE D, E or the overall cost-management system is complete.

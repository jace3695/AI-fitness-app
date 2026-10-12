# Independent analysis: PHASE C pure statistics

Status: isolated development slice. No application entry point imports it. No source loader,
database migration, scheduling, AI/provider call, notification, billing integration, or
production deployment was added. The existing Work analysis and its schedule are unchanged.
Only synthetic fixtures are used.

## Public boundary

`lib/independent-analysis/index.ts` exports:

- `analyzeSnapshot(unknown)`: validates a caller-supplied object or JSON snapshot, normalizes
  source records, and returns deterministic weight/workout/spending metrics.
- `projectAnalysisFacts(result)`: constructs a minimal, identifier-free facts contract for
  a **future** consumer. It performs no transmission and grants no consent. Aggregated
  health and financial facts remain sensitive.
- Input/metric types and `AnalysisInputError`, whose code contains no raw input values.

Sources must be owner-scoped before this boundary. Every row additionally carries an exact
owner ID; a mismatched row rejects the entire input, including old/future revisions. Owner
validation here is not authentication or authorization. Future adapters must implement both.

Snapshot fields are `schemaVersion: 1`, `ownerId`, explicit ISO-offset `asOf`, IANA `timeZone`,
and `sources`: required `weight`, `workout`, `spending`, optional `plans`. Each source has:

- `sourceId`, `sourceVersion`, optionally `currentVersion`
- `status`: `ok`, `empty`, `unavailable`, `incomplete`, or `invalid`
- `coverage`: `startDate`, `endDateExclusive`, `complete`, `totalRows`
- `records`: an array; `totalRows` is the raw loaded row count before deduplication

`complete` means all **stored records in the declared scope** were retrieved. It does not
mean every real-world action was recorded. Missing counts, count mismatch, incomplete
coverage or a source error block affected totals. `empty` is distinct from unavailable.
An empty expense set can establish zero *recorded expense* only, never actual zero spending.
Without an observed currency, no currency or zero total is invented.

The snapshot reader is not implemented. It must establish a coherent cutoff, source scope,
row-count completeness and revision vector. `currentVersion` mismatch marks the entire
snapshot stale and blocks that source's metrics. The minimal projection preserves global
quality and each domain's source status, including domains with no numeric facts.

## Dates and periods

Date-only rows already contain a local `YYYY-MM-DD`; they are not shifted as UTC timestamps.
Timestamp rows use strict ISO timestamps with `Z` or an explicit offset. Exactly one date
representation is required. Invalid dates, rollover dates, ambiguous timestamps and unknown
time zones fail. Timestamp rows after `asOf` and future date-only records are excluded and
counted in quality/provenance. An instant equal to `asOf` is included.

Periods use local-calendar `[startDate, endDateExclusive)` bounds. Timestamp membership first
maps into the explicit time zone, so spring/fall DST days need not be 24 hours. UTC day-length
arithmetic is used only for date ordinals, never to derive local timestamp boundaries.

| Name | Bounds relative to local today T | Partial? |
| --- | --- | --- |
| today | [T, T+1) | yes, cutoff at asOf |
| yesterday | [T-1, T) | no |
| recent7 | [T-6, T+1) | yes |
| previous7 | [T-13, T-6) | no |
| recent30 | [T-29, T+1) | yes |
| month | [first of current month, T+1) | yes |
| completed7 | [T-7, T) | no |
| previousCompleted7 | [T-14, T-7) | no |

Month-to-date is neither rolling 30 nor 28 days. Automatic spending percent comparisons
use only the two completed, equal-length 7-day windows. A partial day versus completed day,
unequal periods, different units/currencies, overlapping periods or a zero baseline produces
an unknown comparison. These metrics do not classify changes as improvement or deterioration.

## Record identity and revisions

All records have an exact `id`, `ownerId`, nonnegative safe-integer `revision`, and date or
timestamp. Optional `updatedAt` must be an explicit instant. Deduplication uses only exact
IDs inside the named source. Similar dates, values or labels do not establish identity.
The highest explicit revision wins; identical copies collapse. Conflicting facts at the
same revision fail, even if a higher revision exists. Different source domains cannot reuse
one source ID. There is no heuristic merge or automatic deletion.

Any supplied revision updated after `asOf` blocks the source as incomplete. This conservative
behavior avoids dropping an edited historical expense and publishing a smaller subtotal.
Reconstruction of historical state from a partial revision log is deliberately unsupported.
A future coherent loader can supply the exact as-of snapshot instead.

The result includes row evidence (source/version/exact ID/revision) and source coverage.
The `fnv1a32` fingerprint is deterministic **non-cryptographic diagnostic metadata only**.
It must never be used for owner isolation, authenticity, authorization, secure deduplication,
idempotency or a collision-resistant content identity. A future durable store must use its
own approved identity and cryptographic integrity design.

## Weight

Only positive finite numeric kg measurements are supported; no implicit unit conversion.
Daily, 7-day, 30-day and month averages divide by the actual measurement count. Multiple
same-day measurements are equally weighted, and the basis is labeled. Missing days add no
zeroes. An old latest measurement is not moved into today's window.

Daily change requires both today and yesterday. Recent change compares the first and last
recorded-day means within the as-of 30-day window. Speed divides by their actual calendar-day
distance. A single recorded day has no valid speed denominator. No medical diagnosis,
target weight, health status, cause or recommendation is generated.

## Workout and plans

Session states remain `completed`, `partial`, `stopped`, `unknown`. Legacy `true` means
completed; legacy `false` means unknown, not failure. Only actual string enum values are
accepted. Pain `yes`, `no`, and unanswered remain separate; an absent answer is not no pain.
Kinds are retained as observed labels in the private aggregate and omitted from the minimal
facts projection.

The completion metric is explicitly the percentage of **planned days with a recorded
completion**, not a session completion rate. Plans must contain one unambiguous entry for
every calendar day in the period. `rest` and `unavailable` are excluded from the denominator.
Missing plans make it unknown; an all-rest plan has denominator zero and unknown percentage.
Two sessions on one planned day count as one completed planned day. An unrecorded planned
day is not labeled failure.

Observed consecutive completed-record dates are counted backward from the latest record in
the 30-day window. A gap stops the observed run; it proves neither inactivity nor an actual
streak ending. Days since the last recorded completion are named accordingly. The window may
truncate a longer observed run; no lifetime streak or stop duration is claimed.

## Spending and budgets

Amounts are unsigned decimal **strings**, converted exactly to integer minor units with
BigInt internally, then checked against JavaScript's safe integer limit. Numeric amounts,
exponent notation, negative amounts, excessive precision and overflowing totals fail.
Supported currency precisions: KRW/JPY 0, USD/EUR/GBP 2, KWD/BHD 3. Unknown currencies are
rejected; this is deliberately not a complete currency catalog. No FX conversion occurs.

Expense, income, savings, refund and scheduled transactions are separate kinds. Refunds do
not silently reduce expenses; their linkage/reconciliation is not implemented. Missing
income/savings/refund/scheduled rows leave their values unknown. Explicit zero rows retain
zero. Income is never inferred from spending or savings. The result is a stored-record
summary, not financial advice or an account balance.

Missing category is preserved as a null/unknown category bucket. Explicit categories remain
distinct. Category comparisons use equal completed periods; a newly observed category has
unknown percent change when its prior recorded total is zero. No merchant or memo is used.

An optional `monthly_budget` row must be dated the first of its applicable month, in an
explicit currency. Its amount is a user-supplied spending budget, not an operating/API budget.
Multiple different IDs for the same month/currency budget are disputed and rejected. Missing
budget is unknown; configured zero stays zero with no percentage division. No overall API
cost guard, income estimate or approval behavior is implemented by these statistics.

## Privacy and deliberate omissions

Unknown fields such as notes, merchant, language mastery or growth assessments are never
copied into normalized records. The minimal facts projection omits owner IDs, raw source/row
IDs, free-text categories and workout-kind labels, and includes fixed metric IDs plus numeric
values, sample counts, denominators, dates and quality. It preserves unknown state explicitly.
Private aggregate evidence is not suitable for provider transmission.

Language/growth/diet/symptom mastery or failure metrics are not implemented. There are no
diagnoses, causal claims, AI decisions, advice, provider credentials, billing calls or model
routing in this slice. PHASE D is not activated.

## Verification

The adjacent `statistics.test.ts` maps the complete C01–C36 matrix to named tests, plus
boundary cases for malformed/coercible enums, post-cutoff edits, missing financial kinds,
large exact sums, coverage contradictions, plan disputes and privacy.

Commands:

```sh
node --experimental-strip-types --test lib/independent-analysis/*.test.ts
node_modules/.bin/eslint lib/independent-analysis
node_modules/.bin/tsc --noEmit --incremental false --pretty false
```

Final recorded results are supplied in the implementation handoff. The repository's
`npm test` discovers these adjacent tests automatically. No package/config changes are
needed. These focused tests and the type check do not claim a full application/browser,
hosted database, production or device validation pass.

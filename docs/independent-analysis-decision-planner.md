# Independent analysis: local evidence-derived decision planning

Status: **isolated PHASE D preparation only; D is neither activated nor complete.**
This adds the smallest rule-based planning prerequisite identified by the gap audit.
It does not connect an AI API, route to a model, create advice or skip a real daily run.

## Requirement and preserved boundary

The original independent-analysis request says to calculate statistics in code first
(§5), consider routine versus complex analysis (§6), perform rule-based change
detection before an AI call (§7), and wait for information or ask rather than make
confident claims from insufficient evidence (§9). PHASE D itself is **AI API
connection** (§57); this pure planner does not meet that entire milestone.

Previously, `ai-mock-adapter.ts` accepted the caller's `need` declaration. The new
`decision-planner.ts` derives a narrow decision from PHASE C's existing
`projectAnalysisFacts(analyzeSnapshot(snapshot))` output. It is deliberately separate:

- No changes to the C public index, C/D shared contracts, mock adapter or its tests.
- No application imports, UI, provider selection/dispatch, live calls, credentials,
  source loader, database, scheduler, Push, TTS, STT, deployment or automatic action.
- No automatic conversion of a planner result into mock dispatch. The existing
  mock runner's authorization/accounting/held-review gates remain unchanged.
- No production clinical, financial or model/cost threshold is supplied.

Files added: `lib/independent-analysis/decision-planner.ts`, adjacent
`decision-planner.test.ts`, and this document.

## Inputs and policy provenance

`planAnalysisDecision(evidence, policy, now)` is synchronous and deterministic.
It requires a full, plain-data C projection and an explicit clock instant. It does
not consult an ambient clock or perform I/O. The supported boundary is JSON-shaped
local data, not a sandbox for arbitrary objects, getters or injected JavaScript.

The versioned policy has no defaults. It requires all of:

- Schema version, a configuration version and `purpose: local_decision_planning`.
- Maximum snapshot age in milliseconds, inclusive at the limit.
- One or more uniquely identified comparison rules, each specifying exact current
  and baseline fact IDs, the expected unit, a positive integer minimum sample count
  per period, a positive absolute-change threshold, and either an explicit complex
  threshold at least as large or `null` to disable that rule's complex trigger.
- Either an explicit distinct-domain count of at least two for complex review, or
  `null` to disable that trigger. The count cannot exceed the configured domains.

Every result records the policy version, evaluated rule IDs and existing C fact IDs.
Unknown fields, omitted fields, unsupported versions/IDs, duplicate rules/pairs and
coerced/nonfinite/invalid numeric policy values fail closed. These identifiers are
configuration references, **not** proof that a user approved a policy or payment.

Supported comparisons are existing windowed weight means; workout status counts,
recorded planned-day completion rates and pain-answer counts; and per-currency
expense/income/savings/refund/scheduled totals already projected by C. Different
measurements that happen to share units are not interchangeable. There is no new
raw source or metric projection. Category/kind analysis, prior advice, important
events, cross-domain associations and extra app domains remain separate gaps.

## Evidence and calculation rules

1. Validate the C envelope, unique fact/domain IDs, known/unknown-value consistency,
   finite numbers, sample metadata, quality codes and quality-status consistency.
   Dates use C's strict calendar parser; invalid leap/month dates do not roll over.
2. Reject a future or expired cutoff. A malformed clock/zone/cutoff is blocked.
   Globally blocked/stale quality or any unavailable/incomplete/invalid domain blocks
   even if that domain was not selected, preserving the conservative source gate.
3. A selected domain's limited quality is insufficient. An unrelated limited domain
   alone does not block a configured-scope comparison whose own source and facts are
   valid. This distinction is tested and **never** establishes a whole-day all-clear.
4. Require all selected facts to exist, be known, non-partial, valid-quality and meet
   their sample requirements. Missing facts are not zero; no selected data is not
   no-change. Required unknown plan or denominator evidence remains insufficient.
5. Match each fact's period exactly to C's named windows at the envelope cutoff and
   time zone. Both periods must be completed, equal in local-calendar day count,
   ordered and adjacent. Overlap, gaps, shifted labels, reversed/unequal windows,
   partial days/months and today-versus-yesterday comparisons are insufficient.
   DST is handled in calendar days, without assuming a day is 24 elapsed hours.
6. Match the metric kind, currency and units. Check C-guaranteed numeric semantics:
   nonnegative exact count/minor-unit totals, positive weight means, count values
   equal their selected sample count, weight mean denominators equal sample counts,
   pain counts cannot exceed their total-answer denominator, and known plan rates
   stay within 0–100 with coherent integer planned-day/sample bounds.
7. Subtract baseline from current, preserving the signed direction; classify using
   the absolute magnitude against explicit thresholds. There is no percentage
   division. An explicitly observed zero monetary baseline is valid for this absolute
   comparison. A missing or zero mean/rate denominator is still insufficient.
   Negative *changes* remain valid; C's rejection of negative raw weight/money is
   unchanged. Increases and decreases are neither good nor bad by default, and
   opposing changes in different metrics are never canceled or netted together.

The projection has one cutoff and carries quality but omits raw row revisions and
owner identity. Period/quality checks cannot prove authentic provenance or detect
every forged mixture of otherwise identical projected envelopes. The authoritative
owner-scoped loader and coherent revision/cutoff verification are still required
before any real integration. The planner is not an authentication boundary.

## Outcomes and unresolved authority

Precedence is `blocked`, then `insufficient_data`, then `complex_review`, then
`routine`, then `no_meaningful_change`. **Every required comparison must be usable**
before a routine/complex/no-change overall decision is possible. Per-rule reasons
are retained when one rule finds change but another lacks evidence.

- `blocked`: invalid policy/input, stale/unavailable source, unit conflict or
  contradictory numeric metadata. Do not proceed on this result.
- `insufficient_data`: missing/unknown/limited/partial/poorly matched evidence or
  insufficient samples. This is not proof of inactivity, health or absence of issues.
- `no_meaningful_change`: all configured comparisons are below their thresholds.
  This does not establish that no important event or unconfigured change occurred,
  and is insufficient to authorize automatically skipping a real daily analysis.
- `routine`: at least one configured comparison meets its change threshold.
- `complex_review`: an explicit per-rule complex threshold or distinct-changed-domain
  count is met. This is a request for review under that policy, not a diagnosis,
  deterioration finding, financial urgency, causal finding or model upgrade.

Output contains stable reason codes and rule/fact references, with no generated prose,
advice, confidence claims or user-record identifiers. Every outcome has
`scope: configured_comparisons_only` and the same fixed authority fields:
dispatch **not authorized**; provider, consent, price and budget **not checked**.
Unknown cost never becomes zero; absent permission never becomes approval. This code
does not even attempt those checks or select an execution/provider tier.

## Verification and remaining work

Commands used for local verification:

```sh
node --experimental-strip-types --test lib/independent-analysis/*.test.ts
node_modules/.bin/eslint lib/independent-analysis/decision-planner*.ts
node_modules/.bin/tsc --noEmit --incremental false --pretty false
```

All fixtures use synthetic records, clocks, policy identifiers and thresholds.
Tests cover ordinary/complex/no-change decisions; signed changes and zero baselines;
missing/stale/partial/limited data; malformed policy and contradictory projections;
sample/denominator/metric/currency boundaries; precedence; leap days/month/year/DST;
determinism, no mutation, minimal outputs and zero network/ambient-clock access.
The existing C static no-I/O contract also scans the new production source file.

Final local check on 2026-10-09 UTC: **144/144 C+D+planner tests passed** (34
planner, 110 preexisting C/D; zero skips). Focused planner ESLint and repository
TypeScript (`--incremental false`) passed without diagnostics. The shared working
tree also contains unrelated parallel changes; this is not their acceptance result.

This is local unit/lint/type verification, not browser, authenticated UI, hosted DB,
real provider/cost, device, schedule, notification or operational acceptance. The
prior C/D tests are preserved, with no weaker failure checks. Durable authority and
accounting, provider/price/consent decisions, semantic safety and matched Work-quality
comparison still precede activation. No commit, push or operational change is made
by this slice.

import type { AnalysisCandidate, CandidateClaim, MinimalFacts } from './ai-contracts.ts';

const SECTIONS = new Set(['summary', 'important_change', 'positive_change', 'caution', 'possible_cause', 'judgment', 'today_action', 'long_term_check', 'user_question']);
const KINDS = new Set(['fact', 'inference', 'recommendation', 'question']);
export function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, expected: string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, i) => key === [...expected].sort()[i]);
}
export function nonnegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Structural/numeric grounding only. Free prose still needs semantic/safety review.
 * A passing candidate is never publication-ready, diagnostic or financial advice. */
export function validateAnalysisCandidate(raw: unknown, evidence: MinimalFacts):
  { ok: true; candidate: AnalysisCandidate } | { ok: false; reason: string } {
  const fail = (reason: string) => ({ ok: false as const, reason });
  if (typeof raw === 'string') {
    if (raw.length > 32_000) return fail('response_too_large');
    try { raw = JSON.parse(raw); } catch { return fail('response_json'); }
  }
  if (!object(raw) || !keys(raw, ['schemaVersion', 'confidence', 'claims']) || raw.schemaVersion !== 1
    || typeof raw.confidence !== 'string' || !['HIGH', 'MEDIUM', 'LOW'].includes(raw.confidence)
    || !Array.isArray(raw.claims) || raw.claims.length === 0 || raw.claims.length > 16) return fail('response_schema');
  const facts = new Map(evidence.facts.map(fact => [fact.id, fact]));
  if (facts.size !== evidence.facts.length) return fail('evidence_ambiguous');
  const claims: CandidateClaim[] = [];
  let ceiling: AnalysisCandidate['confidence'] = evidence.quality.status === 'valid' ? 'HIGH' : 'MEDIUM';
  for (const claim of raw.claims) {
    if (!object(claim) || !keys(claim, ['section', 'kind', 'text', 'evidenceIds', 'numbers'])
      || typeof claim.section !== 'string' || !SECTIONS.has(claim.section)
      || typeof claim.kind !== 'string' || !KINDS.has(claim.kind)
      || typeof claim.text !== 'string' || !claim.text.trim() || claim.text.length > 1_000
      || !Array.isArray(claim.evidenceIds) || claim.evidenceIds.length === 0 || claim.evidenceIds.length > 12
      || new Set(claim.evidenceIds).size !== claim.evidenceIds.length
      || !Array.isArray(claim.numbers) || claim.numbers.length > 12) return fail('claim_schema');
    // Numeric assertions belong in grounded fields, not arbitrary prose. This does
    // not detect numbers spelled out in natural language: all prose remains held.
    if (/\p{N}/u.test(claim.text)) return fail('ungrounded_prose_number');
    if (/[\u0000-\u001f\u007f]/u.test(claim.text)) return fail('claim_control_character');
    if ((claim.section === 'possible_cause' && claim.kind !== 'inference')
      || (claim.section === 'user_question' && claim.kind !== 'question')) return fail('claim_kind');
    for (const id of claim.evidenceIds) {
      if (typeof id !== 'string' || !facts.has(id)) return fail('unknown_evidence');
      const fact = facts.get(id)!;
      if (['blocked', 'stale'].includes(fact.quality.status)) return fail('unusable_evidence');
      if (fact.state === 'unknown') {
        if (claim.kind !== 'question') return fail('unknown_is_not_fact');
        ceiling = 'LOW';
      } else if ((fact.quality.status !== 'valid' || fact.partial || claim.kind !== 'fact') && ceiling === 'HIGH') ceiling = 'MEDIUM';
    }
    const referencedNumbers = new Set<string>();
    for (const number of claim.numbers) {
      if (!object(number) || !keys(number, ['evidenceId', 'value', 'unit'])
        || typeof number.evidenceId !== 'string' || !claim.evidenceIds.includes(number.evidenceId)
        || referencedNumbers.has(number.evidenceId)) return fail('number_schema');
      const fact = facts.get(number.evidenceId);
      if (!fact || fact.state !== 'known' || typeof number.value !== 'number' || !Number.isFinite(number.value)
        || number.value !== fact.value || number.unit !== fact.unit) return fail('number_mismatch');
      referencedNumbers.add(number.evidenceId);
    }
    // Observations must carry their exact numeric facts. Qualifiers, counts, units
    // and period semantics remain available from the cited evidence contract.
    if (claim.kind === 'fact' && claim.evidenceIds.some(id => !referencedNumbers.has(id as string))) return fail('fact_number_missing');
    claims.push({ section: claim.section as CandidateClaim['section'], kind: claim.kind as CandidateClaim['kind'],
      text: claim.text, evidenceIds: [...claim.evidenceIds] as string[], numbers: claim.numbers.map(value => ({
        evidenceId: value.evidenceId, value: value.value, unit: value.unit,
      })) });
  }
  const rank = { LOW: 0, MEDIUM: 1, HIGH: 2 };
  const requested = raw.confidence as AnalysisCandidate['confidence'];
  return { ok: true, candidate: { schemaVersion: 1, confidence: rank[requested] > rank[ceiling] ? ceiling : requested, claims } };
}

import { LEGACY_EVIDENCE_CATALOGUE } from './catalogue.ts';
import { formatModality, STUDY_POLICY, studyDay } from './study-policy.ts';
import { validateEvidenceSnapshot } from './validation.ts';
import type { EvidenceEvent, EvidenceProjection, ModalityProjection, ProjectionContext, StudyStage, TaskDescriptor } from './types.ts';

const modalities = ['meaning', 'listening', 'typing'] as const;
const keyFor = (itemId: string, revision: number, modality: string) => JSON.stringify([itemId, revision, modality]);
const append = <T>(map: Map<string, T[]>, key: string, value: T) => { const items = map.get(key); if (items) items.push(value); else map.set(key, [value]); };
const helped = (event: EvidenceEvent): boolean | null => event.hintUsed === true || event.answerPreviouslyRevealed === true ? true : event.hintUsed === null || event.answerPreviouslyRevealed === null ? null : false;
const completeProvenance = (event: EvidenceEvent) => helped(event) !== null && event.timingComplete && event.responseMs !== null && Object.values(event.textVisibility).every(value => value !== null) &&
  (event.taskFormat !== 'listening_choice' || (event.audio.status === 'completed' && event.audio.promptMatchesTask === true && !!event.audio.requestId));
// Existing listening prompts provide audio plus choices; a separately visible target,
// reading or translation is an answer aid. Listening choices remain permitted;
// direct-input choices are an answer aid rather than unaided retrieval.
const answerExposed = (event: EvidenceEvent) =>
  (event.taskFormat === 'typed_answer' || event.taskFormat === 'listening_choice') &&
  (event.textVisibility.targetText === true || event.textVisibility.reading === true ||
    (event.taskFormat === 'typed_answer' && event.textVisibility.choices === true) ||
    (event.taskFormat === 'listening_choice' && event.textVisibility.meaning === true));
const rank: Record<StudyStage, number> = { not_started: 0, learning: 1, needs_review: 1, completed_once: 2, almost_learned: 3, long_term_record: 4 };
function achievedStage(run: EvidenceEvent[]): StudyStage {
  if (!run.length) return 'learning';
  const span = Date.parse(run.at(-1)!.occurredAt) - Date.parse(run[0].occurredAt);
  if (run.length >= STUDY_POLICY.longTermDays && span >= STUDY_POLICY.longTermSpanDays * STUDY_POLICY.dayMs && Date.parse(run.at(-1)!.occurredAt) - Date.parse(run.at(-2)!.occurredAt) >= STUDY_POLICY.longTermFinalGapDays * STUDY_POLICY.dayMs) return 'long_term_record';
  if (run.length >= STUDY_POLICY.almostDays && span >= STUDY_POLICY.almostSpanDays * STUDY_POLICY.dayMs) return 'almost_learned';
  return 'completed_once';
}
function emptyPair(itemId: string, contentRevision: number, modality: typeof modalities[number]): ModalityProjection {
  return { itemId, contentRevision, modality, coverage: 'unobserved', stage: 'not_started', historicalHighestStage: 'not_started',
    presentations: 0, responses: 0, correctResponses: 0, wrongResponses: 0, helpedResponses: 0, retryResponses: 0, unknownProvenanceResponses: 0,
    lastOutcome: null, qualifiedDates: [], qualifiedEventIds: [], historicalEvidenceIds: [], suggestedDueAt: null, suggestedIntervalDays: null, warnings: [] };
}

/** Pure recomputation from an owner/generation-fenced complete prefix; no backfill or mutable caches. */
export function projectLegacyEvidence(input: unknown, context: ProjectionContext, catalogue: readonly TaskDescriptor[] = LEGACY_EVIDENCE_CATALOGUE): EvidenceProjection {
  const result: EvidenceProjection = { policyVersion: STUDY_POLICY.version, checkedAt: context.now, studyDayTimezone: context.studyDayTimezone,
    status: 'unavailable', coverageScope: 'prospective_course_exercises', pairs: [], warnings: [], historicalModalities: 'unknown', speaking: 'unobserved' };
  const validated = validateEvidenceSnapshot(input, context, catalogue);
  if (!validated.ok) { result.warnings.push({ code: validated.code, eventIds: [] }); return result; }
  result.warnings = [...validated.warnings];
  const pairs = new Map<string, ModalityProjection>();
  for (const descriptor of catalogue) for (const modality of modalities) {
    const key = keyFor(descriptor.itemId, descriptor.contentRevision, modality);
    if (!pairs.has(key)) pairs.set(key, emptyPair(descriptor.itemId, descriptor.contentRevision, modality));
  }
  const eventsByPair = new Map<string, EvidenceEvent[]>();
  const episodeSlots = new Map<string, string>(), audioEpisodes = new Map<string, string>();
  for (const { event } of validated.records) {
    const key = keyFor(event.itemId, event.contentRevision, formatModality(event.taskFormat));
    append(eventsByPair, key, event);
    const slot = episodeSlots.get(event.episodeId);
    if (slot && slot !== event.sourceSlotKey) result.warnings.push({ code: 'episode_identity_changed', eventIds: [event.eventId] });
    episodeSlots.set(event.episodeId, event.sourceSlotKey);
    if (event.audio.requestId) {
      const episode = audioEpisodes.get(event.audio.requestId);
      if (episode && episode !== event.episodeId) result.warnings.push({ code: 'playback_reused_across_episodes', eventIds: [event.eventId] });
      audioEpisodes.set(event.audio.requestId, event.episodeId);
    }
  }
  // Snapshot-level defects might conceal intervening failures for any item: no positive stages anywhere.
  const trustedPrefix = validated.complete && result.warnings.length === 0;
  for (const [key, pair] of pairs) {
    const events = eventsByPair.get(key) ?? [];
    const warn = (code: string, items: EvidenceEvent[]) => pair.warnings.push({ code, eventIds: items.map(event => event.eventId) });
    const byEpisode = new Map<string, EvidenceEvent[]>();
    for (const event of events) {
      append(byEpisode, event.episodeId, event);
      if (event.kind === 'exercise_presented') pair.presentations++;
      else {
        pair.responses++; if (event.correct) pair.correctResponses++; else pair.wrongResponses++;
        if (helped(event) === true || answerExposed(event)) pair.helpedResponses++;
        if (event.isRetry) pair.retryResponses++;
        if (!completeProvenance(event)) pair.unknownProvenanceResponses++;
      }
    }
    const chronologicalAnswers = events.filter(event => event.kind === 'answer_submitted').sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.sequence - b.sequence || a.eventId.localeCompare(b.eventId));
    const last = chronologicalAnswers.at(-1);
    if (last?.kind === 'answer_submitted') pair.lastOutcome = { correct: last.correct, helped: answerExposed(last) ? true : helped(last), isRetry: last.isRetry, occurredAt: last.occurredAt, eventId: last.eventId, audio: { ...last.audio }, textVisibility: { ...last.textVisibility } };
    const episodes = [...byEpisode.values()].map(items => items.sort((a, b) => a.sequence - b.sequence));
    for (const items of episodes) {
      if (items[0].kind !== 'exercise_presented' || items.some((event, index) => event.sequence !== index || (index > 0 && event.kind !== 'answer_submitted'))) warn('incomplete_episode', items);
      let hint = false, revealed = false;
      for (const [index, event] of items.entries()) {
        if (index > 0 && event.occurredAt < items[index - 1].occurredAt) warn('clock_inconsistent_episode', items);
        if (event.kind === 'answer_submitted' && event.responseMs !== null && event.responseMs > Date.parse(event.occurredAt) - Date.parse(items[0].occurredAt)) warn('clock_inconsistent_response_duration', [event]);
        if ((hint && event.hintUsed !== true) || (revealed && event.answerPreviouslyRevealed !== true)) warn('forgotten_help_provenance', items);
        hint ||= event.hintUsed === true; revealed ||= event.answerPreviouslyRevealed === true || answerExposed(event) || event.kind === 'answer_submitted';
      }
    }
    const simultaneous = new Map<string, EvidenceEvent[]>();
    for (const event of chronologicalAnswers) append(simultaneous, event.occurredAt, event);
    for (const items of simultaneous.values()) if (new Set(items.map(event => event.episodeId)).size > 1 && items.some(event => !event.correct || helped(event) === true || answerExposed(event))) warn('ambiguous_interruption_time', items);
    // Unknown timing/playback/help/text is real partial evidence, never a fast or qualified response.
    if (pair.unknownProvenanceResponses) warn('incomplete_response_provenance', chronologicalAnswers.filter(event => !completeProvenance(event)));
    const trustworthy = trustedPrefix && pair.warnings.length === 0;
    pair.coverage = trustworthy ? events.length ? 'observed' : 'unobserved' : 'partial';
    if (!trustworthy) { pair.stage = null; pair.historicalHighestStage = null; continue; }
    let run: EvidenceEvent[] = [], intervalIndex = -1, scheduleAnchor: number | null = null, due: number | null = null;
    let latestNeedsReview = false;
    const creditedDays = new Set<string>();
    let highest: StudyStage = events.length ? 'learning' : 'not_started';
    // Apply interruptions at their actual times, including interleaved or long-resumed episodes.
    // A later failure/help disqualifies that episode's earlier success for this snapshot.
    const actions: { event: EvidenceEvent; bad: boolean }[] = [];
    for (const items of episodes) {
      const answers = items.filter(event => event.kind === 'answer_submitted');
      if (!answers.length) continue;
      const contaminated = answers.some(event => !event.correct || helped(event) === true || answerExposed(event));
      if (contaminated) {
        let interrupted = false;
        for (const event of answers) {
          interrupted ||= !event.correct || helped(event) === true || answerExposed(event);
          if (interrupted) actions.push({ event, bad: true });
        }
      } else if (answers[0].correct && !answers[0].isRetry && answers.every(completeProvenance)) actions.push({ event: answers[0], bad: false });
    }
    actions.sort((a, b) => a.event.occurredAt.localeCompare(b.event.occurredAt) || Number(a.bad) - Number(b.bad) || a.event.eventId.localeCompare(b.event.eventId));
    for (const action of actions) {
      const first = action.event;
      if (action.bad) {
        run = []; latestNeedsReview = true; intervalIndex = 0; scheduleAnchor = Date.parse(first.occurredAt); due = scheduleAnchor + STUDY_POLICY.dayMs;
        continue;
      }
      latestNeedsReview = false;
      const day = studyDay(first.occurredAt, context.studyDayTimezone);
      if (creditedDays.has(day)) continue; // No same-day run or due-date acceleration.
      creditedDays.add(day); pair.qualifiedDates.push(day); pair.qualifiedEventIds.push(first.eventId); run.push(first);
      const at = Date.parse(first.occurredAt);
      if (intervalIndex < 0) { intervalIndex = 0; scheduleAnchor = at; due = at + STUDY_POLICY.dayMs; }
      else if (scheduleAnchor !== null && at - scheduleAnchor >= STUDY_POLICY.intervals[intervalIndex] * STUDY_POLICY.dayMs) {
        intervalIndex = Math.min(intervalIndex + 1, STUDY_POLICY.intervals.length - 1);
        scheduleAnchor = at; due = at + STUDY_POLICY.intervals[intervalIndex] * STUDY_POLICY.dayMs;
      }
      const achieved = achievedStage(run);
      if (rank[achieved] > rank[highest]) { highest = achieved; pair.historicalEvidenceIds = run.map(event => event.eventId); }
    }
    pair.historicalHighestStage = highest;
    pair.suggestedDueAt = due === null ? null : new Date(due).toISOString();
    pair.suggestedIntervalDays = intervalIndex < 0 ? null : STUDY_POLICY.intervals[intervalIndex];
    pair.stage = latestNeedsReview || (due !== null && Date.parse(context.now) >= due) ? 'needs_review' : run.length ? achievedStage(run) : pair.qualifiedDates.length ? 'completed_once' : events.length ? 'learning' : 'not_started';
  }
  result.pairs = [...pairs.values()].sort((a, b) => keyFor(a.itemId, a.contentRevision, a.modality).localeCompare(keyFor(b.itemId, b.contentRevision, b.modality)));
  result.status = trustedPrefix && result.pairs.every(pair => pair.coverage !== 'partial') ? 'complete' : 'partial';
  return result;
}

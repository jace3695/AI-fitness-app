import { FREE_CONVERSATIONS } from './freeConversation.ts';
import { GUIDED_CONVERSATION_PILOT } from './guidedConversationPilot.ts';

/** Retained legacy version; guided sources use their separately versioned catalog. */
export const FREE_CONVERSATION_CATALOG_VERSION = 'free-conversation-catalog-v1';
export const FREE_CONVERSATION_SAMPLE_MATCH_POLICY = 'nfkc-strip-whitespace-japanese-punctuation-v1';
// This revision pins the unchanged legacy source bytes. The catalog tests verify it.
export const LEGACY_FREE_CONVERSATION_REVISION = 'sha256:b92edd91c70d93da57f767c30405fd013460fd98216447854212b6e7bc7483be';

type Immutable<T> = T extends object ? { readonly [K in keyof T]: Immutable<T[K]> } : T;

function immutable<T>(value: T): Immutable<T> {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value as Immutable<T>;
}

export const FREE_CONVERSATION_LEVELS = immutable([
  { id: 'beginner', label: '왕초보' },
  { id: 'elementary', label: '초급' },
  { id: 'intermediate', label: '중급' },
] as const);

export const FREE_CONVERSATION_CONTEXTS = immutable([
  { id: 'convenience-store', situationId: 'convenience-store', subtopicId: null, label: '편의점' },
  { id: 'restaurant', situationId: 'restaurant', subtopicId: null, label: '식당' },
  { id: 'hotel', situationId: 'hotel', subtopicId: null, label: '호텔' },
  { id: 'train', situationId: 'train', subtopicId: null, label: '전철' },
  { id: 'company-general', situationId: 'company', subtopicId: 'general', label: '회사' },
  { id: 'company-mechanical-design', situationId: 'company', subtopicId: 'mechanical-design', label: '회사 · 기계설계' },
  { id: 'company-development', situationId: 'company', subtopicId: 'development', label: '회사 · 개발' },
  { id: 'company-quality', situationId: 'company', subtopicId: 'quality', label: '회사 · 품질' },
] as const);

export type FreeConversationContextId = typeof FREE_CONVERSATION_CONTEXTS[number]['id'];
export type FreeConversationLevelId = typeof FREE_CONVERSATION_LEVELS[number]['id'];

export type ConversationCurriculumReference = Readonly<{
  kind: 'curriculum-reference';
  module: 'data/curriculum.ts' | 'data/curriculumManufacturing.ts';
  lessonId: string;
  title: string;
  /** SHA-256 of JSON.stringify({ title, goal, pattern, dialogue }), in this order. */
  revision: string;
  fields: readonly ['title', 'goal', 'pattern', 'dialogue'];
  levelMapping: 'none';
  contentReviewStatus: 'not-reviewed-for-conversation';
}>;

function curriculumReference(
  module: ConversationCurriculumReference['module'], lessonId: string, title: string, digest: string,
): ConversationCurriculumReference {
  return immutable({
    kind: 'curriculum-reference', module, lessonId, title, revision: `sha256:${digest}`,
    fields: ['title', 'goal', 'pattern', 'dialogue'], levelMapping: 'none',
    contentReviewStatus: 'not-reviewed-for-conversation',
  } as const);
}

// Related course material is evidence of a reference, never of scenario × level coverage.
const companyIntroduction = curriculumReference('data/curriculum.ts', 'w01', '출근 인사와 첫 소개', 'e00a92cccfdf0e3b06d4797e7feb6ecc1414716c49a0e6a00df5400c1b3376fc');
const curriculumReferences: Readonly<Record<FreeConversationContextId, readonly ConversationCurriculumReference[]>> = immutable({
  'convenience-store': [],
  restaurant: [curriculumReference('data/curriculum.ts', 't04', '식당에서 주문', '771397e788236bf1ece47c396edf6113525814be1c1c715471e8ab35fc086530')],
  hotel: [curriculumReference('data/curriculum.ts', 't03', '호텔 체크인', '03d44e7d287b8f312c7014b13b88a4d7b1fd83c17be23d59c6d99f07e295b84f')],
  train: [curriculumReference('data/curriculum.ts', 't02', '전철과 버스', 'db758d2c4a78216f8e92ec486f43a2a28350a111805b4f6a5cd75d804326b6ff')],
  'company-general': [companyIntroduction],
  'company-mechanical-design': [curriculumReference('data/curriculumManufacturing.ts', 'w21', '도면 치수와 공차 확인', 'df0441683d984d1f137c1d7162b737ec13b45ea60cdb38d7502b4b1f68e3591e')],
  'company-development': [companyIntroduction],
  'company-quality': [curriculumReference('data/curriculumManufacturing.ts', 'w22', '측정 결과와 품질 확인', '8e7918620b852ac32f37a107c68dcd68ec789286e962cad78c65f1b66bf1cbba')],
});

type FreeConversationCoverageIdentity = Readonly<{
  id: string;
  contextId: FreeConversationContextId;
  levelId: FreeConversationLevelId;
  references: readonly ConversationCurriculumReference[];
}>;

export type FreeConversationCoverageCell = FreeConversationCoverageIdentity & (Readonly<{
  contextId: 'convenience-store';
  availability: 'available';
  scriptId: string;
  scriptRevision: string;
  contentReviewStatus: 'locally-authored-unreviewed';
}> | Readonly<{
  availability: 'not-authored' | 'reference-only';
  scriptId: null;
  scriptRevision: null;
  contentReviewStatus: 'not-authored';
}>);

export const FREE_CONVERSATION_COVERAGE: readonly FreeConversationCoverageCell[] = immutable(
  FREE_CONVERSATION_CONTEXTS.flatMap(context => FREE_CONVERSATION_LEVELS.map((level): FreeConversationCoverageCell => {
    const script = GUIDED_CONVERSATION_PILOT.find(script => script.contextId === context.id && script.levelId === level.id);
    if (script) return {
      id: `${context.id}:${level.id}`,
      contextId: script.contextId,
      levelId: script.levelId,
      availability: 'available',
      scriptId: script.scriptId,
      scriptRevision: script.scriptRevision,
      contentReviewStatus: script.authorship.status,
      references: curriculumReferences[context.id],
    };
    return {
      id: `${context.id}:${level.id}`,
      contextId: context.id,
      levelId: level.id,
      availability: curriculumReferences[context.id].length ? 'reference-only' : 'not-authored',
      scriptId: null,
      scriptRevision: null,
      contentReviewStatus: 'not-authored',
      references: curriculumReferences[context.id],
    };
  })),
);

/** Unknown or unavailable selections never substitute a legacy example or another level. */
export function findFreeConversationCoverage(contextId: string, levelId: string): FreeConversationCoverageCell | undefined {
  return FREE_CONVERSATION_COVERAGE.find(cell => cell.contextId === contextId && cell.levelId === levelId);
}

const legacyDefinitions = [
  { id: 'legacy-cafe', situation: '카페' },
  { id: 'legacy-travel', situation: '여행' },
  { id: 'legacy-daily', situation: '일상' },
  { id: 'legacy-work', situation: '업무' },
  { id: 'legacy-friends', situation: '친구' },
] as const;

/** Frozen copies retain the five existing examples without freezing/mutating the old API. */
export const LEGACY_FREE_CONVERSATION_SCRIPTS = immutable(legacyDefinitions.map(({ id, situation }) => ({
  contextId: id,
  label: situation,
  legacySituation: situation,
  levelId: 'unlevelled' as const,
  scriptId: id,
  scriptRevision: LEGACY_FREE_CONVERSATION_REVISION,
  availability: 'available' as const,
  contentReviewStatus: 'legacy-unreviewed' as const,
  contentSource: {
    kind: 'legacy-example' as const,
    module: 'data/freeConversation.ts' as const,
    exportName: 'FREE_CONVERSATIONS' as const,
    entryKey: situation,
    revision: LEGACY_FREE_CONVERSATION_REVISION,
  },
  content: { ...FREE_CONVERSATIONS[situation] },
  steps: [{
    id: `${id}:exchange-1`,
    // Legacy content has no separate opening prompt or translated reply.
    prompt: null,
    example: { role: 'learner-example' as const, japanese: 'japanese' as const, reading: 'reading' as const, pronunciation: 'pronunciation' as const, meaning: 'meaning' as const },
    reply: { role: 'script-response' as const, japanese: 'reply' as const, reading: 'replyReading' as const, pronunciation: 'replyPronunciation' as const, meaning: null },
    hint: 'hint' as const,
  }],
})));

export type LegacyFreeConversationScript = typeof LEGACY_FREE_CONVERSATION_SCRIPTS[number];

export function findLegacyFreeConversationScript(scriptId: string, scriptRevision: string): LegacyFreeConversationScript | undefined {
  return LEGACY_FREE_CONVERSATION_SCRIPTS.find(script => script.scriptId === scriptId && script.scriptRevision === scriptRevision);
}

export type FreeConversationSampleMatchFact = Readonly<{
  policyVersion: typeof FREE_CONVERSATION_SAMPLE_MATCH_POLICY;
  matched: boolean;
  matchedAgainst: 'example' | 'reading' | null;
  assessment: 'unavailable';
}>;

/** Compare an exact saved snapshot, never today's catalog, when rebuilding a recap. */
export function matchFreeConversationSample(input: string, sample: Readonly<{ japanese: string; reading: string }>): FreeConversationSampleMatchFact {
  const normalize = (text: string) => text.normalize('NFKC').replace(/[\s。、！？?!]/g, '');
  const normalized = normalize(input);
  // An absent/blank snapshot cannot establish a sample match.
  const matchedAgainst = normalized && normalized === normalize(sample.japanese) ? 'example'
    : normalized && normalized === normalize(sample.reading) ? 'reading' : null;
  return Object.freeze({
    policyVersion: FREE_CONVERSATION_SAMPLE_MATCH_POLICY,
    matched: matchedAgainst !== null,
    matchedAgainst,
    assessment: 'unavailable',
  });
}

export type FreeConversationSampleMatch = FreeConversationSampleMatchFact & Readonly<{
  scriptId: string;
  scriptRevision: string;
  stepId: string;
}>;

/** Normalized equality only. It says nothing about correctness, naturalness or proficiency. */
export function getFreeConversationSampleMatch(scriptId: string, scriptRevision: string, input: string): FreeConversationSampleMatch | undefined {
  const script = findLegacyFreeConversationScript(scriptId, scriptRevision);
  if (!script) return undefined;
  return Object.freeze({
    ...matchFreeConversationSample(input, script.content),
    scriptId: script.scriptId,
    scriptRevision: script.scriptRevision,
    stepId: script.steps[0].id,
  });
}

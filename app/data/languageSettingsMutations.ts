import { assertLanguageRecordSource, type LanguageRecordContext, type LanguageRecordSnapshot } from './languageCloudSync.ts';
import { assertLanguagePathsUnchanged, languageDocument, LanguageDocumentError, type LanguageJsonPath } from './languageRecordDocuments.ts';
import { createLanguageMutation, getLanguageMutationOutcome, reconcileLanguageMutation, runLanguageMutation, type LanguageMutation, type LanguageMutationResult } from './languageRecordMutations.ts';
import type { LanguageBytes } from './languageStorageBoundary.ts';
import { DEFAULT_INTEGRATED_LEARNING_SETTINGS, INTEGRATED_LEARNING_SETTINGS_KEY, type IntegratedLearningSettings } from '../../utils/integratedLearningSettings.ts';

export type LearningSection = 'kana' | 'words' | 'sentences' | 'speaking' | 'conversation';
export type CommonSectionSettings = { ttsRate: number; repeatCount: number; repeatDelayMs: number };
export type DetailedSectionSettings = CommonSectionSettings & { showKoreanPronunciation: boolean; showReading: boolean };
export type SectionField = keyof DetailedSectionSettings;
export type JapaneseAppSettings = { sections: { kana: CommonSectionSettings } & Record<Exclude<LearningSection, 'kana'>, DetailedSectionSettings> };
export const JAPANESE_APP_SETTINGS_KEY = 'japaneseAppSettings';
export const LEARNING_SETTINGS_KEY = 'learningSettings';
export const DEFAULT_COMMON_SECTION: CommonSectionSettings = { ttsRate: 1, repeatCount: 1, repeatDelayMs: 500 };
export const DEFAULT_DETAILED_SECTION: DetailedSectionSettings = { ...DEFAULT_COMMON_SECTION, showKoreanPronunciation: true, showReading: true };
const SECTIONS: readonly LearningSection[] = ['kana', 'words', 'sentences', 'speaking', 'conversation'];
const COMMON_FIELDS = ['ttsRate', 'repeatCount', 'repeatDelayMs'] as const;
const DETAILED_FIELDS = [...COMMON_FIELDS, 'showKoreanPronunciation', 'showReading'] as const;
export const DEFAULT_JAPANESE_APP_SETTINGS: JapaneseAppSettings = { sections: {
  kana: { ...DEFAULT_COMMON_SECTION }, words: { ...DEFAULT_DETAILED_SECTION }, sentences: { ...DEFAULT_DETAILED_SECTION }, speaking: { ...DEFAULT_DETAILED_SECTION }, conversation: { ...DEFAULT_DETAILED_SECTION },
} };
export function validSectionSetting(field: SectionField, value: unknown): boolean {
  if (field === 'ttsRate') return [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.2].includes(value as number);
  if (field === 'repeatCount') return [1, 2, 3].includes(value as number);
  if (field === 'repeatDelayMs') return [0, 300, 500, 1000, 1500, 2000].includes(value as number);
  return (field === 'showKoreanPronunciation' || field === 'showReading') && typeof value === 'boolean';
}
function validIntegratedSetting(field: keyof IntegratedLearningSettings, value: unknown): boolean {
  switch (field) {
    case 'dailyMinutes': return [5, 10, 20].includes(value as number);
    case 'preferredTrack': return ['foundation', 'work', 'travel'].includes(value as string);
    case 'audioRate': return [0.8, 0.9, 1].includes(value as number);
    case 'learnerMode': return value === 'starter' || value === 'reader';
    default: return Object.hasOwn(DEFAULT_INTEGRATED_LEARNING_SETTINGS, field) && typeof value === 'boolean';
  }
}
/** Display projection only. An absent/unsupported value is never a persistence source. */
export function loadJapaneseAppSettings(raw?: string | null): JapaneseAppSettings {
  try {
    const doc = languageDocument(raw, 'object');
    const result = { sections: {} } as JapaneseAppSettings;
    for (const section of SECTIONS) {
      const values = { ...(section === 'kana' ? DEFAULT_COMMON_SECTION : DEFAULT_DETAILED_SECTION) };
      for (const field of section === 'kana' ? COMMON_FIELDS : DETAILED_FIELDS) {
        const nested = doc.get(['sections', section, field]);
        const legacy = doc.get([field]);
        const value = validSectionSetting(field, nested) ? nested : validSectionSetting(field, legacy) ? legacy : DEFAULT_DETAILED_SECTION[field];
        Object.assign(values, { [field]: value });
      }
      Object.assign(result.sections, { [section]: values });
    }
    return result;
  } catch { return { sections: { kana: { ...DEFAULT_COMMON_SECTION }, words: { ...DEFAULT_DETAILED_SECTION }, sentences: { ...DEFAULT_DETAILED_SECTION }, speaking: { ...DEFAULT_DETAILED_SECTION }, conversation: { ...DEFAULT_DETAILED_SECTION } } }; }
}
export function loadDailyGoalCount(raw?: string | null): number {
  try { const value = languageDocument(raw, 'object').get(['dailyGoalCount']); return [1, 2, 3, 4, 5].includes(value as number) ? value as number : 5; }
  catch { return 5; }
}
/** Surface unsupported display fields without rewriting the source or interpreting unknown tokens. */
export function languageSettingsProjectionError(records: LanguageBytes): string | null {
  try {
    if (records[JAPANESE_APP_SETTINGS_KEY] !== undefined) {
      const doc = languageDocument(records[JAPANESE_APP_SETTINGS_KEY], 'object');
      for (const section of SECTIONS) for (const field of section === 'kana' ? COMMON_FIELDS : DETAILED_FIELDS) {
        for (const path of [[field], ['sections', section, field]]) {
          if (doc.has(path) && !validSectionSetting(field, doc.get(path))) throw new LanguageDocumentError();
        }
      }
    }
    if (records[INTEGRATED_LEARNING_SETTINGS_KEY] !== undefined) {
      const doc = languageDocument(records[INTEGRATED_LEARNING_SETTINGS_KEY], 'object');
      for (const field of Object.keys(DEFAULT_INTEGRATED_LEARNING_SETTINGS) as (keyof IntegratedLearningSettings)[]) {
        if (doc.has([field]) && !validIntegratedSetting(field, doc.get([field]))) throw new LanguageDocumentError();
      }
    }
    if (records[LEARNING_SETTINGS_KEY] !== undefined) {
      const doc = languageDocument(records[LEARNING_SETTINGS_KEY], 'object');
      if (doc.has(['dailyGoalCount']) && ![1, 2, 3, 4, 5].includes(doc.get(['dailyGoalCount']) as number)) throw new LanguageDocumentError();
    }
    return null;
  } catch { return '일부 학습 설정을 읽지 못해 기본값으로 표시했어요. 원본은 보존했어요.'; }
}
export type LearningSettingsPatch = { dailyGoalCount?: number; integrated?: Partial<IntegratedLearningSettings> };
export type LanguageSettingsPayload =
  | { kind: 'section'; section: LearningSection; field: SectionField; value: number | boolean }
  | { kind: 'learning'; patch: LearningSettingsPatch }
  | { kind: 'reset' };
export type LanguageSettingsMutation = LanguageMutation<LanguageSettingsPayload>;
type SettingPatch = { key: typeof JAPANESE_APP_SETTINGS_KEY | typeof LEARNING_SETTINGS_KEY | typeof INTEGRATED_LEARNING_SETTINGS_KEY; path: LanguageJsonPath; value: unknown; fallback: unknown; valid: (value: unknown) => boolean; dependency?: LanguageJsonPath };
function patchesFor(payload: LanguageSettingsPayload): SettingPatch[] {
  if (payload.kind === 'section') {
    const { section, field, value } = payload;
    if (!SECTIONS.includes(section) || !(section === 'kana' ? COMMON_FIELDS : DETAILED_FIELDS).includes(field as never) || !validSectionSetting(field, value)) throw new LanguageDocumentError();
    return [{ key: JAPANESE_APP_SETTINGS_KEY, path: ['sections', section, field], dependency: [field], value, fallback: DEFAULT_DETAILED_SECTION[field], valid: value => validSectionSetting(field, value) }];
  }
  if (payload.kind === 'learning') {
    const patches: SettingPatch[] = [];
    if (Object.keys(payload.patch).some(key => key !== 'integrated' && key !== 'dailyGoalCount')) throw new LanguageDocumentError();
    if (Object.hasOwn(payload.patch, 'dailyGoalCount')) patches.push({ key: LEARNING_SETTINGS_KEY, path: ['dailyGoalCount'], value: payload.patch.dailyGoalCount, fallback: 5, valid: value => [1, 2, 3, 4, 5].includes(value as number) });
    for (const [name, value] of Object.entries(payload.patch.integrated ?? {})) {
      const field = name as keyof IntegratedLearningSettings;
      if (!Object.hasOwn(DEFAULT_INTEGRATED_LEARNING_SETTINGS, field)) throw new LanguageDocumentError();
      patches.push({ key: INTEGRATED_LEARNING_SETTINGS_KEY, path: [field], value, fallback: DEFAULT_INTEGRATED_LEARNING_SETTINGS[field], valid: value => validIntegratedSetting(field, value) });
    }
    if (patches.some(patch => !patch.valid(patch.value))) throw new LanguageDocumentError();
    return patches;
  }
  if (payload.kind !== 'reset') throw new LanguageDocumentError();
  return [
    ...SECTIONS.flatMap(section => (section === 'kana' ? COMMON_FIELDS : DETAILED_FIELDS).flatMap(field => patchesFor({ kind: 'section', section, field, value: DEFAULT_DETAILED_SECTION[field] }))),
    ...patchesFor({ kind: 'learning', patch: { integrated: DEFAULT_INTEGRATED_LEARNING_SETTINGS } }),
  ];
}
export function createSectionSettingMutation(context: LanguageRecordContext, source: LanguageRecordSnapshot, section: LearningSection, field: SectionField, value: number | boolean): LanguageSettingsMutation {
  return createSettingsMutation(context, source, { kind: 'section', section, field, value });
}
export function createLearningSettingsMutation(context: LanguageRecordContext, source: LanguageRecordSnapshot, patch: LearningSettingsPatch): LanguageSettingsMutation {
  return createSettingsMutation(context, source, { kind: 'learning', patch });
}
export function createResetLanguageSettingsMutation(context: LanguageRecordContext, source: LanguageRecordSnapshot): LanguageSettingsMutation {
  return createSettingsMutation(context, source, { kind: 'reset' });
}
function createSettingsMutation(context: LanguageRecordContext, source: LanguageRecordSnapshot, payload: LanguageSettingsPayload): LanguageSettingsMutation {
  patchesFor(payload); return createLanguageMutation(context, source, payload);
}
export function planLanguageSettingsMutation(fresh: LanguageBytes, intent: LanguageSettingsMutation) {
  if (intent.payload.kind === 'learning') {
    languageDocument(fresh[LEARNING_SETTINGS_KEY], 'object');
    languageDocument(fresh[INTEGRATED_LEARNING_SETTINGS_KEY], 'object');
  }
  const changes: Partial<Record<SettingPatch['key'], string>> = {};
  const docs = new Map<SettingPatch['key'], ReturnType<typeof languageDocument>>();
  for (const patch of patchesFor(intent.payload)) {
    const paths = patch.dependency ? [patch.path, patch.dependency] : [patch.path];
    assertLanguagePathsUnchanged(intent.source.records[patch.key], fresh[patch.key], 'object', paths);
    const original = languageDocument(fresh[patch.key], 'object');
    const existing = original.get(patch.path);
    if (original.has(patch.path) && !patch.valid(existing)) throw new LanguageDocumentError();
    const dependency = patch.dependency ? original.get(patch.dependency) : undefined;
    if (patch.dependency && original.has(patch.dependency) && !patch.valid(dependency)) throw new LanguageDocumentError();
    const effective = existing ?? dependency ?? patch.fallback;
    // No materialized defaults and no scalar token reformatting for no-op edits.
    if (effective === patch.value) continue;
    let doc = docs.get(patch.key);
    if (!doc) { doc = languageDocument(fresh[patch.key], 'object'); docs.set(patch.key, doc); }
    doc.set(patch.path, patch.value);
  }
  for (const [key, doc] of docs) if (doc.text() !== fresh[key]) changes[key] = doc.text();
  return { changes, result: true as const };
}
export async function runLanguageSettingsMutation(intent: LanguageSettingsMutation, currentContext?: LanguageRecordContext | null) {
  const outcome = getLanguageMutationOutcome(intent);
  if (outcome === 'committed' || outcome === 'unknown' || (currentContext && currentContext !== intent.context)) return reconcileLanguageMutation<LanguageSettingsPayload, true>(intent, currentContext ?? intent.context);
  return runLanguageMutation(intent, planLanguageSettingsMutation);
}

/** Advance only undispatched edits over this editor's verified commit. Failed intents never use this. */
export function advanceLanguageSettingsDraftSource(source: LanguageRecordSnapshot, payload: LanguageSettingsPayload, completed: LanguageSettingsMutation, receipt: LanguageMutationResult<true>): LanguageRecordSnapshot {
  if (!receipt.acknowledged || !receipt.source) throw new LanguageDocumentError();
  assertLanguageRecordSource(source, receipt.source.context);
  const own = planLanguageSettingsMutation(source.records, completed).changes;
  const expected = { ...source.records, ...own };
  for (const patch of patchesFor(payload)) {
    const paths = patch.dependency ? [patch.path, patch.dependency] : [patch.path];
    assertLanguagePathsUnchanged(expected[patch.key], receipt.committedRecords[patch.key], 'object', paths);
    assertLanguagePathsUnchanged(receipt.committedRecords[patch.key], receipt.source.records[patch.key], 'object', paths);
  }
  return receipt.source;
}

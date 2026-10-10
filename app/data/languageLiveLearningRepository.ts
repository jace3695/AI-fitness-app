import type { SupabaseClient } from '@supabase/supabase-js';
import { languageLiveStorageError } from './languageLiveRepository.ts';
import { LanguageLiveError, type LiveLesson } from '../../lib/language-live/types.ts';
import { stableLiveValue } from '../../lib/language-live/identity.ts';
import { validateLiveReport } from '../../lib/language-live/validation.ts';
import { assertLiveLearningInput, isLiveUuid, validateLiveLearningInput } from '../../lib/language-live/learning-validation.ts';
import type { LiveLearningBatch, LiveLearningSnapshot, SaveLiveLearningInput } from '../../lib/language-live/learning-types.ts';

type Client = Pick<SupabaseClient, 'auth' | 'from' | 'rpc'>;
const COLUMNS = 'user_id,lesson_id,lesson_revision,version,previous_version,request_id,payload,payload_hash,created_at';
const failVerification = () => new LanguageLiveError('verification', '복습 기록의 계정·근거·버전을 확인하지 못했어요. 입력 내용을 보존하고 다시 확인해 주세요.');

function learningError(error: unknown): LanguageLiveError {
  const detail = error && typeof error === 'object' ? error as { message?: string } : {};
  if (detail.message?.includes('LIVE_LIMIT')) return new LanguageLiveError('storage', '복습 이력이 한 번에 조회할 수 있는 범위를 넘었어요. 일부만 학습 상태로 표시하지 않았어요.');
  return languageLiveStorageError(error);
}

export function decodeLiveLearningBatch(value: unknown, ownerId: string): LiveLearningBatch {
  if (!value || typeof value !== 'object') throw failVerification();
  const batch = value as LiveLearningBatch;
  if (batch.user_id !== ownerId || !isLiveUuid(batch.lesson_id) || !isLiveUuid(batch.request_id) ||
    !Number.isSafeInteger(batch.lesson_revision) || batch.lesson_revision < 1 ||
    !Number.isSafeInteger(batch.version) || batch.version < 1 || batch.previous_version !== batch.version - 1 ||
    typeof batch.payload_hash !== 'string' || !batch.payload_hash || typeof batch.created_at !== 'string' || !Number.isFinite(Date.parse(batch.created_at)) ||
    validateLiveLearningInput(batch.payload).length || batch.payload.lessonId !== batch.lesson_id || batch.payload.lessonRevision !== batch.lesson_revision ||
    batch.payload.expectedVersion !== batch.previous_version || batch.payload.requestId !== batch.request_id) throw failVerification();
  return batch;
}

export function decodeLiveLearningSnapshot(value: unknown, ownerId: string): LiveLearningSnapshot {
  if (!value || typeof value !== 'object') throw failVerification();
  const snapshot = value as LiveLearningSnapshot;
  if (snapshot.ownerId !== ownerId || !Array.isArray(snapshot.lessons) || !Array.isArray(snapshot.batches) || snapshot.lessons.length > 1000 || snapshot.batches.length > 2000) throw failVerification();
  const lessons = new Map<string, LiveLesson>();
  for (const lesson of snapshot.lessons) {
    if (!lesson || lesson.user_id !== ownerId || !isLiveUuid(lesson.lesson_id) || !Number.isSafeInteger(lesson.revision) || lesson.revision < 1 ||
      lesson.previous_revision !== lesson.revision - 1 || !['create', 'edit', 'delete', 'restore'].includes(lesson.operation) ||
      (lesson.operation === 'create') !== (lesson.revision === 1) || !isLiveUuid(lesson.request_id) ||
      typeof lesson.payload_hash !== 'string' || !lesson.payload_hash || typeof lesson.created_at !== 'string' || !Number.isFinite(Date.parse(lesson.created_at)) ||
      validateLiveReport(lesson.report).length || lessons.has(lesson.lesson_id)) throw failVerification();
    lessons.set(lesson.lesson_id, lesson);
  }
  const versions = new Map<string, number[]>(), requests = new Set<string>();
  for (const raw of snapshot.batches) {
    const batch = decodeLiveLearningBatch(raw, ownerId);
    const source = lessons.get(batch.lesson_id);
    if (!source || batch.lesson_revision > source.revision || requests.has(batch.request_id)) throw failVerification();
    requests.add(batch.request_id);
    const key = `${batch.lesson_id}:${batch.lesson_revision}`;
    versions.set(key, [...(versions.get(key) ?? []), batch.version]);
  }
  // A missing page/row must not silently resurrect superseded evidence.
  for (const sequence of versions.values()) {
    sequence.sort((a, b) => a - b);
    if (sequence.some((version, index) => version !== index + 1)) throw failVerification();
  }
  return snapshot;
}

/** No local storage, legacy completion writes, provider calls, or unconfirmed extraction. */
export function createLanguageLiveLearningRepository(client: Client, expectedOwner: string) {
  async function owner() {
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) throw new LanguageLiveError('unauthenticated', '로그인 상태를 확인한 뒤 복습 기록을 열어 주세요.');
    if (data.user.id !== expectedOwner) throw new LanguageLiveError('account_changed', '계정이 바뀌어 이전 계정의 복습 요청을 중단했어요.');
    return data.user.id;
  }
  return {
    async saveLearning(input: SaveLiveLearningInput): Promise<LiveLearningBatch> {
      assertLiveLearningInput(input);
      input = JSON.parse(JSON.stringify(input)) as SaveLiveLearningInput;
      const userId = await owner();
      const { data, error } = await client.rpc('save_language_live_learning', { p_payload: input, p_expected_owner: userId });
      if (error) throw learningError(error);
      await owner();
      const receipt = decodeLiveLearningBatch(data, userId);
      if (stableLiveValue(receipt.payload) !== stableLiveValue(input)) throw failVerification();
      const { data: verified, error: readError } = await client.from('language_live_learning_batches').select(COLUMNS)
        .eq('user_id', userId).eq('lesson_id', input.lessonId).eq('lesson_revision', input.lessonRevision)
        .eq('version', input.expectedVersion + 1).eq('request_id', input.requestId).maybeSingle();
      // The RPC may already be committed. Readback errors, even schema or
      // validation-shaped ones, cannot safely unlock/change the original input.
      if (readError) throw failVerification();
      await owner();
      if (stableLiveValue(decodeLiveLearningBatch(verified, userId)) !== stableLiveValue(receipt)) throw failVerification();
      return decodeLiveLearningBatch(verified, userId);
    },
    async readLearning(): Promise<LiveLearningSnapshot> {
      const userId = await owner();
      const { data, error } = await client.rpc('read_language_live_learning', { p_expected_owner: userId });
      if (error) throw learningError(error);
      await owner();
      return decodeLiveLearningSnapshot(data, userId);
    },
  };
}

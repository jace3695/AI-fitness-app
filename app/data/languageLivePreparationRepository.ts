import type { SupabaseClient } from '@supabase/supabase-js';
import { languageLiveStorageError } from './languageLiveRepository.ts';
import { LanguageLiveError } from '../../lib/language-live/types.ts';
import { stableLiveValue } from '../../lib/language-live/identity.ts';
import { isLiveUuid } from '../../lib/language-live/learning-validation.ts';
import { assertLivePreparationInput, validateLivePreparationInput } from '../../lib/language-live/preparation-validation.ts';
import type { LivePreparationRecord, SaveLivePreparationInput } from '../../lib/language-live/preparation-types.ts';

type Client = Pick<SupabaseClient, 'auth' | 'from' | 'rpc'>;
const COLUMNS = 'user_id,preparation_id,revision,previous_revision,request_id,payload,payload_hash,created_at';
const failVerification = () => new LanguageLiveError('verification', '수업 준비문의 계정·내용·이력을 확인하지 못했어요. 작성한 내용과 같은 저장 요청을 보존해 주세요.');
function preparationError(error: unknown): LanguageLiveError {
  const detail = error && typeof error === 'object' ? error as { message?: string } : {};
  if (detail.message?.includes('LIVE_LIMIT')) return new LanguageLiveError('storage', '준비문 또는 학습 이력이 한 번에 확인할 수 있는 범위를 넘었어요. 일부만 불러오지 않았어요.');
  if (detail.message?.includes('LIVE_CONFLICT preparation source')) return new LanguageLiveError('conflict', '준비문을 만든 뒤 학습 근거가 바뀌었어요. 작성한 내용은 보존했으니 최신 기록으로 다시 준비해 주세요.');
  return languageLiveStorageError(error);
}

export function decodeLivePreparationRecord(value: unknown, ownerId: string): LivePreparationRecord {
  if (!value || typeof value !== 'object') throw failVerification();
  const row = value as LivePreparationRecord;
  if (row.user_id !== ownerId || !isLiveUuid(row.preparation_id) || !isLiveUuid(row.request_id) ||
    !Number.isSafeInteger(row.revision) || row.revision < 1 || row.revision > 2_147_483_647 || row.previous_revision !== row.revision - 1 ||
    typeof row.payload_hash !== 'string' || !row.payload_hash || typeof row.created_at !== 'string' || !Number.isFinite(Date.parse(row.created_at)) ||
    validateLivePreparationInput(row.payload).length || row.payload.preparationId !== row.preparation_id ||
    row.payload.requestId !== row.request_id || row.payload.expectedRevision !== row.previous_revision || row.payload.preparation.source.ownerId !== ownerId) throw failVerification();
  return row;
}

export function decodeLivePreparationHistory(value: unknown, ownerId: string): LivePreparationRecord[] {
  if (!value || typeof value !== 'object') throw failVerification();
  const history = value as { ownerId?: unknown; count?: unknown; records?: unknown };
  if (history.ownerId !== ownerId || !Array.isArray(history.records) || history.records.length > 1000 || history.count !== history.records.length) throw failVerification();
  const rows = history.records.map(row => decodeLivePreparationRecord(row, ownerId));
  const requests = new Set<string>(), revisions = new Map<string, number[]>();
  for (const row of rows) {
    if (requests.has(row.request_id)) throw failVerification();
    requests.add(row.request_id);
    revisions.set(row.preparation_id, [...(revisions.get(row.preparation_id) ?? []), row.revision]);
  }
  for (const sequence of revisions.values()) {
    sequence.sort((a, b) => a - b);
    if (sequence.some((revision, index) => revision !== index + 1)) throw failVerification();
  }
  if (new TextEncoder().encode(JSON.stringify(value)).length > 10_000_000) throw failVerification();
  return rows;
}

/** Append-only drafts. No provider call, transcript inference, clipboard write, or legacy state mutation. */
export function createLanguageLivePreparationRepository(client: Client, expectedOwner: string) {
  async function owner() {
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) throw new LanguageLiveError('unauthenticated', '로그인 상태를 확인한 뒤 수업 준비문을 열어 주세요.');
    if (data.user.id !== expectedOwner) throw new LanguageLiveError('account_changed', '계정이 바뀌어 이전 계정의 준비문 요청을 중단했어요.');
    return data.user.id;
  }
  return {
    async savePreparation(input: SaveLivePreparationInput): Promise<LivePreparationRecord> {
      assertLivePreparationInput(input);
      // Capture before the first await, including all nested source references.
      input = JSON.parse(JSON.stringify(input)) as SaveLivePreparationInput;
      const userId = await owner();
      if (input.preparation.source.ownerId !== userId) throw failVerification();
      const { data, error } = await client.rpc('save_language_live_preparation', { p_payload: input, p_expected_owner: userId });
      if (error) throw preparationError(error);
      await owner();
      const receipt = decodeLivePreparationRecord(data, userId);
      if (stableLiveValue(receipt.payload) !== stableLiveValue(input)) throw failVerification();
      const { data: verified, error: readError } = await client.from('language_live_preparations').select(COLUMNS)
        .eq('user_id', userId).eq('preparation_id', input.preparationId).eq('revision', input.expectedRevision + 1)
        .eq('request_id', input.requestId).maybeSingle();
      // RPC may already be committed: every readback error keeps the immutable retry locked.
      if (readError) throw failVerification();
      await owner();
      const stored = decodeLivePreparationRecord(verified, userId);
      if (stableLiveValue(stored) !== stableLiveValue(receipt)) throw failVerification();
      return stored;
    },
    async listPreparations(): Promise<LivePreparationRecord[]> {
      const userId = await owner();
      const { data, error } = await client.rpc('read_language_live_preparations', { p_expected_owner: userId });
      if (error) throw preparationError(error);
      await owner();
      return decodeLivePreparationHistory(data, userId);
    },
  };
}

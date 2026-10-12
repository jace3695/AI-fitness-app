import type { SupabaseClient } from '@supabase/supabase-js';
import { LanguageLiveError, type LiveLesson, type LiveMutationTarget, type RestoreLiveLessonInput, type SaveLiveLessonInput } from '../../lib/language-live/types.ts';
import { assertLiveMutationTarget, validateLiveReport } from '../../lib/language-live/validation.ts';
import { stableLiveValue } from '../../lib/language-live/identity.ts';

export { LanguageLiveError } from '../../lib/language-live/types.ts';
type Client = Pick<SupabaseClient, 'auth' | 'from' | 'rpc'>;
const COLUMNS = 'user_id,lesson_id,revision,previous_revision,operation,report,created_at,request_id,payload_hash,restored_from_revision,duplicate_reason';

export function languageLiveStorageError(error: unknown): LanguageLiveError {
  if (error instanceof LanguageLiveError) return error;
  const detail = error && typeof error === 'object' ? error as { code?: string; message?: string } : {};
  if (['42P01', '42703', 'PGRST202', 'PGRST204', 'PGRST205'].includes(detail.code ?? '')) return new LanguageLiveError('schema_unavailable', 'AI Live 저장소가 아직 준비되지 않았어요. 원문을 보존하고 준비가 끝난 뒤 다시 저장해 주세요.');
  if (detail.message?.includes('LIVE_DUPLICATE')) return new LanguageLiveError('duplicate', '같은 원문과 날짜의 수업이 이미 있어요. 기존 기록을 확인하거나 별도 수업인 이유를 남겨 주세요.');
  if (detail.message?.includes('LIVE_CONFLICT') || detail.code === '23505') return new LanguageLiveError('conflict', '다른 곳에서 수업 기록이 바뀌었거나 요청이 이미 사용됐어요. 원문을 보존하고 최신 기록을 확인해 주세요.');
  if (detail.message?.includes('LIVE_VALIDATION') || ['23514', '22007', '22008', '22P02'].includes(detail.code ?? '')) return new LanguageLiveError('validation', '저장할 보고서와 수업 날짜·버전을 다시 확인해 주세요. 원문은 보존했어요.');
  if (detail.message?.includes('LIVE_ACCOUNT_CHANGED')) return new LanguageLiveError('account_changed', '로그인 계정이 바뀌어 이전 계정의 내용을 저장하지 않았어요.');
  if (detail.message?.includes('LIVE_AUTH') || detail.code === '42501') return new LanguageLiveError('unauthenticated', '이 계정의 AI Live 기록에 접근할 수 없어요. 로그인 상태를 확인해 주세요.');
  return new LanguageLiveError('storage', '저장 결과를 확인하지 못했어요. 원문을 보존했으니 같은 요청으로 다시 확인해 주세요.');
}

function decodeLesson(value: unknown, owner: string): LiveLesson {
  if (!value || typeof value !== 'object') throw new LanguageLiveError('verification', '서버의 수업 기록을 확인하지 못했어요. 원문을 보존해 주세요.');
  const row = value as LiveLesson;
  if (row.user_id !== owner || !Number.isSafeInteger(row.revision) || row.revision < 1 || row.previous_revision !== row.revision - 1 || typeof row.lesson_id !== 'string' || typeof row.request_id !== 'string' || typeof row.payload_hash !== 'string' || !row.payload_hash || typeof row.created_at !== 'string' || !Number.isFinite(Date.parse(row.created_at)) || !['create', 'edit', 'delete', 'restore'].includes(row.operation) || (row.operation === 'create') !== (row.revision === 1) || (row.operation === 'restore' ? !Number.isSafeInteger(row.restored_from_revision) || row.restored_from_revision! < 1 || row.restored_from_revision! >= row.revision : row.restored_from_revision !== null) || (row.duplicate_reason !== null && (typeof row.duplicate_reason !== 'string' || row.duplicate_reason.trim().length < 3 || row.duplicate_reason.length > 500)) || validateLiveReport(row.report).length) {
    throw new LanguageLiveError('verification', '서버 기록의 계정·내용·버전이 예상과 달라요. 원문을 보존하고 다시 확인해 주세요.');
  }
  return row;
}

/** No localStorage or legacy state writes. A write is successful only after owner-scoped GET. */
export function createLanguageLiveRepository(client: Client, expectedOwner?: string) {
  async function owner(): Promise<string> {
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) throw new LanguageLiveError('unauthenticated', '로그인 상태를 확인한 뒤 AI Live 기록을 열어 주세요.');
    if (expectedOwner && data.user.id !== expectedOwner) throw new LanguageLiveError('account_changed', '로그인 계정이 바뀌어 이전 계정의 요청을 중단했어요.');
    return data.user.id;
  }
  async function assertOwner(expected: string) {
    if (await owner() !== expected) throw new LanguageLiveError('account_changed', '로그인 계정이 바뀌어 이전 요청 결과를 반영하지 않았어요.');
  }
  async function currentFor(userId: string, lessonId: string) {
    const { data, error } = await client.from('language_live_current_lessons').select(COLUMNS).eq('user_id', userId).eq('lesson_id', lessonId).maybeSingle();
    if (error) throw languageLiveStorageError(error);
    if (!data) return null;
    const lesson = decodeLesson(data, userId);
    if (lesson.lesson_id !== lessonId) throw new LanguageLiveError('verification', '요청한 수업과 조회한 기록이 다릅니다. 다시 확인해 주세요.');
    return lesson;
  }
  async function mutate(input: LiveMutationTarget, operation: LiveLesson['operation'], extras: { report?: SaveLiveLessonInput['report']; restoreRevision?: number; allowDuplicate?: boolean; duplicateReason?: string } = {}): Promise<LiveLesson> {
    // Snapshot before the first await: edits to the caller's draft cannot change a retry.
    input = { ...input };
    assertLiveMutationTarget(input);
    if (extras.report) {
      const problems = validateLiveReport(extras.report);
      if (problems.length) throw new LanguageLiveError('validation', problems.join('\n'));
    }
    extras = JSON.parse(JSON.stringify(extras));
    if (extras.allowDuplicate && (!extras.duplicateReason || extras.duplicateReason.trim().length < 3 || extras.duplicateReason.length > 500)) throw new LanguageLiveError('validation', '별도 수업으로 저장하는 이유를 3~500자로 적어 주세요.');
    const duplicateReason = extras.allowDuplicate ? extras.duplicateReason!.trim() : null;
    if (operation !== 'create' && input.expectedRevision < 1) throw new LanguageLiveError('validation', '최신 수업 버전을 먼저 확인해 주세요.');
    if (operation === 'restore' && (!Number.isSafeInteger(extras.restoreRevision) || extras.restoreRevision! < 1 || extras.restoreRevision! > input.expectedRevision)) throw new LanguageLiveError('validation', '복원할 이전 수업 버전을 확인해 주세요.');
    const userId = await owner();
    const { data, error } = await client.rpc('save_language_live_lesson', {
      p_request_id: input.requestId, p_lesson_id: input.lessonId, p_expected_revision: input.expectedRevision,
      p_operation: operation, p_report: extras.report ?? null, p_restore_revision: extras.restoreRevision ?? null,
      p_allow_duplicate: extras.allowDuplicate ?? false, p_duplicate_reason: duplicateReason,
      p_expected_owner: userId,
    });
    if (error) throw languageLiveStorageError(error);
    await assertOwner(userId);
    const receipt = decodeLesson(data, userId);
    if (receipt.lesson_id !== input.lessonId || receipt.request_id !== input.requestId || receipt.revision !== input.expectedRevision + 1 || receipt.operation !== operation || receipt.restored_from_revision !== (extras.restoreRevision ?? null) || receipt.duplicate_reason !== duplicateReason || (extras.report && stableLiveValue(receipt.report) !== stableLiveValue(extras.report))) {
      throw new LanguageLiveError('verification', '저장 응답이 보낸 내용과 달라요. 원문과 요청을 보존하고 다시 확인해 주세요.');
    }
    const { data: verified, error: verifyError } = await client.from('language_live_lessons').select(COLUMNS)
      .eq('user_id', userId).eq('lesson_id', input.lessonId).eq('revision', receipt.revision).eq('request_id', input.requestId).maybeSingle();
    if (verifyError) throw languageLiveStorageError(verifyError);
    await assertOwner(userId);
    if (!verified || stableLiveValue(decodeLesson(verified, userId)) !== stableLiveValue(receipt)) throw new LanguageLiveError('verification', '저장 후 실제 서버 기록이 일치하지 않아요. 원문과 요청을 보존하고 다시 확인해 주세요.');
    return decodeLesson(verified, userId);
  }
  return {
    async listLessons(options: { includeDeleted?: boolean; limit?: number; offset?: number } = {}): Promise<LiveLesson[]> {
      const userId = await owner();
      const limit = Math.max(1, Math.min(100, Math.floor(options.limit ?? 50)));
      const offset = Math.max(0, Math.floor(options.offset ?? 0));
      if (!Number.isFinite(limit) || !Number.isFinite(offset)) throw new LanguageLiveError('validation', '조회할 범위를 확인해 주세요.');
      let query = client.from('language_live_current_lessons').select(COLUMNS).eq('user_id', userId);
      if (!options.includeDeleted) query = query.neq('operation', 'delete');
      const { data, error } = await query.order('created_at', { ascending: false }).order('lesson_id').range(offset, offset + limit - 1);
      if (error) throw languageLiveStorageError(error);
      await assertOwner(userId);
      if (!Array.isArray(data)) throw new LanguageLiveError('verification', '학습 목록을 확인하지 못했어요. 빈 기록으로 처리하지 않았어요.');
      return data.map(row => decodeLesson(row, userId));
    },
    async getLesson(lessonId: string): Promise<LiveLesson | null> {
      const userId = await owner();
      const lesson = await currentFor(userId, lessonId);
      await assertOwner(userId);
      return lesson;
    },
    async getHistory(lessonId: string): Promise<LiveLesson[]> {
      const userId = await owner();
      const latest = await currentFor(userId, lessonId);
      if (!latest) { await assertOwner(userId); return []; }
      const rows: LiveLesson[] = [];
      for (let offset = 0; offset < latest.revision; offset += 100) {
        const { data, error } = await client.from('language_live_lessons').select(COLUMNS).eq('user_id', userId).eq('lesson_id', lessonId)
          .lte('revision', latest.revision).order('revision', { ascending: true }).range(offset, offset + 99);
        if (error) throw languageLiveStorageError(error);
        await assertOwner(userId);
        if (!Array.isArray(data) || !data.length) throw new LanguageLiveError('verification', '수업 수정 이력을 모두 확인하지 못했어요.');
        rows.push(...data.map(row => decodeLesson(row, userId)));
      }
      if (rows.length !== latest.revision || rows.some((row, index) => row.revision !== index + 1 || row.lesson_id !== lessonId) || stableLiveValue(rows.at(-1)) !== stableLiveValue(latest)) throw new LanguageLiveError('verification', '수업 수정 이력의 버전이 연속하지 않거나 최신 기록과 달라요.');
      return rows.reverse();
    },
    saveLesson: (input: SaveLiveLessonInput) => mutate(input, input.expectedRevision === 0 ? 'create' : 'edit', input),
    deleteLesson: (input: LiveMutationTarget) => mutate(input, 'delete'),
    restoreLesson: (input: RestoreLiveLessonInput) => mutate(input, 'restore', input),
  };
}

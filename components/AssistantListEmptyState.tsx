'use client';

export type AssistantListFilter = 'all' | 'task' | 'project' | 'waiting' | 'memory';

const failureSources: Record<AssistantListFilter, readonly string[]> = {
  all: ['할 일', '프로젝트', '기억'],
  task: ['할 일'],
  project: ['프로젝트'],
  waiting: ['할 일'],
  memory: ['기억'],
};

export default function AssistantListEmptyState({
  filter,
  loadFailures,
  entryFormId,
  onAdd,
  onRetry,
}: {
  filter: AssistantListFilter;
  loadFailures: readonly string[];
  entryFormId: string;
  onAdd: () => void;
  onRetry: () => void;
}) {
  const unavailable = loadFailures.some((failure) =>
    failure === '연결 확인' || failure === '로그인 확인' || failureSources[filter].includes(failure),
  );

  return (
    <div className="py-6 text-center text-sm leading-6 text-gray-600">
      {unavailable ? (
        <>
          <p role="status" className="font-semibold text-amber-800">목록을 불러오지 못했어요.</p>
          <p className="mt-1">항목이 없는지는 아직 알 수 없어요. 다시 불러와 주세요.</p>
          <button type="button" onClick={onRetry} className="mt-3 min-h-11 rounded-xl bg-amber-50 px-4 py-2 font-bold text-amber-800">
            다시 불러오기
          </button>
        </>
      ) : (
        <>
          <p>아직 이 목록에 등록된 항목이 없어요.</p>
          <p className="mt-1">새로 적으려면 아래 버튼을 눌러 주세요.</p>
          <button type="button" aria-controls={entryFormId} onClick={onAdd} className="mt-3 min-h-11 rounded-xl bg-[#F1EFFF] px-4 py-2 font-bold text-[#5146A6]">
            직접 추가하기
          </button>
        </>
      )}
    </div>
  );
}

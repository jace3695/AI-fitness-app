'use client';

import { useMemo, useState } from 'react';
import ReplyCharacterPanel from '@/components/yeoni/ReplyCharacterPanel';
import { buildReplyPlan } from '@/lib/yeoni/reply-plan';
import { REPLY_SAMPLES, savedReplyClips } from '@/lib/yeoni/reply-samples';

export default function DeviceCheck({ audio }: { audio: { ko: string; ja: string } }) {
  const clips = useMemo(() => savedReplyClips(audio), [audio]);
  const [selection, setSelection] = useState<'ko' | 'ja' | null>(null);
  const [incoming, setIncoming] = useState<Readonly<{ value: unknown }> | null>(null);

  function select(language: 'ko' | 'ja') {
    const reply = REPLY_SAMPLES[language].spokenText;
    setSelection(language);
    setIncoming({ value: { reply, performance: buildReplyPlan(reply, crypto.randomUUID()) } });
  }

  return <>
    <h1 className="text-2xl font-bold">연이 음성 · iPhone 확인</h1>
    <p className="my-3 text-sm leading-6">이전에 확인한 한국어·일본어 음성입니다. 언어를 고르고 ‘움직임 켜기’ → ‘답변 듣기’를 눌러 주세요.</p>
    <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="확인할 저장 음성">
      {(['ko', 'ja'] as const).map(language => <button key={language} type="button"
        aria-pressed={selection === language} onClick={() => select(language)}
        className={`min-h-11 rounded-2xl border px-4 py-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600 ${selection === language ? 'border-violet-700 bg-violet-700 text-white' : 'border-violet-200 bg-white text-violet-900'}`}>
        {language === 'ko' ? '한국어 음성 선택' : '일본어 음성 선택'}
      </button>)}
    </div>
    <ReplyCharacterPanel clips={clips} incoming={incoming} />
    <aside className="mt-6 rounded-2xl border border-violet-100 bg-white p-4 text-sm leading-7" aria-label="첫 확인 순서">
      <p className="font-semibold">먼저 이 세 가지만 확인해 주세요</p>
      <ol className="mt-2 list-decimal space-y-1 pl-5">
        <li>한국어와 일본어를 각각 재생하고 입 움직임을 확인해 주세요.</li>
        <li>재생 중 ‘인간형’ 또는 ‘고양이형’을 눌러 음성이 계속 이어지는지 확인해 주세요.</li>
        <li>‘일시정지’를 눌러 입이 닫히는지 보고, 화면을 가로로 돌려 버튼이 잘리지 않는지 확인해 주세요.</li>
      </ol>
      <p className="mt-3 text-slate-600">언어를 다시 선택하면 이전 재생이 멈춥니다. 새 AI 답변이나 음성을 생성하지 않습니다.</p>
    </aside>
  </>;
}

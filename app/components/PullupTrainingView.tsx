'use client';

import { useEffect, useMemo, useState } from 'react';
import { createDefaultPullupProgress, getPullupVideoUrl, PULLUP_PROGRESS_KEY, PULLUP_STAGES, PullupProgress } from '../data/pullupTraining';

const safetyRules = ['통증을 참고 진행하지 않기', '팔 저림, 어깨 통증, 목 통증이 있으면 즉시 중단', '허리가 꺾이거나 반동이 커지면 난이도를 낮추기', '밴드와 철봉 고정 상태를 매번 확인', '문틀 철봉의 허용 하중과 설치 상태를 확인'];

export default function PullupTrainingView() {
  const [progress, setProgress] = useState<PullupProgress>(() => createDefaultPullupProgress());
  const [selectedStage, setSelectedStage] = useState(1);

  useEffect(() => {
    const raw = window.localStorage.getItem(PULLUP_PROGRESS_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as PullupProgress;
        const merged = createDefaultPullupProgress();
        setProgress({ ...merged, ...parsed, stageChecks: { ...merged.stageChecks, ...parsed.stageChecks } });
        setSelectedStage(parsed.currentStage || 1);
      } catch {
        window.localStorage.setItem(PULLUP_PROGRESS_KEY, JSON.stringify(createDefaultPullupProgress()));
      }
    }
  }, []);

  const save = (next: PullupProgress) => {
    setProgress(next);
    window.localStorage.setItem(PULLUP_PROGRESS_KEY, JSON.stringify(next));
  };

  const stage = PULLUP_STAGES.find((item) => item.id === selectedStage) ?? PULLUP_STAGES[0];
  const check = progress.stageChecks[`stage${stage.id}`];
  const totalCount = useMemo(() => Object.values(progress.stageChecks).reduce((sum, item) => sum + (item.completedCount || 0), 0), [progress]);
  const canPromote = check.promotionReady && check.painFree && stage.id < PULLUP_STAGES.length;

  const updateCheck = (key: keyof typeof check, value: boolean | number) => {
    const next = { ...progress, updatedAt: new Date().toISOString().slice(0, 10), stageChecks: { ...progress.stageChecks, [`stage${stage.id}`]: { ...check, [key]: value } } };
    save(next);
  };

  const completeToday = () => {
    const nextCheck = { ...check, todayCompleted: !check.todayCompleted, completedCount: check.todayCompleted ? Math.max(0, check.completedCount - 1) : check.completedCount + 1 };
    save({ ...progress, updatedAt: new Date().toISOString().slice(0, 10), stageChecks: { ...progress.stageChecks, [`stage${stage.id}`]: nextCheck } });
  };

  const moveNext = () => {
    const nextStage = Math.min(PULLUP_STAGES.length, stage.id + 1);
    save({ ...progress, currentStage: nextStage, updatedAt: new Date().toISOString().slice(0, 10) });
    setSelectedStage(nextStage);
  };

  return <div className="space-y-4">
    <div className="rounded-2xl bg-[#111827] p-4 text-white">
      <div className="flex items-start justify-between gap-3"><div><p className="text-[12px] text-white/60">철봉 단계별 훈련 모드</p><h2 className="text-xl font-bold">무리 없이 1회 턱걸이까지</h2><p className="mt-1 text-[13px] text-white/70">월요일·토요일은 루틴 연결, 다른 날은 선택 훈련으로 진행하세요.</p></div><span className="rounded-full bg-white/15 px-3 py-1 text-[12px] font-bold">누적 {totalCount}회</span></div>
      <div className="mt-3 grid gap-1 text-[12px] text-red-100">{safetyRules.map((rule) => <p key={rule}>⚠️ {rule}</p>)}</div>
    </div>

    <div className="grid grid-cols-5 gap-1.5">{PULLUP_STAGES.map((item) => {
      const locked = item.id > progress.currentStage;
      const ready = progress.stageChecks[`stage${item.id}`]?.promotionReady;
      return <button key={item.id} onClick={() => setSelectedStage(item.id)} className={`rounded-xl border p-2 text-left transition ${selectedStage === item.id ? 'border-[#534AB7] bg-[#EEEDFE] text-[#3C3489]' : locked ? 'border-gray-100 bg-gray-50 text-gray-400 opacity-70' : 'border-gray-200 bg-white text-gray-700'}`}>
        <p className="text-[11px] font-bold">{item.id}단계</p><p className="mt-1 text-[10px] leading-tight">{item.title}</p>{item.id === progress.currentStage && <p className="mt-1 text-[9px] font-bold text-[#534AB7]">현재</p>}{ready && <p className="mt-1 text-[9px] font-bold text-green-600">진행 가능</p>}
      </button>;
    })}</div>

    <section className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3"><div><p className="text-[12px] font-bold text-[#534AB7]">{stage.id}단계</p><h3 className="text-lg font-bold text-gray-900">{stage.title}</h3><p className="mt-1 text-[13px] text-gray-500">{stage.prescription} · {stage.rest}</p></div>{canPromote && <span className="rounded-full bg-green-50 px-3 py-1 text-[11px] font-bold text-green-700">다음 단계 진행 가능</span>}</div>
      <div className="mt-3 rounded-xl bg-[#EEEDFE] p-3 text-[13px] font-semibold text-[#3C3489]">1) 핵심 한 줄: {stage.keyPoint}</div>
      <Guide title="목표" items={stage.goal} /><Guide title="2) 시작 자세" items={stage.setup} /><Guide title="3) 움직이는 순서" items={stage.movement} />
      <div className="mt-2 grid gap-2 sm:grid-cols-2"><Info title="4) 호흡" text={stage.breathing} color="blue" /><Info title="5) 자극 부위" text={stage.target} color="green" /></div>
      <Guide title="6) 자주 하는 실수" items={stage.commonMistakes} tone="warn" /><Guide title="7) 즉시 중단 기준" items={stage.stopCriteria} tone="stop" />
      <a href={getPullupVideoUrl(stage.videoQuery)} target="_blank" rel="noreferrer" className="mt-3 block rounded-xl bg-[#111827] px-3 py-2 text-center text-[13px] font-bold text-white">8) 영상 보기</a>

      <div className="mt-4 rounded-2xl bg-gray-50 p-3"><p className="mb-2 text-[13px] font-bold text-gray-800">오늘 체크</p><Check label="오늘 훈련 완료" checked={check.todayCompleted} onChange={completeToday} /><Check label="목표 세트 완료" checked={check.targetSetsCompleted} onChange={() => updateCheck('targetSetsCompleted', !check.targetSetsCompleted)} /><Check label="통증 없이 완료" checked={check.painFree} onChange={() => updateCheck('painFree', !check.painFree)} /><Check label="다음 단계 조건 충족" checked={check.promotionReady} onChange={() => updateCheck('promotionReady', !check.promotionReady)} />
      <div className="mt-3 rounded-xl bg-white p-3"><p className="text-[12px] font-bold text-gray-700">다음 단계 조건</p>{stage.nextCondition.map((condition) => <p key={condition} className="mt-1 text-[12px] text-gray-500">• {condition}</p>)}{canPromote && <button onClick={moveNext} className="mt-3 w-full rounded-xl bg-[#534AB7] py-2 text-[13px] font-bold text-white">사용자가 직접 다음 단계로 이동</button>}</div></div>
    </section>
  </div>;
}

function Guide({ title, items, tone = 'plain' }: { title: string; items: string[]; tone?: 'plain' | 'warn' | 'stop' }) {
  const cls = tone === 'warn' ? 'bg-[#FAEEDA] text-[#633806] border-[#EF9F27]' : tone === 'stop' ? 'bg-[#FCEBEB] text-[#791F1F] border-[#E24B4A]' : 'bg-gray-50 text-gray-600 border-gray-100';
  return <div className={`mt-2 rounded-xl border p-3 ${cls}`}><p className="text-[12px] font-bold">{title}</p>{items.map((item) => <p key={item} className="mt-1 text-[12px] leading-relaxed">• {item}</p>)}</div>;
}
function Info({ title, text, color }: { title: string; text: string; color: 'blue' | 'green' }) { return <div className={`rounded-xl p-3 text-[12px] ${color === 'blue' ? 'bg-[#E6F1FB] text-[#0C447C]' : 'bg-[#EAF3DE] text-[#27500A]'}`}><b>{title}</b><p className="mt-1">{text}</p></div>; }
function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) { return <label className="mb-1 flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-[13px] text-gray-700"><input type="checkbox" checked={checked} onChange={onChange} className="h-4 w-4 accent-[#534AB7]" />{label}</label>; }

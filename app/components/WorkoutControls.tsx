'use client';

import { useEffect, useMemo, useState } from 'react';
import { AB_SLIDE_KEY, Exercise, IntervalPlan, SET_COMPLETION_KEY } from '../data/workouts';

function useJsonState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => { try { const raw = localStorage.getItem(key); if (raw) setValue(JSON.parse(raw)); } catch { localStorage.removeItem(key); } }, [key]);
  const save = (next: T) => { setValue(next); localStorage.setItem(key, JSON.stringify(next)); };
  return [value, save] as const;
}

export function SetChecklist({ storageId, sets = 0, restSeconds = 45 }: { storageId: string; sets?: number; restSeconds?: number }) {
  const [checked, save] = useJsonState<Record<string, boolean>>(SET_COMPLETION_KEY, {});
  const [left, setLeft] = useState(0);
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (left <= 0) return;
    const id = window.setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearInterval(id);
  }, [left]);
  useEffect(() => { if (left === 0 && done) return; if (left === 0) setDone(true); }, [left, done]);
  if (!sets) return null;
  return <div className="mt-3 rounded-lg bg-gray-50 p-2" onClick={(e) => e.stopPropagation()}>
    <div className="flex flex-wrap gap-2 mb-2">{Array.from({ length: sets }, (_, i) => {
      const id = `${storageId}-${i + 1}`;
      return <label key={id} className="flex items-center gap-1 text-[12px] text-gray-600 bg-white border border-gray-200 rounded-full px-2 py-1">
        <input type="checkbox" checked={!!checked[id]} onChange={() => save({ ...checked, [id]: !checked[id] })} /> {i + 1}세트
      </label>;
    })}</div>
    <button className="text-[12px] rounded-lg bg-[#EEEDFE] text-[#3C3489] px-3 py-1.5" onClick={() => { setLeft(restSeconds); setDone(false); }}>휴식 시작 {restSeconds}초</button>
    {left > 0 && <span className="ml-2 text-[13px] font-semibold text-[#534AB7]">남은 휴식 {left}초</span>}
    {left === 0 && done && <span className="ml-2 text-[12px] text-green-600">휴식 종료!</span>}
  </div>;
}

export function IntervalTimer({ plan }: { plan: IntervalPlan }) {
  const sequence = useMemo(() => plan.rounds ? Array.from({ length: plan.rounds }).flatMap(() => plan.segments) : plan.segments, [plan]);
  const [idx, setIdx] = useState(0); const [left, setLeft] = useState(sequence[0]?.seconds ?? 0); const [running, setRunning] = useState(false); const [finished, setFinished] = useState(false);
  useEffect(() => { setIdx(0); setLeft(sequence[0]?.seconds ?? 0); setRunning(false); setFinished(false); }, [sequence]);
  useEffect(() => {
    if (!running || finished) return;
    const id = window.setInterval(() => setLeft((s) => {
      if (s > 1) return s - 1;
      if (idx < sequence.length - 1) { setIdx((n) => n + 1); return sequence[idx + 1].seconds; }
      setRunning(false); setFinished(true); return 0;
    }), 1000);
    return () => window.clearInterval(id);
  }, [running, idx, sequence, finished]);
  const cur = sequence[idx]; if (!cur) return null;
  return <div className="mt-3 rounded-xl bg-[#FAEEDA] p-3" onClick={(e) => e.stopPropagation()}>
    <p className="text-[12px] text-[#633806]">라운드/구간 {idx + 1} / {sequence.length}</p>
    <p className="text-[18px] font-semibold text-[#854F0B]">{cur.label} · {cur.intensity} · {left}초</p>
    {finished && <p className="text-[12px] font-medium text-green-700">인터벌 완료!</p>}
    <div className="flex gap-2 mt-2"><button className="px-3 py-1.5 rounded-lg bg-[#854F0B] text-white text-[12px]" onClick={() => setRunning((v) => !v)}>{running ? '일시정지' : '시작'}</button><button className="px-3 py-1.5 rounded-lg bg-white text-[#854F0B] text-[12px]" onClick={() => { setIdx(0); setLeft(sequence[0].seconds); setRunning(false); setFinished(false); }}>초기화</button></div>
  </div>;
}

export function AbSlideGate({ storageId }: { storageId: string }) {
  const labels = ['최근 2주간 허리 통증 또는 다리 저림 없음','플랭크 20초 이상을 허리 불편 없이 가능','힙 브릿지와 버드독에서 허리 꺾임 없음','무릎을 대고 짧은 거리로 5~8회 가능'];
  const [state, save] = useJsonState<Record<string, boolean>>(AB_SLIDE_KEY, {});
  const all = labels.every((_, i) => state[`${storageId}-${i}`]);
  return <div className="mt-3 rounded-xl border border-red-100 bg-[#FCEBEB] p-3" onClick={(e) => e.stopPropagation()}>
    <p className="text-[13px] font-semibold text-[#791F1F] mb-2">AB 슬라이드 진행 조건 확인</p>
    {labels.map((l, i) => <label key={l} className="flex gap-2 text-[12px] text-[#791F1F] my-1"><input type="checkbox" checked={!!state[`${storageId}-${i}`]} onChange={() => save({ ...state, [`${storageId}-${i}`]: !state[`${storageId}-${i}`] })}/>{l}</label>)}
    <label className={`mt-2 flex gap-2 text-[13px] font-medium ${all ? 'text-[#3B6D11]' : 'text-gray-400'}`}><input type="checkbox" disabled={!all}/> 버드독 대신 AB 슬라이드 진행</label>
    <p className="mt-2 text-[12px] font-semibold text-[#A32D2D]">허리가 꺼지거나 통증이 나면 즉시 중단하고 버드독으로 복귀하세요.</p>
  </div>;
}

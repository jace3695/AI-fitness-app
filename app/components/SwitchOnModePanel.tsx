'use client';

import { SwitchOnSelection, SWITCHON_DEFAULT_START_DATE } from '../data/workouts';

export type SwitchOnMode = 'auto' | SwitchOnSelection;

export default function SwitchOnModePanel({ startDate, mode, selection, onStartDateChange, onModeChange }: { startDate: string; mode: SwitchOnMode; selection: SwitchOnSelection; onStartDateChange: (v: string) => void; onModeChange: (v: SwitchOnMode) => void }) {
  const labels: Record<SwitchOnSelection, string> = { adapt1: '적응 1일차', adapt2: '적응 2일차', adapt3: '적응 3일차', base: '기본 루틴' };
  return <section className="mb-4 rounded-2xl bg-white border border-gray-100 p-3 shadow-sm">
    <div className="flex items-center justify-between gap-3 mb-3"><div><p className="text-[14px] font-semibold text-gray-800">스위치온 다이어트 모드</p><p className="text-[12px] text-gray-400">현재 적용: {labels[selection]}</p></div><input type="date" value={startDate || SWITCHON_DEFAULT_START_DATE} onChange={(e) => onStartDateChange(e.target.value)} className="text-[12px] border rounded-lg px-2 py-1.5" /></div>
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">{([{id:'auto',label:'자동 모드'},{id:'adapt1',label:'적응 1일차'},{id:'adapt2',label:'적응 2일차'},{id:'adapt3',label:'적응 3일차'},{id:'base',label:'기본 루틴'}] as {id:SwitchOnMode;label:string}[]).map((o) => <button key={o.id} onClick={() => onModeChange(o.id)} className={`rounded-xl px-2 py-2 text-[12px] font-medium border ${mode === o.id ? 'bg-[#EEEDFE] text-[#3C3489] border-[#AFA9EC]' : 'bg-gray-50 text-gray-500 border-gray-100'}`}>{o.label}</button>)}</div>
    <p className="mt-2 text-[11px] text-gray-400">자동 모드: 시작일 당일 1일차, 다음 날 2일차, 그다음 날 3일차, 4일차부터 기본 루틴입니다. 초기 시작일은 {SWITCHON_DEFAULT_START_DATE}입니다.</p>
  </section>;
}

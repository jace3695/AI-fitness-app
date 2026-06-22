'use client';

import { useEffect, useMemo, useState } from 'react';
import { DIET_GOAL_CHECK_ITEMS, formatDinnerCarbRecord, getLocalDateKey } from '../data/dietPlans';
import { DAILY_NOTES_KEY, DailyNotesStore, RecordStores, getDietGoalCount, hasSafetyAlert, isDietSuccess, readRecordStores, writeJson } from '../data/recordStorage';
import WeightRecordCard from './WeightRecordCard';
import InbodyRecordCard from './InbodyRecordCard';
import MonthlySummaryCard from './MonthlySummaryCard';
import WeightChart from './WeightChart';

const weekDays = ['일', '월', '화', '수', '목', '금', '토'];
function parseKey(key: string) { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); }
function formatKoreanDate(key: string) { const d = parseKey(key); return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`; }
function getCalendarCells(year: number, monthIndex: number) {
  const first = new Date(year, monthIndex, 1).getDay(); const lastDate = new Date(year, monthIndex + 1, 0).getDate();
  return [...Array.from({ length: first }, () => null), ...Array.from({ length: lastDate }, (_, idx) => getLocalDateKey(new Date(year, monthIndex, idx + 1)))];
}

export default function RecordCalendarView() {
  const todayKey = getLocalDateKey();
  const today = parseKey(todayKey);
  const [visible, setVisible] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selected, setSelected] = useState(todayKey);
  const [stores, setStores] = useState<RecordStores | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  useEffect(() => setStores(readRecordStores()), []);
  useEffect(() => setNoteDraft(stores?.notes[selected] || ''), [stores?.notes, selected]);
  const cells = useMemo(() => getCalendarCells(visible.getFullYear(), visible.getMonth()), [visible]);
  if (!stores) return <div className="rounded-2xl bg-white p-4 text-[13px] text-gray-500">기록을 불러오는 중...</div>;
  const moveMonth = (delta: number) => setVisible(new Date(visible.getFullYear(), visible.getMonth() + delta, 1));
  const saveNote = () => { const next: DailyNotesStore = { ...stores.notes }; if (noteDraft.trim()) next[selected] = noteDraft.trim(); else delete next[selected]; writeJson(DAILY_NOTES_KEY, next); setStores({ ...stores, notes: next }); };
  const selectedDiet = stores.diet[selected]; const selectedWater = stores.water[selected] || 0; const selectedDinner = stores.dinner[selected]; const selectedDinnerCarb = formatDinnerCarbRecord(stores.dinnerCarbs[selected]);
  const anyRecord = Boolean(stores.workouts[selected] || selectedDiet || selectedWater || selectedDinner || stores.weights[selected] || stores.inbody[selected] || stores.notes[selected] || stores.dinnerCarbs[selected]);
  return <div className="space-y-4">
    <section className="rounded-2xl bg-white border border-gray-100 p-4 shadow-sm">
      <div className="flex items-center justify-between"><button onClick={() => moveMonth(-1)} className="rounded-xl bg-gray-50 px-3 py-2 text-[13px] font-bold text-gray-600">이전</button><h2 className="text-[18px] font-bold text-gray-900">{visible.getFullYear()}년 {visible.getMonth() + 1}월</h2><button onClick={() => moveMonth(1)} className="rounded-xl bg-gray-50 px-3 py-2 text-[13px] font-bold text-gray-600">다음</button></div>
      <div className="mt-4 grid grid-cols-7 gap-1 text-center">{weekDays.map((day) => <div key={day} className="py-1 text-[11px] font-bold text-gray-400">{day}</div>)}{cells.map((key, idx) => {
        if (!key) return <div key={`blank-${idx}`} />;
        const isToday = key === todayKey; const isSelected = key === selected; const dietSuccess = isDietSuccess(stores.diet[key]);
        const badges = [stores.workouts[key] ? '운' : '', dietSuccess ? '식' : '', (stores.water[key] || 0) >= 2000 ? '💧' : '', stores.weights[key] ? 'W' : '', stores.inbody[key] ? 'I' : '', stores.notes[key] ? '✎' : '', hasSafetyAlert(stores.diet[key]) ? '⚠' : ''].filter(Boolean);
        return <button key={key} onClick={() => setSelected(key)} className={`min-h-[62px] rounded-xl border p-1 text-left transition ${isSelected ? 'border-[#534AB7] bg-[#EEEDFE]' : isToday ? 'border-[#AFA9EC] bg-white' : 'border-gray-100 bg-gray-50'}`}><span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-bold ${isToday ? 'bg-[#534AB7] text-white' : 'text-gray-700'}`}>{Number(key.slice(8))}</span><div className="mt-1 flex flex-wrap gap-0.5">{badges.map((badge, i) => <span key={`${badge}-${i}`} className="rounded-full bg-white px-1 text-[9px] font-bold text-gray-600 shadow-sm">{badge}</span>)}</div></button>;
      })}</div>
      <p className="mt-3 text-[11px] text-gray-400">운=운동, 식=식단 목표 달성, 💧=물 2L, W=체중, I=인바디, ✎=메모, ⚠=안전 증상</p>
    </section>
    <MonthlySummaryCard year={visible.getFullYear()} monthIndex={visible.getMonth()} stores={stores} />
    <section className="rounded-2xl bg-white border border-gray-100 p-4 shadow-sm"><p className="text-[12px] font-semibold text-[#534AB7]">선택 날짜 상세</p><h3 className="mt-1 text-[18px] font-bold text-gray-900">{formatKoreanDate(selected)}</h3>{!anyRecord && <p className="mt-3 rounded-xl bg-gray-50 px-3 py-2 text-[13px] text-gray-500">기록이 없습니다.</p>}<div className="mt-3 grid grid-cols-2 gap-2 text-[12px] text-gray-700"><div className="rounded-xl bg-gray-50 p-3">운동<br /><b>{stores.workouts[selected] ? '완료' : '미완료'}</b></div><div className="rounded-xl bg-gray-50 p-3">식단 목표<br /><b>{getDietGoalCount(selectedDiet)} / {DIET_GOAL_CHECK_ITEMS.length}개 완료</b></div><div className="rounded-xl bg-gray-50 p-3">물 섭취<br /><b>{selectedWater.toLocaleString()}mL</b></div><div className="rounded-xl bg-gray-50 p-3">저녁 18:30 이전<br /><b>{selectedDiet?.dinnerBefore1830 ? '완료' : selectedDinner ? `미달성(${selectedDinner})` : '미기록'}</b></div><div className="rounded-xl bg-gray-50 p-3">공복<br /><b>{selected === todayKey ? (stores.fastingStart ? `시작 ${stores.fastingStart} / 예상 종료 ${String((Number(stores.fastingStart.slice(0,2)) + 14) % 24).padStart(2,'0')}${stores.fastingStart.slice(2)}` : '미설정') : '개별 공복 기록 없음'}</b></div><div className="rounded-xl bg-gray-50 p-3">안전 증상<br /><b>{hasSafetyAlert(selectedDiet) ? '기록 있음' : '없음'}</b></div><div className="rounded-xl bg-gray-50 p-3">체중<br /><b>{stores.weights[selected]?.weight ? `${stores.weights[selected].weight.toFixed(1)}kg` : '미기록'}</b></div><div className="rounded-xl bg-gray-50 p-3">인바디<br /><b>{stores.inbody[selected] ? '기록 있음' : '미기록'}</b></div><div className="rounded-xl bg-gray-50 p-3 col-span-2"><span>{selectedDinnerCarb.rice}</span>{selectedDinnerCarb.carbs && <><br /><b>{selectedDinnerCarb.carbs}</b></>}<p className="mt-1 text-[11px] text-gray-500">밥량은 조리된 밥 무게이며, 참고 탄수화물과 구분됩니다.</p></div></div></section>
    <WeightRecordCard dateKey={selected} weights={stores.weights} onChange={(weights) => setStores({ ...stores, weights })} />
    <InbodyRecordCard dateKey={selected} records={stores.inbody} onChange={(inbody) => setStores({ ...stores, inbody })} />
    <section className="rounded-2xl bg-white border border-gray-100 p-4 shadow-sm"><p className="text-[15px] font-bold text-gray-800">날짜별 메모</p><textarea value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} placeholder="오늘 컨디션, 허기, 운동 느낌 등을 적어주세요." className="mt-3 min-h-24 w-full rounded-xl border border-gray-200 px-3 py-2 text-[13px]" /><div className="mt-2 flex gap-2"><button onClick={saveNote} className="flex-1 rounded-xl bg-[#534AB7] px-4 py-2 text-[13px] font-bold text-white">저장</button><button onClick={() => { setNoteDraft(''); const next = { ...stores.notes }; delete next[selected]; writeJson(DAILY_NOTES_KEY, next); setStores({ ...stores, notes: next }); }} className="rounded-xl bg-red-50 px-4 py-2 text-[13px] font-bold text-red-600">삭제</button></div></section>
    <WeightChart weights={stores.weights} year={visible.getFullYear()} monthIndex={visible.getMonth()} />
  </div>;
}

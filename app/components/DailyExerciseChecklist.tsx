"use client";

import { useState } from "react";
import { ExerciseRecord } from "../data/workoutCompletion";

function initialRecords(names: string[], saved: ExerciseRecord[]) {
  const savedByName = new Map(saved.map((record) => [record.exerciseName, record]));
  return [
    ...names.map((name): ExerciseRecord =>
      savedByName.get(name) || { exerciseName: name, status: "pending" }),
    ...saved.filter((record) => !names.includes(record.exerciseName)),
  ];
}

export default function DailyExerciseChecklist({ exerciseNames, savedRecords = [], onChange }: {
  exerciseNames: string[];
  savedRecords?: ExerciseRecord[];
  onChange: (records: ExerciseRecord[]) => void;
}) {
  const [records, setRecords] = useState<ExerciseRecord[]>(() => initialRecords(exerciseNames, savedRecords));
  const [newExercise, setNewExercise] = useState("");

  const update = (next: ExerciseRecord[]) => { setRecords(next); onChange(next); };
  const setStatus = (index: number, status: ExerciseRecord["status"]) => update(records.map((record, recordIndex) => recordIndex === index ? { ...record, status } : record));
  const setAllStatuses = (status: ExerciseRecord["status"]) => update(records.map((record) => ({ ...record, status })));
  const addExercise = () => {
    const name = newExercise.trim();
    if (!name || records.some((record) => record.exerciseName === name)) return;
    update([...records, { exerciseName: name, status: "pending" }]);
    setNewExercise("");
  };
  const completed = records.filter((record) => record.status === "completed").length;
  const skipped = records.filter((record) => record.status === "skipped").length;

  return <section className="mb-4 rounded-2xl border border-[#D9D6FF] bg-white p-4 shadow-sm">
    <p className="text-[12px] font-bold text-[#534AB7]">요일별 운동 체크</p>
    <h3 className="mt-1 text-lg font-bold text-gray-900">실제로 한 운동만 체크하세요</h3>
    <p className="mt-2 text-[12px] leading-relaxed text-gray-500">컨디션에 따라 오늘만 운동을 빼거나 추가할 수 있습니다. 주간 기본 계획은 변경되지 않습니다.</p>
    <div className="mt-3 grid grid-cols-3 gap-2">
      <button type="button" onClick={() => setAllStatuses("completed")} className="rounded-xl bg-emerald-600 px-2 py-2 text-[11px] font-bold text-white">모두 완료</button>
      <button type="button" onClick={() => setAllStatuses("skipped")} className="rounded-xl bg-gray-600 px-2 py-2 text-[11px] font-bold text-white">모두 안 함</button>
      <button type="button" onClick={() => setAllStatuses("pending")} className="rounded-xl bg-white px-2 py-2 text-[11px] font-bold text-gray-600 ring-1 ring-inset ring-gray-200">전체 해제</button>
    </div>
    <div className="mt-4 space-y-2">{records.map((record, index) => <div key={`${record.exerciseName}-${index}`} className={`rounded-xl border p-3 ${record.status === "completed" ? "border-emerald-200 bg-emerald-50" : record.status === "skipped" ? "border-gray-200 bg-gray-50" : "border-gray-100 bg-white"}`}>
      <p className={`text-[13px] font-bold ${record.status === "skipped" ? "text-gray-400 line-through" : "text-gray-800"}`}>{index + 1}. {record.exerciseName}</p>
      <div className={`mt-2 grid gap-2 ${exerciseNames.includes(record.exerciseName) ? "grid-cols-3" : "grid-cols-4"}`}>
        <button type="button" aria-pressed={record.status === "completed"} onClick={() => setStatus(index, "completed")} className={`rounded-lg px-2 py-2 text-[11px] font-bold ${record.status === "completed" ? "bg-emerald-600 text-white" : "bg-emerald-50 text-emerald-700"}`}>완료</button>
        <button type="button" aria-pressed={record.status === "skipped"} onClick={() => setStatus(index, "skipped")} className={`rounded-lg px-2 py-2 text-[11px] font-bold ${record.status === "skipped" ? "bg-gray-600 text-white" : "bg-gray-100 text-gray-600"}`}>안 함</button>
        <button type="button" onClick={() => setStatus(index, "pending")} className="rounded-lg bg-white px-2 py-2 text-[11px] font-bold text-gray-500 ring-1 ring-inset ring-gray-200">선택 해제</button>
        {!exerciseNames.includes(record.exerciseName) && <button type="button" onClick={() => update(records.filter((_, recordIndex) => recordIndex !== index))} className="rounded-lg bg-red-50 px-2 py-2 text-[11px] font-bold text-red-600">삭제</button>}
      </div>
    </div>)}</div>
    <div className="mt-3 flex gap-2">
      <input aria-label="오늘 추가할 운동" value={newExercise} onChange={(event) => setNewExercise(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addExercise(); } }} placeholder="오늘만 추가할 운동" className="min-w-0 flex-1 rounded-xl border border-gray-200 px-3 py-2 text-[13px]" />
      <button type="button" onClick={addExercise} className="rounded-xl bg-[#534AB7] px-4 py-2 text-[12px] font-bold text-white">추가</button>
    </div>
    <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-bold">
      <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-emerald-700">완료 {completed}개</span>
      <span className="rounded-full bg-gray-100 px-3 py-1.5 text-gray-600">안 함 {skipped}개</span>
      <span className="rounded-full bg-[#EEEDFE] px-3 py-1.5 text-[#534AB7]">미선택 {records.length - completed - skipped}개</span>
    </div>
  </section>;
}

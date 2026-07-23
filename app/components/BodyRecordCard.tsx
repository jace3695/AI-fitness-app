"use client";

import { useEffect, useState } from "react";
import {
  INBODY_RECORDS_KEY,
  InbodyRecord,
  InbodyRecordStore,
  WEIGHT_RECORDS_KEY,
  WeightRecordStore,
  getPreviousWeightRecord,
  isTodayKey,
  writeJson,
} from "../data/recordStorage";

const inbodyFields: {
  key: Exclude<keyof InbodyRecord, "weight" | "memo">;
  label: string;
  unit: string;
}[] = [
  { key: "skeletalMuscleMass", label: "골격근량", unit: "kg" },
  { key: "bodyFatMass", label: "체지방량", unit: "kg" },
  { key: "bodyFatPercent", label: "체지방률", unit: "%" },
  { key: "visceralFatLevel", label: "내장지방레벨", unit: "" },
  { key: "basalMetabolicRate", label: "기초대사량", unit: "kcal" },
];

interface Props {
  dateKey: string;
  weights: WeightRecordStore;
  inbody: InbodyRecordStore;
  onChange: (next: {
    weights: WeightRecordStore;
    inbody: InbodyRecordStore;
  }) => void;
}

export default function BodyRecordCard({
  dateKey,
  weights,
  inbody,
  onChange,
}: Props) {
  const currentWeight = weights[dateKey];
  const currentInbody = inbody[dateKey];
  const [form, setForm] = useState<Record<string, string>>({});

  useEffect(() => {
    const next: Record<string, string> = {
      weight:
        currentWeight?.weight?.toString() ??
        currentInbody?.weight?.toString() ??
        "",
      memo: currentInbody?.memo ?? "",
    };
    inbodyFields.forEach(({ key }) => {
      const value = currentInbody?.[key];
      next[key] = typeof value === "number" ? String(value) : "";
    });
    setForm(next);
  }, [currentInbody, currentWeight, dateKey]);

  const previous = getPreviousWeightRecord(weights, dateKey);
  const displayedWeight = Number(form.weight);
  const diff =
    Number.isFinite(displayedWeight) && previous
      ? displayedWeight - previous[1].weight
      : null;

  const save = () => {
    const parsedWeight = Math.round(Number(form.weight) * 10) / 10;
    const nextWeights = { ...weights };
    if (Number.isFinite(parsedWeight) && parsedWeight > 0)
      nextWeights[dateKey] = {
        weight: parsedWeight,
        recordedAt: new Date().toISOString(),
      };
    else delete nextWeights[dateKey];

    const record: InbodyRecord = {};
    inbodyFields.forEach(({ key }) => {
      const value = Number(form[key]);
      if (form[key] !== "" && Number.isFinite(value))
        record[key] = value as never;
    });
    if (form.memo?.trim()) record.memo = form.memo.trim();
    const nextInbody = { ...inbody };
    if (Object.keys(record).length) nextInbody[dateKey] = record;
    else delete nextInbody[dateKey];

    writeJson(WEIGHT_RECORDS_KEY, nextWeights);
    writeJson(INBODY_RECORDS_KEY, nextInbody);
    onChange({ weights: nextWeights, inbody: nextInbody });
  };

  const remove = () => {
    const nextWeights = { ...weights };
    const nextInbody = { ...inbody };
    delete nextWeights[dateKey];
    delete nextInbody[dateKey];
    writeJson(WEIGHT_RECORDS_KEY, nextWeights);
    writeJson(INBODY_RECORDS_KEY, nextInbody);
    onChange({ weights: nextWeights, inbody: nextInbody });
    setForm({});
  };

  const hasRecord = Boolean(currentWeight || currentInbody);
  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[15px] font-bold text-gray-800">
            체중·인바디 기록
          </p>
          <p className="mt-1 text-[12px] text-gray-500">
            같은 날짜의 체중과 인바디 결과를 한 번에 기록합니다.
          </p>
        </div>
        <span className="rounded-full bg-[#EEEDFE] px-2 py-1 text-[11px] font-bold text-[#534AB7]">
          통합 기록
        </span>
      </div>
      {isTodayKey(dateKey) && (
        <p className="mt-3 rounded-xl bg-blue-50 px-3 py-2 text-[12px] text-blue-700">
          체중은 아침 공복, 인바디는 주 1회 또는 2주 1회 같은 조건 측정을
          권장합니다.
        </p>
      )}
      <label className="mt-3 block text-[12px] font-semibold text-gray-600">
        체중
        <div className="mt-1 flex items-center rounded-xl border border-gray-200 px-3">
          <input
            inputMode="decimal"
            value={form.weight || ""}
            onChange={(event) =>
              setForm({ ...form, weight: event.target.value })
            }
            placeholder="예: 82.4"
            className="min-w-0 flex-1 py-2 text-[14px] outline-none"
          />
          <span className="text-[11px] text-gray-400">kg</span>
        </div>
      </label>
      {Number.isFinite(displayedWeight) && displayedWeight > 0 && (
        <p className="mt-2 text-[12px] text-gray-600">
          이전 기록 대비:{" "}
          <b>
            {diff === null
              ? "이전 기록 없음"
              : `${diff > 0 ? "+" : ""}${diff.toFixed(1)}kg`}
          </b>
        </p>
      )}
      <div className="mt-3 grid grid-cols-2 gap-2">
        {inbodyFields.map((field) => (
          <label
            key={field.key}
            className="text-[12px] font-semibold text-gray-600"
          >
            {field.label}
            <div className="mt-1 flex items-center gap-1 rounded-xl border border-gray-200 px-2">
              <input
                inputMode="decimal"
                value={form[field.key] || ""}
                onChange={(event) =>
                  setForm({ ...form, [field.key]: event.target.value })
                }
                className="min-w-0 flex-1 py-2 text-[13px] outline-none"
              />
              <span className="text-[11px] text-gray-400">{field.unit}</span>
            </div>
          </label>
        ))}
      </div>
      <textarea
        value={form.memo || ""}
        onChange={(event) => setForm({ ...form, memo: event.target.value })}
        placeholder="체중·인바디 메모"
        className="mt-3 min-h-20 w-full rounded-xl border border-gray-200 px-3 py-2 text-[13px]"
      />
      <div className="mt-2 flex gap-2">
        <button
          onClick={save}
          className="flex-1 rounded-xl bg-[#534AB7] px-4 py-2 text-[13px] font-bold text-white"
        >
          통합 저장
        </button>
        {hasRecord && (
          <button
            onClick={remove}
            className="rounded-xl bg-red-50 px-4 py-2 text-[13px] font-bold text-red-600"
          >
            전체 삭제
          </button>
        )}
      </div>
    </section>
  );
}

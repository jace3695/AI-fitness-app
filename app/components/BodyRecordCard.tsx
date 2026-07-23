"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";
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
import { parseOaReport } from "../lib/oaReportParser";

type InbodyField = {
  key: Exclude<keyof InbodyRecord, "weight" | "memo">;
  label: string;
  unit: string;
};

const fieldGroups: { title: string; description: string; fields: InbodyField[] }[] = [
  {
    title: "핵심 변화",
    description: "감량과 근육 유지 상태를 우선 확인하는 지표",
    fields: [
      { key: "bmi", label: "BMI", unit: "" },
      { key: "bodyFatPercent", label: "체지방률", unit: "%" },
      { key: "fatMass", label: "지방량", unit: "kg" },
      { key: "skeletalMuscleMass", label: "신체 근육량", unit: "kg" },
      { key: "muscleMass", label: "근육량", unit: "kg" },
      { key: "musclePercent", label: "근육률", unit: "%" },
      { key: "visceralFatLevel", label: "내장 지방 지수", unit: "" },
    ],
  },
  {
    title: "체성분 상세",
    description: "지방·수분·단백질과 제지방 구성",
    fields: [
      { key: "bodyFatMass", label: "체지방량", unit: "kg" },
      { key: "subcutaneousFatMass", label: "피하지방량", unit: "kg" },
      { key: "subcutaneousFatPercent", label: "피하지방률", unit: "%" },
      { key: "fatFreeMass", label: "무지방 체중", unit: "kg" },
      { key: "bodyWaterPercent", label: "수분", unit: "%" },
      { key: "proteinPercent", label: "단백질 비율", unit: "%" },
      { key: "boneMass", label: "골량", unit: "kg" },
    ],
  },
  {
    title: "대사·종합 지표",
    description: "기초대사와 기기에서 산출한 종합 결과",
    fields: [
      { key: "basalMetabolicRate", label: "기초대사량", unit: "kcal" },
      { key: "bodyAge", label: "신체연령", unit: "세" },
      { key: "bodyScore", label: "점수", unit: "점" },
    ],
  },
  {
    title: "부위별 지방량",
    description: "좌우 팔·다리의 지방 분포",
    fields: [
      { key: "leftArmFatMass", label: "왼팔 지방량", unit: "kg" },
      { key: "rightArmFatMass", label: "오른팔 지방량", unit: "kg" },
      { key: "leftLegFatMass", label: "왼쪽 다리 지방량", unit: "kg" },
      { key: "rightLegFatMass", label: "오른쪽 다리 지방량", unit: "kg" },
    ],
  },
  {
    title: "부위별 근육량",
    description: "좌우 팔·다리의 근육 균형",
    fields: [
      { key: "leftArmMuscleMass", label: "왼팔 근육량", unit: "kg" },
      { key: "rightArmMuscleMass", label: "오른팔 근육량", unit: "kg" },
      { key: "leftLegMuscleMass", label: "왼쪽 다리 근육량", unit: "kg" },
      { key: "rightLegMuscleMass", label: "오른쪽 다리 근육량", unit: "kg" },
    ],
  },
];

const inbodyFields = fieldGroups.flatMap((group) => group.fields);

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
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importMessage, setImportMessage] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const importOaReport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setImportMessage("이미지 파일을 선택해주세요.");
      return;
    }

    setImporting(true);
    setImportProgress(0);
    setImportMessage("오아 보고서 숫자를 읽고 있습니다.");
    try {
      const result = await parseOaReport(file, setImportProgress);
      if (!result.recognizedCount)
        throw new Error("보고서의 숫자를 읽지 못했습니다. 원본 이미지를 다시 선택해주세요.");
      setForm((current) => {
        const next = { ...current };
        Object.entries(result.values).forEach(([key, value]) => {
          next[key] = String(value);
        });
        return next;
      });
      const dateNotice =
        result.detectedDate && result.detectedDate !== dateKey
          ? ` 보고서 날짜는 ${result.detectedDate}이며, 현재 선택일은 ${dateKey}입니다.`
          : "";
      setImportMessage(
        result.recognizedCount < 20
          ? `${result.recognizedCount}개 항목을 채웠습니다. 일부 항목은 인식하지 못했으니 빈칸을 확인해주세요.${dateNotice}`
          : `${result.recognizedCount}개 항목을 채웠습니다.${dateNotice} 값을 확인한 뒤 통합 저장을 눌러주세요.`,
      );
    } catch (error) {
      setImportMessage(
        error instanceof Error
          ? error.message
          : "보고서를 분석하지 못했습니다. 다시 시도해주세요.",
      );
    } finally {
      setImporting(false);
    }
  };

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
      <div className="mt-3 rounded-xl border border-[#D9D6FE] bg-[#F7F6FF] p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[13px] font-bold text-[#3C3489]">
              오아 건강보고서 불러오기
            </p>
            <p className="mt-0.5 text-[11px] text-gray-600">
              오아 앱에서 저장한 긴 보고서 이미지를 기기 안에서 분석합니다.
            </p>
          </div>
          <button
            type="button"
            disabled={importing}
            onClick={() => fileInputRef.current?.click()}
            className="shrink-0 rounded-xl bg-[#534AB7] px-3 py-2 text-[12px] font-bold text-white disabled:cursor-wait disabled:opacity-60"
          >
            {importing ? `${importProgress}%` : "이미지 선택"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/heic,image/heif"
            onChange={importOaReport}
            className="hidden"
          />
        </div>
        {importing && (
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white">
            <div
              className="h-full rounded-full bg-[#534AB7] transition-[width]"
              style={{ width: `${importProgress}%` }}
            />
          </div>
        )}
        {importMessage && (
          <p
            className={`mt-2 text-[11px] ${
              importMessage.includes("채웠습니다")
                ? "text-emerald-700"
                : "text-amber-700"
            }`}
          >
            {importMessage}
          </p>
        )}
      </div>
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
      <div className="mt-3 space-y-2">
        {fieldGroups.map((group, groupIndex) => (
          <details
            key={group.title}
            open={groupIndex === 0}
            className="group rounded-xl border border-gray-200 bg-gray-50/60"
          >
            <summary className="cursor-pointer list-none px-3 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[13px] font-bold text-gray-800">
                    {group.title}
                  </p>
                  <p className="mt-0.5 text-[11px] text-gray-500">
                    {group.description}
                  </p>
                </div>
                <span className="text-[16px] text-gray-400 transition-transform group-open:rotate-180">
                  ⌄
                </span>
              </div>
            </summary>
            <div className="grid grid-cols-2 gap-2 border-t border-gray-200 bg-white p-3">
              {group.fields.map((field) => (
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
                      placeholder="값 입력"
                      className="min-w-0 flex-1 py-2 text-[13px] outline-none"
                    />
                    <span className="text-[11px] text-gray-400">
                      {field.unit}
                    </span>
                  </div>
                </label>
              ))}
            </div>
          </details>
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

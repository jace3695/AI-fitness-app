"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";
import {
  INBODY_RECORDS_KEY,
  InbodyRecord,
  InbodyRecordStore,
  BodyMetricSources,
  WEIGHT_RECORDS_KEY,
  WeightRecordStore,
  getPreviousWeightRecord,
  isTodayKey,
  readJson,
} from "../data/recordStorage";
import { parseOaReport, type OaDraftMeasurement } from "../lib/oaReportParser";
import { bodyForm, bodyImportOwner, mergeBodyFields, mergeBodyImport, validMeasurementDate } from "../lib/bodyImport";
import { getLocalDateKey } from "../data/dietPlans";
import { notifyRecordsChanged, writeStorageBatch } from "../data/storageTransaction";
import { useUnsavedChanges } from "../../components/useUnsavedChanges";
import { OA_REPORT_INVENTORY } from '../lib/oaReportInventory';
import { oaSourceMeasurements, setOaProMapping, OA_TRUNK_ROWS } from '../lib/oaDraftMapping';
import OaSourceCorrection from './OaSourceCorrection';

type InbodyField = {
  key: Exclude<keyof InbodyRecord, "weight" | "memo" | "metricSources">;
  label: string;
  unit: string;
  text?: boolean;
};

const fieldGroups: { title: string; description: string; fields: InbodyField[] }[] = [
  {
    title: "핵심 변화",
    description: "감량과 근육 유지 상태를 우선 확인하는 지표",
    fields: [
      { key: "bmi", label: "BMI", unit: "" },
      { key: "bodyFatPercent", label: "체지방률", unit: "%" },
      { key: "fatMass", label: "전체 지방량 (원문: 지방량)", unit: "kg" },
      { key: "muscleMass", label: "전체 근육량 (원문: 근육량)", unit: "kg" },
      { key: "musclePercent", label: "근육률", unit: "%" },
      { key: "visceralFatLevel", label: "내장 지방 지수", unit: "" },
    ],
  },
  {
    title: "체성분 상세",
    description: "지방·수분·단백질과 제지방 구성",
    fields: [
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
      { key: "bodyScore", label: "점수", unit: "점" },
      { key: "standardWeight", label: "표준 체중", unit: "kg" },
      { key: "reportedBodyAge", label: "신체연령 원문 숫자", unit: "" },
      { key: "reportedBodyAgeUnit", label: "신체연령 원문 단위", unit: "", text: true },
      { key: "bodyShape", label: "체형 원문", unit: "", text: true },
      { key: "measurementTime", label: "측정 시간", unit: "", text: true },
    ],
  },
  {
    title: "부위별 지방량",
    description: "좌우 팔·몸통·다리의 지방 분포 · 원문 체지방량은 몸통 항목",
    fields: [
      { key: "leftArmFatMass", label: "왼팔 지방량", unit: "kg" },
      { key: "trunkFatMass", label: "몸통 지방량", unit: "kg" },
      { key: "rightArmFatMass", label: "오른팔 지방량", unit: "kg" },
      { key: "leftLegFatMass", label: "왼쪽 다리 지방량", unit: "kg" },
      { key: "rightLegFatMass", label: "오른쪽 다리 지방량", unit: "kg" },
    ],
  },
  {
    title: "부위별 근육량",
    description: "좌우 팔·몸통·다리의 근육 분포 · 골격근량과 다른 지표",
    fields: [
      { key: "leftArmMuscleMass", label: "왼팔 근육량", unit: "kg" },
      { key: "trunkMuscleMass", label: "몸통 근육량", unit: "kg" },
      { key: "rightArmMuscleMass", label: "오른팔 근육량", unit: "kg" },
      { key: "leftLegMuscleMass", label: "왼쪽 다리 근육량", unit: "kg" },
      { key: "rightLegMuscleMass", label: "오른쪽 다리 근육량", unit: "kg" },
    ],
  },
];

fieldGroups.push({title: '다른 기기·직접 입력 (기존 기록)', description: 'OA 원문에 없는 골격근량과 별도 단위 기록입니다. 기존 값은 유지해요.', fields: [
 {key:'skeletalMuscleMass',label:'골격근량',unit:'kg'},
 {key:'bodyFatMass',label:'체지방량 (다른 기기·직접 입력)',unit:'kg'},
 {key:'bodyAge',label:'신체연령 (다른 기기·직접 입력)',unit:'세'},
]});
const inbodyFields = fieldGroups.flatMap((group) => group.fields);

interface Props {
  dateKey: string;
  onDateChange?: (date: string) => void;
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
  onDateChange,
}: Props) {
  const currentWeight = weights[dateKey];
  const currentInbody = inbody[dateKey];
  const [form, setForm] = useState<Record<string, string>>({});
  const manualEdit = useRef({ date: dateKey, dirty: false });
  const [manualDirty, setManualDirty] = useState(false);
  const [confirmedPro, setConfirmedPro] = useState(false);
  const [draft, setDraft] = useState<{ date: string; patch: Record<string, string>; owner: string; unmappedMeasurements: OaDraftMeasurement[]; sourceMeasurements: OaDraftMeasurement[]; autoMappedKeys: string[]; metricSources: BodyMetricSources } | null>(null);
  useUnsavedChanges(Boolean(draft) || manualDirty);
  const importVersion = useRef(0);
  const activeDate = useRef(dateKey);
  activeDate.current = dateKey;
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importMessage, setImportMessage] = useState("");
  const [recordMessage, setRecordMessage] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    importVersion.current += 1;
    setImporting(false);
    setImportMessage("");
  }, [dateKey]);

  useEffect(() => {
    const invalidate = () => {
      importVersion.current += 1;
      setDraft(null);
      setConfirmedPro(false);
      manualEdit.current.dirty = false;
      setManualDirty(false);
      setForm({});
      setImporting(false);
      setImportMessage("");
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === 'fitness-cloud-sync-user' || event.key === 'fitness-cloud-sync-epoch') invalidate();
    };
    // A browser history entry may be cached without React unmounting it.
    // Revoke pending OCR while retaining already reviewed, unsaved input.
    const onPageHide = () => {
      importVersion.current += 1;
      setImporting(false);
      setImportProgress(0);
      setImportMessage("");
    };
    window.addEventListener("yeoni-cloud-session-changed", invalidate);
    window.addEventListener("storage", onStorage);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      importVersion.current += 1;
      window.removeEventListener("yeoni-cloud-session-changed", invalidate);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, []);

  useEffect(() => {
    // A save in another panel refreshes store objects; keep this date's unsaved input.
    if (manualEdit.current.date === dateKey && manualEdit.current.dirty) return;
    manualEdit.current = { date: dateKey, dirty: false };
    setManualDirty(false);
    const next: Record<string, string> = {
      weight:
        currentWeight?.weight?.toString() ??
        currentInbody?.weight?.toString() ??
        "",
      memo: currentInbody?.memo ?? "",
    };
    inbodyFields.forEach(({ key }) => {
      const value = currentInbody?.[key];
      next[key] = typeof value === "number" || typeof value === 'string' ? String(value) : "";
    });
    setForm(next);
  }, [currentInbody, currentWeight, dateKey]);
  useEffect(() => setRecordMessage(current => current.startsWith(`${dateKey} `) ? current : ""), [dateKey]);

  const previous = getPreviousWeightRecord(weights, dateKey);
  const displayedWeight = Number(form.weight);
  const diff =
    Number.isFinite(displayedWeight) && previous
      ? displayedWeight - previous[1].weight
      : null;
  const hasRecord = Boolean(currentWeight || currentInbody);
  const visibleForm = draft ? { ...bodyForm(weights, inbody, draft.date), ...draft.patch } : form;
  const isOaRecord = Boolean(draft) || Object.values(currentInbody?.metricSources || {}).some(source => source?.device === 'OA Smart Scale PRO' || source?.device === 'OA long report');
  const legacyHasValues = ['skeletalMuscleMass', 'bodyFatMass', 'bodyAge'].some(key => Boolean(visibleForm[key]?.trim()));

  const editField = (key: string, value: string) => {
    if (draft) {
      const metricSources = { ...draft.metricSources };
      if (metricSources[key] && value !== draft.patch[key]) metricSources[key] = { ...metricSources[key], method: 'ocr-edited' };
      if (key === 'reportedBodyAgeUnit' && metricSources.reportedBodyAge) metricSources.reportedBodyAge = { ...metricSources.reportedBodyAge, method: 'ocr-edited' };
      setDraft({ ...draft, metricSources, autoMappedKeys: draft.autoMappedKeys.filter(item => item !== key), patch: { ...draft.patch, [key]: value } });
    }
    else {
      manualEdit.current = { date: dateKey, dirty: true };
      setManualDirty(true);
      setForm({ ...form, [key]: value });
    }
    setRecordMessage("");
  };

  const saveImport = () => {
    if (!draft) return;
    try {
      if (draft.owner !== bodyImportOwner(window.localStorage)) throw new Error("계정이 변경되었습니다. 이미지를 다시 선택해 주세요.");
      const latestWeights = readJson<WeightRecordStore>(WEIGHT_RECORDS_KEY, {});
      const latestInbody = readJson<InbodyRecordStore>(INBODY_RECORDS_KEY, {});
      const next = mergeBodyImport(latestWeights, latestInbody, draft.date, draft.patch, getLocalDateKey(), draft.metricSources);
      if ((latestWeights[draft.date] || latestInbody[draft.date]) && !window.confirm(`${draft.date}에 기존 기록이 있습니다. 인식하거나 직접 수정한 항목만 반영할까요? 나머지 수치와 메모는 유지됩니다.`)) return;
      if (draft.owner !== bodyImportOwner(window.localStorage)) throw new Error("계정이 변경되었습니다. 이미지를 다시 선택해 주세요.");
      if (JSON.stringify(latestWeights) !== JSON.stringify(readJson(WEIGHT_RECORDS_KEY, {})) || JSON.stringify(latestInbody) !== JSON.stringify(readJson(INBODY_RECORDS_KEY, {}))) throw new Error("기록이 변경되었습니다. 내용을 확인한 뒤 다시 저장해 주세요.");
      writeStorageBatch(window.localStorage, {
        [WEIGHT_RECORDS_KEY]: JSON.stringify(next.weights),
        [INBODY_RECORDS_KEY]: JSON.stringify(next.inbody),
      });
      manualEdit.current.dirty = false;
      setManualDirty(false);
      notifyRecordsChanged();
      onChange(next);
      onDateChange?.(draft.date);
      setDraft(null);
      setRecordMessage(`${draft.date} 측정 기록을 저장했습니다.`);
    } catch (error) {
      setRecordMessage(error instanceof Error ? error.message : "저장하지 못했습니다. 초안을 유지합니다.");
    }
  };

  const save = () => {
    const weightInput = (form.weight ?? "").trim();
    const parsedWeight = Math.round(Number(weightInput) * 10) / 10;
    if (
      weightInput !== "" &&
      (!Number.isFinite(parsedWeight) || parsedWeight <= 0)
    ) {
      setRecordMessage("체중은 0보다 큰 숫자로 입력해주세요.");
      return;
    }
    const invalidField = inbodyFields.find(({ key, text }) => {
      const input = (form[key] ?? "").trim();
      if (!input) return false;
      if (text) return input.length > 80 || (key === 'measurementTime' && !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(input));
      const value = Number(input);
      return !Number.isFinite(value) || value < 0;
    });
    if (invalidField) {
      setRecordMessage(`${invalidField.label} 값을 확인해 주세요. 시간은 시:분:초, 수치는 0 이상으로 입력해 주세요.`);
      return;
    }
    const hasInbodyInput = inbodyFields.some(
      ({ key }) => Boolean((form[key] ?? "").trim()),
    );
    if (!weightInput && !hasInbodyInput && !form.memo?.trim()) {
      setRecordMessage(
        hasRecord
          ? "모든 기록을 지우려면 이 날짜 기록 삭제 버튼을 눌러 주세요."
          : "저장할 체중 또는 인바디 값을 입력해주세요.",
      );
      return;
    }
    const nextWeights = { ...weights };
    if (Number.isFinite(parsedWeight) && parsedWeight > 0)
      nextWeights[dateKey] = {
        weight: parsedWeight,
        recordedAt: new Date().toISOString(),
      };
    else delete nextWeights[dateKey];

    const record = mergeBodyFields(currentInbody, { ...Object.fromEntries(inbodyFields.map(({key}) => [key, form[key] || ''])), memo: form.memo || '' });
    if (record.metricSources?.weight && parsedWeight !== currentWeight?.weight) {
      if (!weightInput) delete record.metricSources.weight;
      else record.metricSources.weight = { ...record.metricSources.weight, method: 'ocr-edited' };
    }
    const nextInbody = { ...inbody };
    if (Object.keys(record).length) nextInbody[dateKey] = record;
    else delete nextInbody[dateKey];

    try {
      writeStorageBatch(window.localStorage, {
        [WEIGHT_RECORDS_KEY]: JSON.stringify(nextWeights),
        [INBODY_RECORDS_KEY]: JSON.stringify(nextInbody),
      });
    } catch {
      setRecordMessage("저장하지 못했습니다. 입력 내용은 유지합니다. 기기 저장 공간을 확인한 뒤 다시 시도해 주세요. 이전 기록 복구가 필요한 경우 다음 저장 전에 복구를 다시 시도합니다.");
      return;
    }
    notifyRecordsChanged();
    manualEdit.current.dirty = false;
    setManualDirty(false);
    onChange({ weights: nextWeights, inbody: nextInbody });
    setRecordMessage(`${dateKey} 체중·인바디 기록을 저장했습니다.`);
  };

  const remove = () => {
    if (
      !window.confirm(
        `${dateKey}의 체중과 인바디 기록을 모두 삭제할까요? 이 작업은 되돌릴 수 없습니다.`,
      )
    ) {
      return;
    }
    const nextWeights = { ...weights };
    const nextInbody = { ...inbody };
    delete nextWeights[dateKey];
    delete nextInbody[dateKey];
    try {
      writeStorageBatch(window.localStorage, {
        [WEIGHT_RECORDS_KEY]: JSON.stringify(nextWeights),
        [INBODY_RECORDS_KEY]: JSON.stringify(nextInbody),
      });
    } catch {
      setRecordMessage("삭제하지 못했습니다. 입력 내용은 유지합니다. 기기 저장 공간을 확인한 뒤 다시 시도해 주세요. 이전 기록 복구가 필요한 경우 다음 저장 전에 복구를 다시 시도합니다.");
      return;
    }
    notifyRecordsChanged();
    manualEdit.current.dirty = false;
    setManualDirty(false);
    onChange({ weights: nextWeights, inbody: nextInbody });
    setForm({});
    setRecordMessage(`${dateKey} 체중·인바디 기록을 삭제했습니다.`);
  };

  const importOaReport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setImportMessage("이미지 파일을 선택해주세요.");
      return;
    }

    const version = ++importVersion.current;
    const owner = bodyImportOwner(window.localStorage);
    const originDate = dateKey;
    const isCurrent = () => version === importVersion.current && owner === bodyImportOwner(window.localStorage) && originDate === activeDate.current;
    setImporting(true);
    setImportProgress(0);
    setImportMessage("오아 보고서 숫자를 읽고 있습니다.");
    try {
      const result = await parseOaReport(file, (progress) => { if (isCurrent()) setImportProgress(progress); }, confirmedPro);
      if (!isCurrent()) return;
      const validEntries = Object.entries(result.values).filter(([, value]) => typeof value === "number" && Number.isFinite(value));
      const unmappedMeasurements = result.unmappedMeasurements || [];
      const recognizedCount = validEntries.length + unmappedMeasurements.length;
      const measuredDate = result.detectedDate && validMeasurementDate(result.detectedDate, getLocalDateKey()) ? result.detectedDate : "";
      const baseline = bodyForm(weights, inbody, originDate);
      const sameDayEdits = measuredDate === originDate
        ? Object.fromEntries(Object.entries(form).filter(([key, value]) => value !== (baseline[key] || "")))
        : {};
      const sourceMeasurements = oaSourceMeasurements(result);
      setDraft({ date: measuredDate, owner, unmappedMeasurements, sourceMeasurements,
        autoMappedKeys: OA_TRUNK_ROWS.filter(([key]) => result.metricSources?.[key]?.method === 'ocr' && result.values[key] !== undefined).map(([key]) => key),
        metricSources: result.metricSources || {}, patch: { ...sameDayEdits, ...Object.fromEntries(validEntries.map(([key, value]) => [key, String(value)])), ...result.textValues } });
      setRecordMessage("");
      const reviewLabels = (result.reviewKeys || []).map(key => key === "weight" ? "체중" : inbodyFields.find(field => field.key === key)?.label || key);
      setImportMessage(
        (recognizedCount ? `숫자 ${recognizedCount}개를 읽었어요. 틀릴 수 있으니 사진과 비교해 주세요.` : "사진에서 숫자를 읽지 못했어요. 아래에 직접 입력할 수 있어요.") +
        ` ${measuredDate ? "측정 날짜도 확인해 주세요." : "측정 날짜를 읽지 못했어요. 직접 입력해 주세요."}` +
        (reviewLabels.length ? ` 확인할 항목: ${reviewLabels.join(", ")}. 읽지 못한 값은 비워 두며, 전에 저장한 기록은 그대로 남아요.` : "") + (result.warnings?.join(' ') || '')
      );
    } catch (error) {
      if (!isCurrent()) return;
      setImportMessage(
        error instanceof Error
          ? error.message
          : "보고서를 분석하지 못했습니다. 다시 시도해주세요.",
      );
    } finally {
      if (version === importVersion.current) setImporting(false);
    }
  };

  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm [&_input]:scroll-mt-36 [&_textarea]:scroll-mt-36">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[15px] font-bold text-gray-800">
            체중 기록
          </p>
          <p className="mt-1 text-[12px] text-gray-500">
            체중과 몸의 근육·지방 수치를 기록해요. 직접 입력하거나 사진을 골라 주세요.
          </p>
        </div>
        <span className="rounded-full bg-[#EEEDFE] px-2 py-1 text-[11px] font-bold text-[#534AB7]">
          체중·인바디
        </span>
      </div>
      <ol aria-label="사진 입력 순서" className="mt-3 grid grid-cols-3 gap-1 text-center text-[12px] font-bold text-[#534AB7]">
        <li className="rounded-lg bg-purple-50 p-2">1. 사진 선택</li>
        <li className="rounded-lg bg-purple-50 p-2">2. 내용 확인</li>
        <li className="rounded-lg bg-purple-50 p-2">3. 저장</li>
      </ol>
      {isTodayKey(dateKey) && (
        <p className="mt-3 rounded-xl bg-blue-50 px-3 py-2 text-[12px] text-blue-700">
          체중은 아침 공복, 인바디는 주 1회 또는 2주 1회 같은 조건 측정을
          권장합니다.
        </p>
      )}
      <div className="mt-3 rounded-xl border border-[#D9D6FE] bg-[#F7F6FF] p-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[13px] font-bold text-[#3C3489]">
              사진으로 입력
            </p>
            <p className="mt-0.5 text-[11px] text-gray-600">
              오아 앱의 긴 건강보고서 사진만 읽을 수 있어요. 사진은 기기 안에서 읽어요. 저장 버튼을 눌러야 기록에 남아요.
            </p>
          </div>
          <button
            type="button"
            disabled={importing || Boolean(draft)}
            onClick={() => fileInputRef.current?.click()}
            className="min-h-11 shrink-0 rounded-xl bg-[#534AB7] px-4 py-3 text-sm font-bold text-white disabled:cursor-wait disabled:opacity-60"
          >
            {importing ? `사진 읽는 중 ${importProgress}%` : "사진 선택"}
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
            role="status"
            className="mt-2 text-[12px] leading-5 text-amber-800"
          >
            {importMessage}
          </p>
        )}
      </div>
      {!draft && !manualDirty && !importing && currentInbody && <OaSourceCorrection key={dateKey} dateKey={dateKey} record={currentInbody} onSaved={next => onChange({ weights, inbody: next })}/>}
      <label className="mt-3 flex gap-2 text-sm"><input type="checkbox" checked={confirmedPro} disabled={importing} onChange={event => {
        const checked = event.target.checked;
        setConfirmedPro(checked);
        setDraft(current => current && current.owner === bodyImportOwner(window.localStorage) ? setOaProMapping(current, checked) : null);
      }} />사진이 오아 스마트 체중계 PRO의 긴 건강보고서임을 확인했어요.</label>
      <p className="text-xs text-gray-600">부위 배열과 몸통 아이콘에 따른 해석입니다. 확인한 경우에만 원문의 ‘신체 근육량’·‘체지방량’을 몸통 항목으로 저장할 수 있어요. 다른 기기·양식은 선택하지 마세요.</p>
      <details className="mt-2 text-xs"><summary>사진 항목 출처·원문 보기</summary><ul aria-label="사진 항목 출처" className="mt-2 text-xs text-gray-600">{Object.entries(draft?.metricSources || currentInbody?.metricSources || {}).map(([key, source]) => <li key={key}>{OA_REPORT_INVENTORY.find(item => item[0] === key)?.[1] || key} · {source?.device} · 원문: {source?.originalLabel} {source?.originalText} · {source?.method === 'ocr-edited' ? '사진 입력 후 수정' : '사진 입력'}</li>)}</ul></details>
      {draft && <section aria-label="가져오기 확인" className="mt-3 rounded-xl border border-purple-200 bg-purple-50 p-3">
        {draft.unmappedMeasurements.length > 0 && <ul aria-label="저장 제외 원문 출처" className="text-sm">{draft.unmappedMeasurements.map(item => <li key={item.label}>{item.source} 긴 보고서 · 원문: {item.label} {item.value} {item.unit} · 읽음 · {confirmedPro ? '직접 입력값 유지 · 자동 반영 제외' : '기기 확인 대기'} · 저장 제외</li>)}</ul>}
        <p className="text-sm">저장 후보 {Object.keys(draft.patch).filter(key => key !== 'memo' && key !== 'reportedBodyAgeUnit' && draft.patch[key].trim()).length + (draft.date ? 1 : 0)}개 (날짜 포함) · 저장 제외 참고값 {draft.unmappedMeasurements.length}개. 확인 후 저장해 주세요.</p>
        <p className="text-sm">이 OA 보고서에는 골격근량이 따로 제공되지 않아요. 몸통 근육량을 골격근량으로 넣거나 평가하지 않아요. 기존 골격근량 기록은 유지해요.</p>
        <details className="my-2 text-sm"><summary>원본 30개 항목 대조표 · 숫자 27개, 체형, 날짜, 시간</summary><ul>{OA_REPORT_INVENTORY.map(([key, label, unit]) => {
          const value = key === 'measurementDate' ? draft.date : draft.patch[key];
          const reference = draft.unmappedMeasurements.find(item => OA_TRUNK_ROWS.some(([field, label]) => field === key && label === item.label));
          if (reference) return <li key={key} data-oa-field={key}>{label}: {reference.value} {reference.unit} · 읽음 · {confirmedPro ? '직접 입력값 유지 · 자동 반영 제외' : '기기 확인 대기'} · 원문 참고값 저장 제외{value !== undefined && <> · 직접 입력: {value || '비움'}</>}</li>;
          return <li key={key} data-oa-field={key}>{label}: {value || '미인식 · 직접 확인 필요'} {value ? unit : ''} · {draft.metricSources[key] ? '사진 원문 출처 있음' : value ? '직접 입력 또는 수정' : '이번 사진에서 미확인'}</li>;
        })}</ul></details>
        {draft.unmappedMeasurements.length > 0 && <aside aria-label="OA 원문 참고값" className="mb-3 rounded border border-amber-300 bg-amber-50 p-3">
          <p className="font-bold">OA 원문 참고값 · 이번 기록에는 저장하지 않아요</p>
          <p className="text-sm">아래 값은 앱 항목과 뜻이 같은지 확인되지 않았어요. 골격근량이나 일반 체지방량으로 옮기지 않으며, 변화 평가에도 사용하지 않아요. 저장하거나 취소하면 이 참고 표시는 사라져요.</p>
          <ul>{draft.unmappedMeasurements.map(item => <li key={item.label}>{item.source} · {item.label}: {item.value} {item.unit}</li>)}</ul>
          <p className="text-sm">아래 골격근량·체지방량 칸에 기존 기록이 보이면 이번 사진에서 읽은 값이 아니에요.</p>
        </aside>}
        <p className="text-sm">지원 범위: 숫자 27개·체형·날짜·시간. 상태 배지, 그래프 기준값, 설명 문장은 저장하지 않아요. 표준 체중은 목표체중과 별도이며, 신체연령은 원문 단위를 유지해요. 시간대는 추정하지 않아요.</p><p className="font-bold">2. 내용 확인 · 아직 저장 전이에요</p>
        <p className="text-sm">사진의 날짜와 숫자가 맞는지 확인해 주세요. 틀린 곳은 고친 뒤 아래 저장 버튼을 누르세요. 읽지 못한 값과 메모는 그 날짜에 전에 저장한 내용이 남아요.</p>
        <label className="mt-2 block">측정 날짜<input aria-label="측정 날짜" type="date" max={getLocalDateKey()} value={draft.date} onChange={(event) => { setDraft({ ...draft, date: event.target.value }); setRecordMessage(""); }} className="block rounded border p-2" /></label>
        {!validMeasurementDate(draft.date, getLocalDateKey()) && <p role="alert">실제 측정 날짜를 입력해 주세요. 미래 날짜는 저장할 수 없습니다.</p>}
        {(weights[draft.date] || inbody[draft.date]) && <p>이 날짜에 기존 기록이 있습니다. 저장할 때 변경 확인이 필요합니다.</p>}
        <button type="button" onClick={() => { setDraft(null); setImportMessage(""); }} className="mt-2 min-h-11 rounded bg-white px-3 py-2">사진 입력 취소</button>
      </section>}
      <label className="mt-3 block text-[12px] font-semibold text-gray-600">
        체중
        <div className="mt-1 flex items-center rounded-xl border border-gray-200 px-3">
          <input
            inputMode="decimal"
            disabled={importing}
            value={visibleForm.weight || ""}
            onChange={(event) => {
              editField("weight", event.target.value);
              setRecordMessage("");
            }}
            placeholder="예: 82.4"
            className="min-w-0 flex-1 py-2 text-[14px] outline-none"
          />
          <span className="text-[11px] text-gray-400">kg</span>
        </div>
      </label>
      {!draft && Number.isFinite(displayedWeight) && displayedWeight > 0 && (
        <p className="mt-2 text-[12px] text-gray-600">
          이전 기록 대비:{" "}
          <b>
            {diff === null
              ? "이전 기록 없음"
              : `${diff > 0 ? "+" : ""}${diff.toFixed(1)}kg`}
          </b>
        </p>
      )}
      {isOaRecord && <p className="mt-3 rounded-xl bg-blue-50 p-3 text-sm">OA 원문의 전체 근육량·전체 지방량은 아래에, 몸통 값은 부위별 항목에 있어요. 골격근량은 이 보고서에 미제공이므로 평가할 수 없어요. 다른 기기·직접 입력의 과거 값은 보존합니다. 신체연령은 대사·종합 지표에서 원문 단위와 함께 확인하세요.</p>}<div className="mt-3 space-y-2">
        {fieldGroups.map((group, groupIndex) => (
          <details
            key={group.title}
            data-body-group={group.title}
            open={groupIndex === 0 || (groupIndex === fieldGroups.length - 1 && legacyHasValues) || (isOaRecord && ((group.title === '대사·종합 지표' && Boolean(visibleForm.reportedBodyAge)) || (group.title === '부위별 지방량' && Boolean(visibleForm.trunkFatMass)))) || Boolean(draft && groupIndex < fieldGroups.length - 1)}
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
            <div className="grid grid-cols-1 gap-2 border-t border-gray-200 bg-white p-3 sm:grid-cols-2 xl:grid-cols-3">
              {group.fields.filter(field => field.key !== 'reportedBodyAgeUnit').map((field) => field.key === 'reportedBodyAge' ? (
                <div key={field.key} data-body-field="reportedBodyAge" className="rounded-xl border border-gray-200 p-3 text-[12px]">
                  <p className="font-semibold text-gray-600">신체연령 (사진 원문)</p>
                  <output aria-label="신체연령 원문" className="mt-1 block text-[15px] font-bold">{visibleForm.reportedBodyAge ? visibleForm.reportedBodyAge + ' ' + (visibleForm.reportedBodyAgeUnit || '단위 미확인') : '미제공'}</output>
                  <details className="mt-2"><summary className="cursor-pointer text-gray-600">신체연령 원문 수정</summary>
                    <div className="mt-2 flex gap-2">
                      <label className="min-w-0 flex-1">숫자<input aria-label="신체연령 원문 숫자" inputMode="decimal" disabled={importing} value={visibleForm.reportedBodyAge || ''} onChange={event => editField('reportedBodyAge', event.target.value)} className="mt-1 w-full rounded border p-2" /></label>
                      <label className="min-w-0 flex-1">원문 단위<input aria-label="신체연령 원문 단위" disabled={importing} value={visibleForm.reportedBodyAgeUnit || ''} onChange={event => editField('reportedBodyAgeUnit', event.target.value)} className="mt-1 w-full rounded border p-2" /></label>
                    </div>
                  </details>
                </div>
              ) : (
                <label
                  key={field.key}
                  data-body-field={field.key}
                  className="text-[12px] font-semibold text-gray-600"
                >
                  {isOaRecord && field.key === 'trunkFatMass' ? '체지방량 (몸통 항목)' : field.label}
                  <div className="mt-1 flex items-center gap-1 rounded-xl border border-gray-200 px-2">
                    <input
                      inputMode={field.text ? "text" : "decimal"}
                      disabled={importing}
                      value={visibleForm[field.key] || ""}
                      onChange={(event) => {
                        editField(field.key, event.target.value);
                        setRecordMessage("");
                      }}
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
        disabled={importing}
        value={visibleForm.memo || ""}
        onChange={(event) => {
          editField("memo", event.target.value);
          setRecordMessage("");
        }}
        placeholder="체중·인바디 메모"
        className="mt-3 min-h-20 w-full rounded-xl border border-gray-200 px-3 py-2 text-[13px]"
      />
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={draft ? saveImport : save}
          disabled={importing || Boolean(draft && !validMeasurementDate(draft.date, getLocalDateKey()))}
          className="min-h-12 flex-1 rounded-xl bg-[#534AB7] px-4 py-3 text-sm font-bold text-white"
        >
          {draft ? "확인한 측정일에 저장" : "체중·인바디 저장"}
        </button>
        {hasRecord && !draft && !importing && (
          <button
            type="button"
            onClick={remove}
            className="min-h-12 rounded-xl bg-red-50 px-4 py-3 text-[13px] font-bold text-red-600"
          >
            이 날짜 기록 삭제
          </button>
        )}
      </div>
      {recordMessage && (
        <p
          role="status"
          aria-live="polite"
          className={`mt-2 text-[11px] font-medium ${recordMessage.includes("해주세요") ? "text-red-700" : "text-emerald-700"}`}
        >
          {recordMessage}
        </p>
      )}
    </section>
  );
}

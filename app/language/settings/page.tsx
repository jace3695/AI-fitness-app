"use client";

import { useEffect, useRef, useState } from "react";
import YeoniPreferencesPanel from "@/components/YeoniPreferencesPanel";
import RecordResetPanel from "@/app/components/RecordResetPanel";
import {
  loadIntegratedLearningSettings,
  type IntegratedLearningSettings,
} from "@/utils/integratedLearningSettings";

import { useLanguageRecordSnapshot } from "@/components/language/useLanguageRecordSnapshot";
import { isLanguageRecordContextCurrent, type LanguageRecordContext, type LanguageRecordSnapshot } from "@/app/data/languageCloudSync";
import { assertLanguageMutationUncommitted, getLanguageMutationOutcome, languageMutationError, requireLanguageMutationAcknowledged } from "@/app/data/languageRecordMutations";
import {
  advanceLanguageSettingsDraftSource, createLearningSettingsMutation, createResetLanguageSettingsMutation,
  createSectionSettingMutation, loadDailyGoalCount, loadJapaneseAppSettings, runLanguageSettingsMutation, languageSettingsProjectionError,
  validSectionSetting, type LearningSection, type CommonSectionSettings, type DetailedSectionSettings,
  type LanguageSettingsMutation, type LanguageSettingsPayload, type LearningSettingsPatch, type SectionField,
} from "@/app/data/languageSettingsMutations";

const DAILY_GOAL_OPTIONS = [1, 2, 3, 4, 5] as const;

const SECTION_LABELS: Record<LearningSection, string> = {
  kana: "가나",
  words: "단어",
  sentences: "문장",
  speaking: "말하기",
  conversation: "AI 회화",
};

const TTS_RATE_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 0.5, label: "0.5 아주 느리게" },
  { value: 0.6, label: "0.6" },
  { value: 0.7, label: "0.7" },
  { value: 0.8, label: "0.8 느리게" },
  { value: 0.9, label: "0.9" },
  { value: 1, label: "1.0 보통" },
  { value: 1.1, label: "1.1" },
  { value: 1.2, label: "1.2 빠르게" },
];

const REPEAT_COUNT_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 1, label: "1회" },
  { value: 2, label: "2회" },
  { value: 3, label: "3회" },
];

const REPEAT_DELAY_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 0, label: "바로 반복" },
  { value: 300, label: "0.3초" },
  { value: 500, label: "0.5초" },
  { value: 1000, label: "1초" },
  { value: 1500, label: "1.5초" },
  { value: 2000, label: "2초" },
];

function isValidTtsRate(value: unknown): value is number { return validSectionSetting("ttsRate", value); }
function isValidRepeatCount(value: unknown): value is number { return validSectionSetting("repeatCount", value); }
function isValidRepeatDelayMs(value: unknown): value is number { return validSectionSetting("repeatDelayMs", value); }
type PendingSection = { source: LanguageRecordSnapshot; context: LanguageRecordContext; payload: Extract<LanguageSettingsPayload, { kind: "section" }>; sequence: number; intent?: LanguageSettingsMutation; failed?: boolean; committed?: boolean; superseded?: PendingSection };
type PendingLearning = { source: LanguageRecordSnapshot; context: LanguageRecordContext; patch: LearningSettingsPatch; sequence: number; intent?: LanguageSettingsMutation; committed?: boolean; superseded?: PendingLearning };

export default function SettingsPage() {
  const { context, snapshot, records, error: recordError } = useLanguageRecordSnapshot();
  const projectionError = languageSettingsProjectionError(records);
  const [revision, setRevision] = useState(0);
  const [saveMessage, setSaveMessage] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const sectionDrafts = useRef(new Map<string, PendingSection>());
  const learningDraft = useRef<PendingLearning | null>(null);
  const retainedSection = useRef<PendingSection | null>(null);
  const retainedLearning = useRef<PendingLearning | null>(null);
  const busy = useRef(false);
  const resetIntent = useRef<LanguageSettingsMutation | null>(null);
  const resetCommitted = useRef(false);
  const supersededResets = useRef<LanguageSettingsMutation[]>([]);
  const learningInFlight = useRef(false);
  const mounted = useRef(true);
  const latestContext = useRef(context);
  latestContext.current = context;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const redraw = () => setRevision(value => value + 1);
  const settings = loadJapaneseAppSettings(records.japaneseAppSettings);
  for (const draft of sectionDrafts.current.values()) Object.assign(settings.sections[draft.payload.section], { [draft.payload.field]: draft.payload.value });
  const integratedSettings = { ...loadIntegratedLearningSettings(records.integratedLearningSettingsV1), ...learningDraft.current?.patch.integrated };
  const dailyGoalCount = learningDraft.current?.patch.dailyGoalCount ?? loadDailyGoalCount(records.learningSettings);
  const canPublish = (source: LanguageRecordSnapshot | null) => mounted.current && !!source && latestContext.current === source.context && isLanguageRecordContextCurrent(source.context);

  const pumpSections = async () => {
    if (busy.current || learningInFlight.current || resetIntent.current) return;
    busy.current = true; setSaving(true);
    try {
      for (;;) {
        const retained = retainedSection.current;
        const entry = retained ? (retained.failed ? undefined : [`${retained.payload.section}.${retained.payload.field}`, retained] as const) : [...sectionDrafts.current.entries()].find(([, draft]) => !draft.failed);
        if (!entry || !mounted.current) break;
        const [key, pending] = entry;
        retainedSection.current = pending;
        try {
          const intent = pending.intent ?? createSectionSettingMutation(pending.context, pending.source, pending.payload.section, pending.payload.field, pending.payload.value);
          pending.intent = intent;
          const receipt = await runLanguageSettingsMutation(intent, latestContext.current);
          pending.committed = true;
          const result = requireLanguageMutationAcknowledged(receipt);
          if (!canPublish(result.source)) throw new Error("설정 저장 뒤 계정 상태가 바뀌었어요. 입력은 유지했어요. 다시 확인해 주세요.");
          for (const [otherKey, draft] of sectionDrafts.current) {
            if (otherKey === key && draft === pending) { sectionDrafts.current.delete(key); continue; }
            if (!draft.intent) {
              try { draft.source = advanceLanguageSettingsDraftSource(draft.source, draft.payload, intent, result); draft.failed = draft.context !== draft.source.context; if (draft.failed) setSaveError("연결 상태가 바뀌어 새 입력을 자동 저장하지 않았어요. 설정을 다시 선택해 주세요."); }
              catch { draft.failed = true; setSaveError("다른 설정 변경이 있어 입력을 유지했어요. 다시 확인해 주세요."); }
            }
          }
          if (learningDraft.current && !learningDraft.current.intent) {
            try { learningDraft.current.source = advanceLanguageSettingsDraftSource(learningDraft.current.source, { kind: "learning", patch: learningDraft.current.patch }, intent, result); learningDraft.current.context = learningDraft.current.source.context; }
            catch { /* Keep the exact original source; a deliberate save will report the conflict. */ }
          }
          retainedSection.current = null; redraw();
        } catch (error) {
          pending.failed = true;
          const latest = sectionDrafts.current.get(key);
          if (latest && latest !== pending) latest.failed = true;
          if (mounted.current) { setSaveError(languageMutationError(error)); redraw(); }
          break;
        }
      }
    } finally { busy.current = false; if (mounted.current) setSaving(false); }
  };
  const updateSectionSetting = (section: LearningSection, field: SectionField, value: number | boolean) => {
    if (resetIntent.current) return;
    const key = `${section}.${field}`, previous = sectionDrafts.current.get(key);
    const source = previous?.source ?? snapshot, boundContext = context;
    if (!source || !boundContext) { setSaveError("학습 기록을 확인한 뒤 설정을 변경해 주세요."); return; }
    if (!busy.current && retainedSection.current?.payload.section === section && retainedSection.current.payload.field === field && !retainedSection.current.intent) retainedSection.current = null;
    sectionDrafts.current.set(key, { source, context: boundContext, payload: { kind: "section", section, field, value }, sequence: revision + 1, failed: retainedSection.current?.failed });
    setSaveMessage(""); setSaveError(retainedSection.current?.failed ? "앞선 저장 결과를 확인하거나, 현재 연결에서 새 저장을 요청해 주세요." : ""); redraw(); void pumpSections();
  };
  const updateCommonSetting = (section: LearningSection, key: keyof CommonSectionSettings, value: number) => updateSectionSetting(section, key, value);
  const updateDetailedSetting = (section: Exclude<LearningSection, "kana">, key: "showKoreanPronunciation" | "showReading", value: boolean) => updateSectionSetting(section, key, value);
  const changeLearning = (patch: LearningSettingsPatch) => {
    if (resetIntent.current) return;
    const previous = learningDraft.current;
    const source = previous?.source ?? snapshot, boundContext = previous?.context ?? context;
    if (!source || !boundContext) { setSaveError("학습 기록을 확인한 뒤 설정을 변경해 주세요."); return; }
    learningDraft.current = { source, context: boundContext, sequence: (previous?.sequence ?? 0) + 1,
      patch: { ...previous?.patch, ...patch, integrated: { ...previous?.patch.integrated, ...patch.integrated } } };
    setSaveMessage(""); setSaveError(""); redraw();
  };
  const handleResetSettings = async () => {
    if (busy.current || learningInFlight.current) { setSaveError("진행 중인 설정 저장이 끝난 뒤 초기화해 주세요."); return; }
    if (!resetIntent.current && !window.confirm("모든 설정을 기본값으로 되돌릴까요?")) return;
    if (!snapshot || !context) { setSaveError("학습 기록을 확인한 뒤 초기화해 주세요."); return; }
    try {
      const intent = resetIntent.current ?? createResetLanguageSettingsMutation(context, snapshot);
      resetIntent.current = intent; busy.current = true; setSaving(true);
      const receipt = await runLanguageSettingsMutation(intent, latestContext.current);
      resetCommitted.current = true;
      const result = requireLanguageMutationAcknowledged(receipt);
      if (!canPublish(result.source)) throw new Error("초기화 뒤 계정 상태가 바뀌었어요. 설정을 다시 확인해 주세요.");
      // Failed/queued older autosaves cannot run after this reset.
      sectionDrafts.current.clear(); retainedSection.current = null; retainedLearning.current = null;
      if (learningDraft.current) {
        const draft = learningDraft.current;
        learningDraft.current = Object.hasOwn(draft.patch, "dailyGoalCount") ? { ...draft, source: advanceLanguageSettingsDraftSource(draft.source, { kind: "learning", patch: { dailyGoalCount: draft.patch.dailyGoalCount } }, intent, result), patch: { dailyGoalCount: draft.patch.dailyGoalCount }, intent: undefined } : null;
      }
      resetIntent.current = null; resetCommitted.current = false; setSaveError(""); setSaveMessage("학습 설정을 기본값으로 되돌렸어요."); redraw();
    } catch (error) { setSaveError(languageMutationError(error)); }
    finally { busy.current = false; if (mounted.current) setSaving(false); }
  };

  const renderSectionCard = (section: LearningSection) => {
    const sectionSettings = settings.sections[section];
    const isKana = section === "kana";
    const detailedSectionSettings = isKana ? null : (sectionSettings as DetailedSectionSettings);

    return (
      <div key={section} className="card" style={{ display: "grid", gap: "14px" }}>
        <h2 style={{ margin: 0 }}>{SECTION_LABELS[section]} 설정</h2>

        <div>
          <label htmlFor={`${section}-tts-rate`} style={{ display: "block", fontWeight: 600, marginBottom: "6px" }}>
            음성 재생 속도
          </label>
          <select
            id={`${section}-tts-rate`}
            value={sectionSettings.ttsRate}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (!isValidTtsRate(value)) return;
              updateCommonSetting(section, "ttsRate", value);
            }}
            style={{ width: "100%" }}
          >
            {TTS_RATE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor={`${section}-repeat-count`} style={{ display: "block", fontWeight: 600, marginBottom: "6px" }}>
            반복 재생 횟수
          </label>
          <select
            id={`${section}-repeat-count`}
            value={sectionSettings.repeatCount}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (!isValidRepeatCount(value)) return;
              updateCommonSetting(section, "repeatCount", value);
            }}
            style={{ width: "100%" }}
          >
            {REPEAT_COUNT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor={`${section}-repeat-delay`} style={{ display: "block", fontWeight: 600, marginBottom: "6px" }}>
            반복 재생 간격
          </label>
          <select
            id={`${section}-repeat-delay`}
            value={sectionSettings.repeatDelayMs}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (!isValidRepeatDelayMs(value)) return;
              updateCommonSetting(section, "repeatDelayMs", value);
            }}
            style={{ width: "100%" }}
          >
            {REPEAT_DELAY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {!isKana && (
          <>
            <label
              htmlFor={`${section}-show-reading`}
              style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: 600 }}
            >
              <input
                id={`${section}-show-reading`}
                type="checkbox"
                checked={detailedSectionSettings?.showReading ?? false}
                onChange={(event) => {
                  updateDetailedSetting(section, "showReading", event.target.checked);
                }}
              />
              읽기 표시
            </label>

            <label
              htmlFor={`${section}-show-korean-pronunciation`}
              style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: 600 }}
            >
              <input
                id={`${section}-show-korean-pronunciation`}
                type="checkbox"
                checked={detailedSectionSettings?.showKoreanPronunciation ?? false}
                onChange={(event) => {
                  updateDetailedSetting(section, "showKoreanPronunciation", event.target.checked);
                }}
              />
              한글 발음 참고 표시
            </label>
          </>
        )}
      </div>
    );
  };

  const handleSaveLearningSettings = async () => {
    if (busy.current || learningInFlight.current || resetIntent.current) return;
    const pending = retainedLearning.current ?? learningDraft.current;
    if (!pending) { setSaveMessage("변경된 학습 설정이 없어요."); return; }
    retainedLearning.current = pending;
    learningInFlight.current = true; setSaving(true); setSaveMessage(""); setSaveError("");
    try {
      const intent = pending.intent ?? createLearningSettingsMutation(latestContext.current ?? pending.context, pending.source, pending.patch);
      pending.intent = intent;
      const receipt = await runLanguageSettingsMutation(intent, latestContext.current);
      pending.committed = true;
      const result = requireLanguageMutationAcknowledged(receipt);
      if (!canPublish(result.source)) throw new Error("설정 저장 뒤 계정 상태가 바뀌었어요. 입력은 유지했어요.");
      const next = learningDraft.current;
      if (next === pending) { learningDraft.current = null; setSaveMessage("학습 목표와 통합 과정 설정이 저장됐어요."); }
      else if (next) {
        next.source = advanceLanguageSettingsDraftSource(next.source, { kind: "learning", patch: next.patch }, intent, result); next.context = next.source.context;
        // Revision N cannot acknowledge the user's later edit N+1.
        setSaveMessage("앞선 설정을 저장했어요. 새로 바꾼 설정은 다시 저장해 주세요.");
      }
      retainedLearning.current = null; redraw();
    } catch (error) { if (mounted.current) setSaveError(languageMutationError(error)); }
    finally { learningInFlight.current = false; if (mounted.current) { setSaving(false); void pumpSections(); } }
  };
  const retrySectionSettings = () => {
    for (const draft of sectionDrafts.current.values()) draft.failed = false;
    if (retainedSection.current) retainedSection.current.failed = false;
    setSaveError(""); void pumpSections();
  };

  const saveSectionsAsNewAction = () => {
    if (!context || busy.current || learningInFlight.current || resetIntent.current) return;
    if (retainedSection.current?.intent && ["committed", "unknown"].includes(getLanguageMutationOutcome(retainedSection.current.intent))) { retrySectionSettings(); return; }
    try {
      if (retainedSection.current?.intent) assertLanguageMutationUncommitted(retainedSection.current.intent);
      const replacements = [...sectionDrafts.current.entries()].filter(([, draft]) => draft.failed).map(([key, draft]) => {
        if (draft.intent) assertLanguageMutationUncommitted(draft.intent);
        const intent = createSectionSettingMutation(context, draft.source, draft.payload.section, draft.payload.field, draft.payload.value);
        return [key, { ...draft, context, intent, committed: false, failed: false, superseded: retainedSection.current?.payload.section === draft.payload.section && retainedSection.current.payload.field === draft.payload.field ? retainedSection.current : draft }] as const;
      });
      for (const [key, replacement] of replacements) sectionDrafts.current.set(key, replacement);
      retainedSection.current = null; setSaveError(""); redraw(); void pumpSections();
    } catch (error) { setSaveError(languageMutationError(error)); }
  };
  const saveLearningAsNewAction = () => {
    if (!context || busy.current || learningInFlight.current || resetIntent.current || !learningDraft.current) return;
    if (retainedLearning.current?.intent && ["committed", "unknown"].includes(getLanguageMutationOutcome(retainedLearning.current.intent))) { void handleSaveLearningSettings(); return; }
    try {
      const previous = learningDraft.current;
      if (retainedLearning.current?.intent) assertLanguageMutationUncommitted(retainedLearning.current.intent);
      if (previous.intent) assertLanguageMutationUncommitted(previous.intent);
      const intent = createLearningSettingsMutation(context, previous.source, previous.patch);
      learningDraft.current = { ...previous, context, intent, committed: false, superseded: retainedLearning.current ?? previous };
      retainedLearning.current = null; redraw(); void handleSaveLearningSettings();
    } catch (error) { setSaveError(languageMutationError(error)); }
  };
  const resetAsNewAction = () => {
    if (!context || busy.current || learningInFlight.current || !resetIntent.current) return;
    if (["committed", "unknown"].includes(getLanguageMutationOutcome(resetIntent.current))) { void handleResetSettings(); return; }
    if (!window.confirm("보존한 설정 원본이 그대로인지 확인한 뒤, 현재 연결에서 새 초기화 요청으로 저장할까요?")) return;
    try {
      const previous = resetIntent.current;
      assertLanguageMutationUncommitted(previous);
      const intent = createResetLanguageSettingsMutation(context, previous.source);
      supersededResets.current.push(previous); resetIntent.current = intent; void handleResetSettings();
    } catch (error) { setSaveError(languageMutationError(error)); }
  };


  return (
    <section>
      <div className="page-header">
        <h1>학습 설정</h1>
        <p className="muted settings-page-subtitle" style={{ marginBottom: 0 }}>
          나에게 맞는 하루 학습 목표를 정하고, 매일 꾸준히 학습해 보세요.
        </p>
      </div>

      <div style={{ marginBottom: 20 }}><YeoniPreferencesPanel /></div>
      {(saveError || recordError || projectionError) && <p role="alert">{saveError || recordError || projectionError}</p>}
      {sectionDrafts.current.size > 0 && <p role="status">변경한 개별 설정을 저장 중이거나 확인이 필요해요.</p>}
      {[...sectionDrafts.current.values()].some(draft => draft.failed) && <button type="button" className="btn" disabled={saving} onClick={retrySectionSettings}>개별 설정 다시 저장</button>}
      {saveError && [...sectionDrafts.current.values()].some(draft => draft.failed) && <button type="button" className="btn" disabled={saving || !snapshot} onClick={saveSectionsAsNewAction}>현재 연결에서 개별 설정 새로 저장</button>}
      {saveError && learningDraft.current && <button type="button" className="btn" disabled={saving || !snapshot} onClick={saveLearningAsNewAction}>현재 연결에서 학습 설정 새로 저장</button>}
      {saveError && resetIntent.current && <button type="button" className="btn" disabled={saving || !snapshot} onClick={resetAsNewAction}>현재 연결에서 초기화 새로 요청</button>}
      {!snapshot && <p role="status">학습 기록의 저장 상태를 확인하고 있어요.</p>}

      <div className="card daily-goal-card" style={{ display: "grid", gap: "14px" }}>
        <div className="daily-goal-header">
          <h2 style={{ margin: 0 }}>하루 학습 목표</h2>
          <span className="daily-goal-badge">현재 {dailyGoalCount}개</span>
        </div>
        <label htmlFor="daily-goal-count" style={{ display: "block", fontWeight: 600, marginBottom: "4px" }}>
          하루에 완료하고 싶은 루틴 개수
        </label>
        <div className="daily-goal-picker" role="radiogroup" aria-label="하루 목표 개수 선택">
          {DAILY_GOAL_OPTIONS.map((goal) => {
            const isSelected = dailyGoalCount === goal;

            return (
              <button
                key={goal}
                type="button"
                className={`daily-goal-option${isSelected ? " is-selected" : ""}`}
                onClick={() => {
                  changeLearning({ dailyGoalCount: goal });
                  setSaveMessage("");
                }}
                aria-pressed={isSelected}
              >
                <strong>{goal}</strong>
                <span>개</span>
              </button>
            );
          })}
        </div>
        <select
          id="daily-goal-count"
          value={dailyGoalCount}
          onChange={(event) => {
            changeLearning({ dailyGoalCount: Number(event.target.value) });
            setSaveMessage("");
          }}
          className="sr-only-select"
          aria-hidden="true"
          tabIndex={-1}
        >
          {DAILY_GOAL_OPTIONS.map((goal) => (
            <option key={goal} value={goal}>
              {goal}개
            </option>
          ))}
        </select>
        <p className="muted" style={{ margin: 0 }}>
          하루에 완료하고 싶은 루틴 개수를 선택해 주세요.
        </p>
        <p className="muted" style={{ margin: 0 }}>
          목표는 홈의 진행률과 달력의 목표 달성률에 반영돼요.
        </p>
        <button type="button" className="btn settings-save-btn" disabled={saving || !snapshot} onClick={handleSaveLearningSettings}>
          설정 저장
        </button>
        {saveMessage && (
          <p className="settings-save-message" style={{ margin: 0 }}>
            {saveMessage}
          </p>
        )}
      </div>

      <div className="card integrated-settings-card">
        <h2 style={{ marginTop: 0 }}>통합 과정 학습 설정</h2>
        <p className="muted">오늘의 수업과 왕초보·회사·여행 과정에 적용됩니다.</p>
        <div className="integrated-settings-grid">
          <label>글자·문제 도움<select value={integratedSettings.learnerMode} onChange={(event) => changeLearning({ integrated: { learnerMode: event.target.value as IntegratedLearningSettings["learnerMode"], hasChosenStart: true } })}><option value="starter">처음 배워요 · 고르기부터</option><option value="reader">글자를 읽어요 · 20분 학습에 직접 입력 포함</option></select></label>
          <label>하루 학습 시간<select value={integratedSettings.dailyMinutes} onChange={(event) => changeLearning({ integrated: { dailyMinutes: Number(event.target.value) as 5 | 10 | 20 } })}><option value={5}>5분</option><option value={10}>10분</option><option value={20}>20분</option></select></label>
          <label>우선 학습 과정<select value={integratedSettings.preferredTrack} onChange={(event) => changeLearning({ integrated: { preferredTrack: event.target.value as IntegratedLearningSettings["preferredTrack"] } })}><option value="foundation">왕초보 기초</option><option value="work">회사 일본어</option><option value="travel">여행 일본어</option></select></label>
          <label>기본 음성 속도<select value={integratedSettings.audioRate} onChange={(event) => changeLearning({ integrated: { audioRate: Number(event.target.value) as 0.8 | 0.9 | 1 } })}><option value={0.8}>느리게</option><option value={0.9}>조금 느리게</option><option value={1}>보통</option></select></label>
        </div>
        <div className="integrated-settings-toggles">
          <label><input type="checkbox" checked={integratedSettings.showKoreanHint} onChange={(event) => changeLearning({ integrated: { showKoreanHint: event.target.checked } })} /> 수업의 한글 발음 보조 표시</label>
          <label><input type="checkbox" checked={integratedSettings.showReading} onChange={(event) => changeLearning({ integrated: { showReading: event.target.checked } })} /> 읽는 법 표시</label>
          <label><input type="checkbox" checked={integratedSettings.showMeaning} onChange={(event) => changeLearning({ integrated: { showMeaning: event.target.checked } })} /> 한국어 뜻 표시</label>
          <label><input type="checkbox" checked={integratedSettings.autoPlayDialogue} onChange={(event) => changeLearning({ integrated: { autoPlayDialogue: event.target.checked } })} /> 대화 자동 재생</label>
          <label><input type="checkbox" checked={integratedSettings.includeSpeaking} onChange={(event) => changeLearning({ integrated: { includeSpeaking: event.target.checked } })} /> 말하기 연습 포함</label>
        </div>
        <p className="muted">5분은 확인 3문제, 10분은 5문제, 20분은 8문제예요. 5분에는 별도 말하기 단계를 생략해요. 시간과 문제 방식은 새로 시작하는 수업에 적용되고, 이어하는 수업은 시작할 때의 분량을 유지해요.</p>
        <button type="button" className="btn settings-save-btn" disabled={saving || !snapshot} onClick={handleSaveLearningSettings}>학습 설정 저장</button>
        {saveMessage && <p role="status" className="settings-save-message">{saveMessage}</p>}
      </div>

      <div style={{ display: "grid", gap: "12px" }}>
        {(["kana", "words", "sentences", "speaking", "conversation"] as LearningSection[]).map((section) =>
          renderSectionCard(section),
        )}
      </div>

      <div className="card">
        <button type="button" className="btn btn-danger" disabled={saving || !snapshot} onClick={handleResetSettings} style={{ width: "100%" }}>
          학습 설정만 기본값으로
        </button>
      </div>
      <RecordResetPanel app="language" />
    </section>
  );
}

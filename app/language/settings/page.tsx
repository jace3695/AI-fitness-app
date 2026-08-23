"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_INTEGRATED_LEARNING_SETTINGS,
  loadIntegratedLearningSettings,
  saveIntegratedLearningSettings,
  type IntegratedLearningSettings,
} from "@/utils/integratedLearningSettings";

type LearningSection = "kana" | "words" | "sentences" | "speaking" | "conversation";

type CommonSectionSettings = {
  ttsRate: number;
  repeatCount: number;
  repeatDelayMs: number;
};

type DetailedSectionSettings = CommonSectionSettings & {
  showKoreanPronunciation: boolean;
  showReading: boolean;
};

type JapaneseAppSettings = {
  sections: {
    kana: CommonSectionSettings;
    words: DetailedSectionSettings;
    sentences: DetailedSectionSettings;
    speaking: DetailedSectionSettings;
    conversation: DetailedSectionSettings;
  };
};

const SETTINGS_STORAGE_KEY = "japaneseAppSettings";
const LEARNING_SETTINGS_STORAGE_KEY = "learningSettings";
const DAILY_GOAL_OPTIONS = [1, 2, 3, 4, 5] as const;

const SECTION_LABELS: Record<LearningSection, string> = {
  kana: "가나",
  words: "단어",
  sentences: "문장",
  speaking: "말하기",
  conversation: "AI 회화",
};

const DEFAULT_COMMON_SECTION: CommonSectionSettings = {
  ttsRate: 1,
  repeatCount: 1,
  repeatDelayMs: 500,
};

const DEFAULT_DETAILED_SECTION: DetailedSectionSettings = {
  ...DEFAULT_COMMON_SECTION,
  showKoreanPronunciation: true,
  showReading: true,
};

const DEFAULT_SETTINGS: JapaneseAppSettings = {
  sections: {
    kana: { ...DEFAULT_COMMON_SECTION },
    words: { ...DEFAULT_DETAILED_SECTION },
    sentences: { ...DEFAULT_DETAILED_SECTION },
    speaking: { ...DEFAULT_DETAILED_SECTION },
    conversation: { ...DEFAULT_DETAILED_SECTION },
  },
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

function isValidTtsRate(value: unknown): value is number {
  return value === 0.5 || value === 0.6 || value === 0.7 || value === 0.8 || value === 0.9 || value === 1 || value === 1.1 || value === 1.2;
}

function isValidRepeatCount(value: unknown): value is number {
  return value === 1 || value === 2 || value === 3;
}

function isValidRepeatDelayMs(value: unknown): value is number {
  return value === 0 || value === 300 || value === 500 || value === 1000 || value === 1500 || value === 2000;
}

function sanitizeCommonSection(value: unknown, fallback: CommonSectionSettings): CommonSectionSettings {
  const section = typeof value === "object" && value !== null ? (value as Partial<CommonSectionSettings>) : {};

  return {
    ttsRate: isValidTtsRate(section.ttsRate) ? section.ttsRate : fallback.ttsRate,
    repeatCount: isValidRepeatCount(section.repeatCount) ? section.repeatCount : fallback.repeatCount,
    repeatDelayMs: isValidRepeatDelayMs(section.repeatDelayMs) ? section.repeatDelayMs : fallback.repeatDelayMs,
  };
}

function sanitizeDetailedSection(value: unknown, fallback: DetailedSectionSettings): DetailedSectionSettings {
  const common = sanitizeCommonSection(value, fallback);
  const section = typeof value === "object" && value !== null ? (value as Partial<DetailedSectionSettings>) : {};

  return {
    ...common,
    showKoreanPronunciation:
      typeof section.showKoreanPronunciation === "boolean"
        ? section.showKoreanPronunciation
        : fallback.showKoreanPronunciation,
    showReading: typeof section.showReading === "boolean" ? section.showReading : fallback.showReading,
  };
}

function parseSettings(raw: string | null): JapaneseAppSettings {
  if (!raw) {
    return DEFAULT_SETTINGS;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return DEFAULT_SETTINGS;
    }

    const parsedObj = parsed as {
      sections?: Partial<JapaneseAppSettings["sections"]>;
      ttsRate?: number;
      repeatCount?: number;
      repeatDelayMs?: number;
      showKoreanPronunciation?: boolean;
      showReading?: boolean;
    };

    const legacyBaseCommon: CommonSectionSettings = {
      ttsRate: isValidTtsRate(parsedObj.ttsRate) ? parsedObj.ttsRate : DEFAULT_COMMON_SECTION.ttsRate,
      repeatCount: isValidRepeatCount(parsedObj.repeatCount) ? parsedObj.repeatCount : DEFAULT_COMMON_SECTION.repeatCount,
      repeatDelayMs: isValidRepeatDelayMs(parsedObj.repeatDelayMs)
        ? parsedObj.repeatDelayMs
        : DEFAULT_COMMON_SECTION.repeatDelayMs,
    };

    const legacyBaseDetailed: DetailedSectionSettings = {
      ...legacyBaseCommon,
      showKoreanPronunciation:
        typeof parsedObj.showKoreanPronunciation === "boolean"
          ? parsedObj.showKoreanPronunciation
          : DEFAULT_DETAILED_SECTION.showKoreanPronunciation,
      showReading: typeof parsedObj.showReading === "boolean" ? parsedObj.showReading : DEFAULT_DETAILED_SECTION.showReading,
    };

    const sections = parsedObj.sections;

    return {
      sections: {
        kana: sanitizeCommonSection(sections?.kana, legacyBaseCommon),
        words: sanitizeDetailedSection(sections?.words, legacyBaseDetailed),
        sentences: sanitizeDetailedSection(sections?.sentences, legacyBaseDetailed),
        speaking: sanitizeDetailedSection(sections?.speaking, legacyBaseDetailed),
        conversation: sanitizeDetailedSection(sections?.conversation, legacyBaseDetailed),
      },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<JapaneseAppSettings>(DEFAULT_SETTINGS);
  const [isSettingsLoaded, setIsSettingsLoaded] = useState(false);
  const [dailyGoalCount, setDailyGoalCount] = useState<number>(5);
  const [saveMessage, setSaveMessage] = useState("");
  const [integratedSettings, setIntegratedSettings] = useState<IntegratedLearningSettings>(DEFAULT_INTEGRATED_LEARNING_SETTINGS);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    const nextSettings = parseSettings(raw);
    setSettings(nextSettings);
    setIntegratedSettings(loadIntegratedLearningSettings());

    const learningSettingsRaw = window.localStorage.getItem(LEARNING_SETTINGS_STORAGE_KEY);
    if (learningSettingsRaw) {
      try {
        const parsed = JSON.parse(learningSettingsRaw) as unknown;
        if (
          typeof parsed === "object" &&
          parsed !== null &&
          "dailyGoalCount" in parsed &&
          DAILY_GOAL_OPTIONS.includes((parsed as { dailyGoalCount?: unknown }).dailyGoalCount as (typeof DAILY_GOAL_OPTIONS)[number])
        ) {
          setDailyGoalCount((parsed as { dailyGoalCount: number }).dailyGoalCount);
        }
      } catch {
        setDailyGoalCount(5);
      }
    }
    setIsSettingsLoaded(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isSettingsLoaded) return;

    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  }, [settings, isSettingsLoaded]);

  const updateCommonSetting = (
    section: LearningSection,
    key: keyof CommonSectionSettings,
    value: CommonSectionSettings[keyof CommonSectionSettings],
  ) => {
    setSettings((prev) => ({
      ...prev,
      sections: {
        ...prev.sections,
        [section]: {
          ...prev.sections[section],
          [key]: value,
        },
      },
    }));
  };

  const updateDetailedSetting = (
    section: Exclude<LearningSection, "kana">,
    key: keyof Pick<DetailedSectionSettings, "showKoreanPronunciation" | "showReading">,
    value: boolean,
  ) => {
    setSettings((prev) => ({
      ...prev,
      sections: {
        ...prev.sections,
        [section]: {
          ...prev.sections[section],
          [key]: value,
        },
      },
    }));
  };

  const handleResetSettings = () => {
    if (typeof window === "undefined") return;

    const shouldReset = window.confirm("모든 설정을 기본값으로 되돌릴까요?");
    if (!shouldReset) return;

    setSettings(DEFAULT_SETTINGS);
    setIntegratedSettings(DEFAULT_INTEGRATED_LEARNING_SETTINGS);
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(DEFAULT_SETTINGS));
    saveIntegratedLearningSettings(DEFAULT_INTEGRATED_LEARNING_SETTINGS);
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

  const handleSaveLearningSettings = () => {
    if (typeof window === "undefined") return;

    window.localStorage.setItem(
      LEARNING_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        dailyGoalCount,
      }),
    );
    saveIntegratedLearningSettings(integratedSettings);
    setSaveMessage("학습 목표와 통합 과정 설정이 저장됐어요.");
  };

  return (
    <section>
      <div className="page-header">
        <h1>학습 설정</h1>
        <p className="muted settings-page-subtitle" style={{ marginBottom: 0 }}>
          나에게 맞는 하루 학습 목표를 정하고, 매일 꾸준히 학습해 보세요.
        </p>
      </div>

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
                  setDailyGoalCount(goal);
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
            setDailyGoalCount(Number(event.target.value));
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
        <button type="button" className="btn settings-save-btn" onClick={handleSaveLearningSettings}>
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
          <label>하루 학습 시간<select value={integratedSettings.dailyMinutes} onChange={(event) => setIntegratedSettings((prev) => ({ ...prev, dailyMinutes: Number(event.target.value) as 5 | 10 | 20 }))}><option value={5}>5분</option><option value={10}>10분</option><option value={20}>20분</option></select></label>
          <label>우선 학습 과정<select value={integratedSettings.preferredTrack} onChange={(event) => setIntegratedSettings((prev) => ({ ...prev, preferredTrack: event.target.value as IntegratedLearningSettings["preferredTrack"] }))}><option value="foundation">왕초보 기초</option><option value="work">회사 일본어</option><option value="travel">여행 일본어</option></select></label>
          <label>기본 음성 속도<select value={integratedSettings.audioRate} onChange={(event) => setIntegratedSettings((prev) => ({ ...prev, audioRate: Number(event.target.value) as 0.8 | 0.9 | 1 }))}><option value={0.8}>느리게</option><option value={0.9}>조금 느리게</option><option value={1}>보통</option></select></label>
        </div>
        <div className="integrated-settings-toggles">
          <label><input type="checkbox" checked={integratedSettings.showReading} onChange={(event) => setIntegratedSettings((prev) => ({ ...prev, showReading: event.target.checked }))} /> 읽는 법 표시</label>
          <label><input type="checkbox" checked={integratedSettings.showMeaning} onChange={(event) => setIntegratedSettings((prev) => ({ ...prev, showMeaning: event.target.checked }))} /> 한국어 뜻 표시</label>
          <label><input type="checkbox" checked={integratedSettings.autoPlayDialogue} onChange={(event) => setIntegratedSettings((prev) => ({ ...prev, autoPlayDialogue: event.target.checked }))} /> 대화 자동 재생</label>
          <label><input type="checkbox" checked={integratedSettings.includeSpeaking} onChange={(event) => setIntegratedSettings((prev) => ({ ...prev, includeSpeaking: event.target.checked }))} /> 말하기 연습 포함</label>
        </div>
      </div>

      <div style={{ display: "grid", gap: "12px" }}>
        {(["kana", "words", "sentences", "speaking", "conversation"] as LearningSection[]).map((section) =>
          renderSectionCard(section),
        )}
      </div>

      <div className="card">
        <button type="button" className="btn btn-danger" onClick={handleResetSettings} style={{ width: "100%" }}>
          설정 초기화
        </button>
      </div>
    </section>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { useYeoniPreferences, updateYeoniPreferences } from "@/components/useYeoniPreferences";
import { CURRICULUM, TRACKS, getTrackLessons } from "@/data/curriculum";
import { CURRICULUM_PROGRESS_KEY, CURRICULUM_REVIEW_KEY, loadCurriculumProgress } from "@/utils/curriculumProgress";
import { loadIntegratedLearningSettings, type IntegratedLearningSettings } from "@/utils/integratedLearningSettings";
import { normalizeLearningSession } from "@/utils/learningSession";
import LearningCompanion from "./LearningCompanion";
import { useLanguageRecordSnapshot } from "./useLanguageRecordSnapshot";
import { isLanguageRecordContextCurrent, type LanguageRecordContext, type LanguageRecordSnapshot } from "@/app/data/languageCloudSync";
import { languageSettingsProjectionError, createLearningSettingsMutation, runLanguageSettingsMutation, advanceLanguageSettingsDraftSource, type LanguageSettingsMutation } from "@/app/data/languageSettingsMutations";
import { assertLanguageMutationUncommitted, getLanguageMutationOutcome, languageMutationError, requireLanguageMutationAcknowledged } from "@/app/data/languageRecordMutations";
import styles from "./learning-focus.module.css";

export default function LearningWelcome() {
  const router = useRouter();
  const preferences = useYeoniPreferences();
  const { context, snapshot, records, error: recordError } = useLanguageRecordSnapshot();
  const settingsError = languageSettingsProjectionError({ integratedLearningSettingsV1: records.integratedLearningSettingsV1 });
  const [, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  type Pending = { source: LanguageRecordSnapshot; context: LanguageRecordContext; patch: Partial<IntegratedLearningSettings>; intent?: LanguageSettingsMutation; href?: string; failed?: boolean; committed?: boolean; superseded?: Pending };
  const pending = useRef<Pending | null>(null);
  const retained = useRef<Pending | null>(null);
  const busy = useRef(false);
  const mounted = useRef(true);
  const latestContext = useRef(context);
  latestContext.current = context;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const settings = { ...loadIntegratedLearningSettings(records.integratedLearningSettingsV1), ...pending.current?.patch };
  const progress = loadCurriculumProgress(records[CURRICULUM_PROGRESS_KEY]);
  let dueCount = 0;
  let recordProjectionError = "";
  try {
    const raw: unknown = JSON.parse(records[CURRICULUM_PROGRESS_KEY] ?? "{}");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("unsupported");
  } catch { recordProjectionError = "일부 학습 기록을 읽지 못했어요. 원본은 보존했어요."; }
  try {
    const raw: unknown = JSON.parse(records[CURRICULUM_REVIEW_KEY] ?? "[]");
    if (!Array.isArray(raw)) throw new Error("unsupported");
    dueCount = raw.filter(item => item && typeof item === "object" && (!item.nextReviewAt || Date.parse(item.nextReviewAt) <= Date.now())).length;
  } catch { recordProjectionError = "일부 학습 기록을 읽지 못했어요. 원본은 보존했어요."; }
  const pump = async () => {
    if (busy.current) return;
    busy.current = true; setSaving(true);
    try {
      while ((retained.current || pending.current) && !(retained.current ?? pending.current)?.failed && mounted.current) {
        const draft = (retained.current ?? pending.current)!;
        retained.current = draft;
        try {
          const intent = draft.intent ?? createLearningSettingsMutation(draft.context, draft.source, { integrated: draft.patch });
          draft.intent = intent;
          const receipt = await runLanguageSettingsMutation(intent, latestContext.current);
          draft.committed = true;
          const result = requireLanguageMutationAcknowledged(receipt);
          if (!mounted.current || !result.source || latestContext.current !== result.source.context || !isLanguageRecordContextCurrent(result.source.context)) throw new Error("저장 뒤 계정 상태가 바뀌었어요. 선택은 유지했어요. 다시 확인해 주세요.");
          if (pending.current === draft) {
            pending.current = null; setRevision(value => value + 1); setError("");
            if (draft.href) router.push(draft.href);
          } else if (pending.current) {
            pending.current.source = advanceLanguageSettingsDraftSource(pending.current.source, { kind: "learning", patch: { integrated: pending.current.patch } }, intent, result); pending.current.failed = pending.current.context !== pending.current.source.context; if (pending.current.failed) setError("연결 상태가 바뀌어 새 선택을 자동 저장하지 않았어요. 학습 시간을 다시 선택해 주세요.");
          }
          retained.current = null;
        } catch (error) {
          draft.failed = true;
          if (pending.current) pending.current.failed = true;
          if (mounted.current) { setError(languageMutationError(error)); setRevision(value => value + 1); }
          break;
        }
      }
    } finally { busy.current = false; if (mounted.current) setSaving(false); }
  };
  const changeSettings = (patch: Partial<IntegratedLearningSettings>, href?: string) => {
    const previous = pending.current;
    const source = previous?.source ?? snapshot, boundContext = context;
    if (!source || !boundContext) { setError("학습 기록을 확인한 뒤 시작해 주세요."); return; }
    if (!busy.current && retained.current && !retained.current.intent) retained.current = null;
    pending.current = { source, context: boundContext, patch: { ...previous?.patch, ...patch }, href: href ?? previous?.href, failed: retained.current?.failed };
    setError(retained.current?.failed ? "앞선 저장 결과를 확인하거나, 현재 연결에서 새 저장을 요청해 주세요." : ""); setRevision(value => value + 1); void pump();
  };
  const saveChoiceAsNewAction = () => {
    if (!context || busy.current || !pending.current) return;
    if (retained.current?.intent && ["committed", "unknown"].includes(getLanguageMutationOutcome(retained.current.intent))) {
      retained.current.failed = false; pending.current.failed = false; void pump(); return;
    }
    try {
      const previous = pending.current;
      if (retained.current?.intent) assertLanguageMutationUncommitted(retained.current.intent);
      if (previous.intent) assertLanguageMutationUncommitted(previous.intent);
      const intent = createLearningSettingsMutation(context, previous.source, { integrated: previous.patch });
      pending.current = { ...previous, context, intent, failed: false, committed: false, superseded: retained.current ?? previous };
      retained.current = null; setError(""); setRevision(value => value + 1); void pump();
    } catch (error) { setError(languageMutationError(error)); }
  };
  const navigate = (href: string) => {
    if (pending.current) { pending.current.href = href; if (!pending.current.failed) void pump(); }
    else if (context && isLanguageRecordContextCurrent(context)) router.push(href);
  };
  if (!snapshot) return <section className={styles.welcome} role="status">{recordError || "오늘의 학습을 준비하고 있어요."}</section>;
  const firstTime = !settings.hasChosenStart && progress.completedLessonIds.length === 0 && !progress.kanaCompletedGroups?.length && !progress.activeSession;
  const track = progress.completedLessonIds.length ? progress.selectedTrack : settings.preferredTrack;
  const lessons = getTrackLessons(track);
  const draftLesson = CURRICULUM.find((lesson) => lesson.id === progress.activeSession?.lessonId);
  const draft = draftLesson && normalizeLearningSession(progress.activeSession, draftLesson);
  const nextLesson = draft ? draftLesson! : lessons.find((lesson) => !progress.completedLessonIds.includes(lesson.id)) ?? lessons[0];
  const startKana = !draft && settings.learnerMode === "starter" && !progress.kanaCompletedGroups?.length && progress.completedLessonIds.length === 0;
  const href = startKana ? "/language/start" : "/language/learn?lesson=" + nextLesson.id;
  const selectStart = (mode: "starter" | "reader") => {
    changeSettings({ learnerMode: mode, hasChosenStart: true }, mode === "starter" ? "/language/start" : "/language/learn?lesson=" + nextLesson.id);
  };
  const toggleMotion = () => {
    try { updateYeoniPreferences({ motion: preferences.motion === "off" ? "reactions" : "off" }); setError(""); }
    catch { setError("움직임 설정은 이 화면에 적용했지만 저장하지 못했어요. 기기의 저장 공간을 확인해 주세요."); }
  };
  return <section className={styles.welcome}>
    <div className={styles.welcomeHeader}>
      <h1>나의 일본어 연습</h1>
      {preferences.visible && <button type="button" className={styles.motionToggle} onClick={toggleMotion}
        aria-label={preferences.motion !== "off" ? "움직임 멈추기" : "움직임 켜기"}
        title={preferences.motion !== "off" ? "움직임 멈추기" : "움직임 켜기"}>
        {preferences.motion !== "off" ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
        <span>{preferences.motion !== "off" ? "움직임 멈추기" : "움직임 켜기"}</span>
      </button>}
    </div>
    <LearningCompanion hidden={!preferences.visible} motion="ambient">
      {firstTime ? "안녕! 나랑 첫 글자부터 배워봐요." : draft ? "하던 연습을 나랑 이어갈까요?" : "오늘도 나랑 조금씩 배워봐요!"}
    </LearningCompanion>
    <div className={styles.card}>
      <p className={styles.kicker}>오늘은 얼마나 해볼까요?</p>
      <div className={styles.timeChoices} aria-label="하루 학습 시간">{([5, 10, 20] as const).map((minutes) => <button key={minutes} type="button" aria-pressed={settings.dailyMinutes === minutes} onClick={() => changeSettings({ dailyMinutes: minutes })}>{minutes}분</button>)}</div>
      <p className={styles.muted}>{settings.dailyMinutes === 5 ? "표현 3개 · 확인 3문제 · 말하기는 다음에" : settings.dailyMinutes === 10 ? "표현 3개 · 확인 최대 5문제 · 짧게 따라 말하기" : "표현 3개 · 확인 8문제 · 반복해서 따라 말하기"}{!settings.includeSpeaking && settings.dailyMinutes !== 5 ? " · 말하기 제외 설정 적용" : ""}</p>
      {firstTime ? <><h2>어디서 시작할까요?</h2><div className={styles.options}><button className={styles.option} type="button" onClick={() => selectStart("starter")}><strong>글자를 처음 배워요</strong><span>あ・い・う・え・お부터 함께</span></button><button className={styles.option} type="button" onClick={() => selectStart("reader")}><strong>조금 읽을 수 있어요</strong><span>짧은 표현과 대화부터</span></button></div></> : <><p className={styles.kicker}>{startKana ? "가나 첫걸음" : TRACKS[nextLesson.track].title}</p><h2>{startKana ? "첫 다섯 글자와 친해지기" : nextLesson.title}</h2><div className={styles.row}><button type="button" onClick={() => navigate(href)} className={styles.primary}>{draft ? "하던 연습 이어하기" : startKana ? "첫 글자 배우기" : "오늘의 연습 시작"} →</button></div>{draft && <p className={styles.muted}>이어하는 수업은 시작할 때 정한 {draft.minutes}분 분량이에요. 바꾼 시간은 새 수업부터 적용돼요.</p>}</>}
      {dueCount > 0 && <div className={styles.row}><Link href="/language/review">먼저 복습할 문제 {dueCount}개</Link></div>}
      <p className={styles.muted}>해본 수업 {progress.completedLessonIds.length} / {CURRICULUM.length} · 점수와 복습은 ‘내 학습’에서 확인해요.</p>
      {saving && <p role="status">선택한 학습 설정을 저장하고 있어요.</p>}
      {(error || settingsError || recordProjectionError) && <p className={styles.error} role="alert">{error || settingsError || recordProjectionError}</p>}
      {pending.current?.failed && <button type="button" disabled={saving} onClick={saveChoiceAsNewAction}>현재 연결에서 선택 새로 저장</button>}
      {pending.current?.failed && <button type="button" disabled={saving} onClick={() => { if (pending.current) pending.current.failed = false; if (retained.current) retained.current.failed = false; void pump(); }}>선택 다시 저장</button>}
    </div>
  </section>;
}

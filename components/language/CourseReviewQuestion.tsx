"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useYeoniPreferences } from "@/components/useYeoniPreferences";
import { CURRICULUM } from "@/data/curriculum";
import type { CurriculumReviewItem } from "@/utils/curriculumProgress";
import { loadIntegratedLearningSettings } from "@/utils/integratedLearningSettings";
import type { ReviewObservation } from "@/utils/learningReview";
import type { LanguageRowHandle } from "@/app/data/languageRecordIdentity";
import type { ReviewScheduleInput } from "@/app/data/languageReviewMutations";
import { languageSettingsProjectionError } from "@/app/data/languageSettingsMutations";
import { useLanguageRecordSnapshot } from "./useLanguageRecordSnapshot";
import LearningCompanion from "./LearningCompanion";
import LearningQuestion from "./LearningQuestion";
import { useLearningAudio } from "./useLearningAudio";
import styles from "./learning-focus.module.css";

export default function CourseReviewQuestion({ item, handle, onDirty, pending, onSchedule, onDelete }: {
  item: CurriculumReviewItem; handle: LanguageRowHandle; onDirty: () => void; pending: boolean;
  onSchedule: (handle: LanguageRowHandle, input: ReviewScheduleInput) => Promise<boolean>;
  onDelete: (handle: LanguageRowHandle) => Promise<boolean>;
}) {
  const preferences = useYeoniPreferences();
  const { records } = useLanguageRecordSnapshot();
  const settings = loadIntegratedLearningSettings(records.integratedLearningSettingsV1);
  const settingsError = languageSettingsProjectionError({ integratedLearningSettingsV1: records.integratedLearningSettingsV1 });
  const original = useRef<{ item: CurriculumReviewItem; handle: LanguageRowHandle; mode: typeof settings.learnerMode } | null>(null);
  const [answer, setAnswer] = useState<boolean>();
  const [response, setResponse] = useState<string>();
  const [observation, setObservation] = useState<ReviewObservation>();
  const [neededHelp, setNeededHelp] = useState(false);
  const [hadWrong, setHadWrong] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const audio = useLearningAudio();
  const freezeSource = () => {
    if (!original.current) { original.current = { item, handle, mode: settings.learnerMode }; onDirty(); }
    return original.current;
  };
  const shown = original.current?.item ?? item;
  const lesson = CURRICULUM.find(entry => entry.id === shown.lessonId);
  const suffix = shown.id.slice(shown.lessonId.length + 1), index = /^\d+$/.test(suffix) ? Number(suffix) : -1;
  const quiz = lesson?.quiz[index];
  const save = async (correct: boolean) => {
    if (inFlight.current || pending) return;
    const source = freezeSource(); inFlight.current = true; setBusy(true); setError("");
    try {
      const saved = await onSchedule(source.handle, { correct, neededHelp: correct ? neededHelp : true, hadWrong, observation, response });
      if (!saved) setError("답과 선택은 보존했어요. 저장 안내를 확인해 주세요.");
    } catch { setError("복습 결과를 저장하지 못했어요. 답과 선택은 보존했어요."); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const remove = async () => {
    if (inFlight.current || pending) return;
    const source = freezeSource(); inFlight.current = true; setBusy(true);
    try { await onDelete(source.handle); } catch { setError("복습 항목을 삭제하지 못했어요. 입력은 보존했어요."); }
    finally { inFlight.current = false; setBusy(false); }
  };
  return <li className={styles.focus} onInputCapture={freezeSource}>
    <LearningCompanion hidden>정답을 보기 전에 한 번 생각해봐요. 어려우면 힌트나 수업을 다시 봐도 괜찮아요.</LearningCompanion>
    <div className={styles.card}><p className={styles.kicker}>{shown.lessonTitle} · 다시 만난 표현</p>
      <fieldset disabled={busy || pending} style={{ border: 0, padding: 0, margin: 0 }}>
        {lesson && quiz ? <LearningQuestion lesson={lesson} index={index} mode={original.current?.mode ?? settings.learnerMode} showCompanion={preferences.visible} answer={answer} response={response}
          onHint={() => { if (pending || inFlight.current) return; freezeSource(); setNeededHelp(true); }}
          onAnswer={(correct, value, observed) => { if (pending || inFlight.current) return; freezeSource(); setObservation(observed); audio.stop(); setAnswer(correct); setResponse(value); if (!correct) { setNeededHelp(true); setHadWrong(true); } }}
          onRetry={() => { if (pending || inFlight.current) return; freezeSource(); setAnswer(undefined); setResponse(undefined); }} play={text => void audio.play(text, settings.audioRate)} playing={audio.playing} />
          : <><h3>{shown.prompt}</h3><details><summary>기존 복습 설명 보기</summary><p>{shown.explanation}</p></details><p>이전 문제와 연결되지 않아 자동 채점은 하지 않아요. 수업에서 다시 확인해 주세요.</p></>}
      </fieldset>
      {audio.playing && <div className={styles.row}><button type="button" onClick={audio.stop}>■ 소리 멈추기</button></div>}
      {(audio.audioError || settingsError || error) && <p className={styles.error} role="alert">{audio.audioError || settingsError || error}</p>}
      <div className={styles.row}>
        {answer === true && <button type="button" disabled={busy || pending} className={styles.primary} onClick={() => void save(true)}>복습 결과 저장 · 다음 문제</button>}
        <button type="button" disabled={busy || pending} onClick={() => void save(false)}>내일 다시 볼래요</button>
        <Link href={`/language/learn?lesson=${shown.lessonId}`}>수업 다시 보기</Link>
      </div>
      <details><summary>이 복습 항목 관리</summary><div className={styles.row}><button type="button" disabled={busy || pending} onClick={() => void remove()}>복습에서 삭제</button></div></details>
    </div>
  </li>;
}

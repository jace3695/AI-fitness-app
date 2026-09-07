"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CURRICULUM } from "@/data/curriculum";
import type { CurriculumReviewItem } from "@/utils/curriculumProgress";
import { DEFAULT_INTEGRATED_LEARNING_SETTINGS, loadIntegratedLearningSettings } from "@/utils/integratedLearningSettings";
import LearningCompanion from "./LearningCompanion";
import LearningQuestion from "./LearningQuestion";
import { useLearningAudio } from "./useLearningAudio";
import styles from "./learning-focus.module.css";

export default function CourseReviewQuestion({ item, onSchedule, onDelete }: {
  item: CurriculumReviewItem; onSchedule: (id: string, correct: boolean, neededHelp: boolean, hadWrong: boolean) => void; onDelete: (id: string) => void;
}) {
  const [settings, setSettings] = useState(DEFAULT_INTEGRATED_LEARNING_SETTINGS);
  const [answer, setAnswer] = useState<boolean>();
  const [response, setResponse] = useState<string>();
  const [neededHelp, setNeededHelp] = useState(false);
  const [hadWrong, setHadWrong] = useState(false);
  const audio = useLearningAudio();
  useEffect(() => { setSettings(loadIntegratedLearningSettings()); }, []);
  const lesson = CURRICULUM.find((entry) => entry.id === item.lessonId);
  const suffix = item.id.slice(item.lessonId.length + 1);
  const index = /^\d+$/.test(suffix) ? Number(suffix) : -1;
  const quiz = lesson?.quiz[index];
  return <li className={styles.focus}>
    <LearningCompanion hidden={!settings.showCompanion} action={answer === true ? "celebrate" : answer === false ? "encourage" : "explain"} motionKey={item.id}>
      {answer === true ? "잘 떠올렸어요! 다음에도 함께 기억해봐요." : answer === false ? "괜찮아요. 힌트를 보고 한 번 더 해봐요." : "정답을 보기 전에 한 번 생각해봐요. 어려우면 힌트나 수업을 다시 봐도 괜찮아요."}
    </LearningCompanion>
    <div className={styles.card}><p className={styles.kicker}>{item.lessonTitle} · 다시 만난 표현</p>
      {lesson && quiz ? <LearningQuestion lesson={lesson} index={index} mode={settings.learnerMode} answer={answer} response={response}
        onHint={() => setNeededHelp(true)}
        onAnswer={(correct, value) => { audio.stop(); setAnswer(correct); setResponse(value); if (!correct) { setNeededHelp(true); setHadWrong(true); } }}
        onRetry={() => { setAnswer(undefined); setResponse(undefined); }} play={(text) => void audio.play(text, settings.audioRate)} playing={audio.playing} />
        : <><h3>{item.prompt}</h3><details><summary>기존 복습 설명 보기</summary><p>{item.explanation}</p></details><p>이전 문제와 연결되지 않아 자동 채점은 하지 않아요. 수업에서 다시 확인해 주세요.</p></>}
      {audio.playing && <div className={styles.row}><button type="button" onClick={audio.stop}>■ 소리 멈추기</button></div>}
      {audio.audioError && <p className={styles.error} role="status">{audio.audioError}</p>}
      <div className={styles.row}>
        {answer === true && <button type="button" className={styles.primary} onClick={() => onSchedule(item.id, true, neededHelp, hadWrong)}>복습 결과 저장 · 다음 문제</button>}
        <button type="button" onClick={() => onSchedule(item.id, false, true, hadWrong)}>내일 다시 볼래요</button>
        <Link href={`/language/learn?lesson=${item.lessonId}`}>수업 다시 보기</Link>
      </div>
      <details><summary>이 복습 항목 관리</summary><div className={styles.row}><button type="button" onClick={() => onDelete(item.id)}>복습에서 삭제</button></div></details>
    </div>
  </li>;
}

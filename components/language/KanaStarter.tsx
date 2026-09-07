"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { BEGINNER_KANA_GROUPS } from "@/data/beginnerKana";
import { loadCurriculumProgress, saveCurriculumProgress } from "@/utils/curriculumProgress";
import { loadIntegratedLearningSettings } from "@/utils/integratedLearningSettings";
import LearningCompanion from "./LearningCompanion";
import { useLearningAudio } from "./useLearningAudio";
import styles from "./learning-focus.module.css";

export default function KanaStarter() {
  const [groupIndex, setGroupIndex] = useState(0);
  const [letterIndex, setLetterIndex] = useState(0);
  const [mode, setMode] = useState<"learn" | "quiz" | "done">("learn");
  const [picked, setPicked] = useState<string | null>(null);
  const [showCompanion, setShowCompanion] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const feedbackRef = useRef<HTMLDivElement>(null);
  const guideRef = useRef<HTMLElement>(null);
  const audio = useLearningAudio();
  const group = BEGINNER_KANA_GROUPS[groupIndex];
  const chars = [...group.chars];
  const current = chars[letterIndex];
  const sound = group.sounds[letterIndex];
  const choices = [...chars.slice((letterIndex + 1) % chars.length), ...chars.slice(0, (letterIndex + 1) % chars.length)];
  useEffect(() => {
    if (picked) feedbackRef.current?.scrollIntoView({ block: "nearest", behavior: "instant" });
  }, [picked]);
  useEffect(() => {
    if (loaded && showCompanion && mode !== "quiz") {
      guideRef.current?.scrollIntoView({ block: "nearest", behavior: "instant" });
    }
  }, [loaded, showCompanion, group.id, mode, letterIndex]);
  useEffect(() => {
    const progress = loadCurriculumProgress();
    const next = BEGINNER_KANA_GROUPS.findIndex((item) => !progress.kanaCompletedGroups?.includes(item.id));
    setGroupIndex(Math.max(0, next));
    setShowCompanion(loadIntegratedLearningSettings().showCompanion);
    setLoaded(true);
  }, []);
  const next = () => {
    audio.stop();
    if (letterIndex < chars.length - 1) { setPicked(null); setLetterIndex((index) => index + 1); return; }
    if (mode === "learn") { setPicked(null); setLetterIndex(0); setMode("quiz"); return; }
    try {
      const progress = loadCurriculumProgress();
      saveCurriculumProgress({ ...progress, kanaCompletedGroups: [...new Set([...(progress.kanaCompletedGroups ?? []), group.id])] });
      setMode("done");
      setError("");
    } catch { setError("결과를 저장하지 못했어요. 다시 저장해 주세요."); }
  };
  if (!loaded) return <p role="status">첫 글자를 준비하고 있어요.</p>;
  return <section className={styles.focus}>
    <header className={styles.header}><Link href="/language" className={styles.back}>← 학습 홈</Link><h1>{group.title}</h1><span className={styles.pill}>가나 첫걸음</span></header>
    <LearningCompanion anchorRef={guideRef} hidden={!showCompanion || mode === "quiz"}
      action={mode === "done" ? "celebrate" : "explain"}
      motionKey={`${group.id}:${mode}:${letterIndex}`}>
      {mode === "done" ? "한 묶음을 해냈어요! 인사말을 배우러 가도 좋고, 다음 글자를 만나도 좋아요." : mode === "learn" ? "먼저 소리를 듣고 한 번 따라 해봐요. 전부 외우려고 애쓰지 않아도 돼요." : "방금 배운 글자를 찾아볼까요? 틀려도 다시 고르면 돼요."}
    </LearningCompanion>
    <div className={styles.card}>
      {mode === "done" ? <div className={styles.success}><span className={styles.successMark} aria-hidden="true">✓</span><h2>{chars.length}글자와 친해졌어요</h2><strong className={styles.japanese} lang="ja">{group.chars}</strong><p>다음에도 기억나는지 한 번 더 확인해봐요.</p><div className={styles.row}><Link href="/language/learn?lesson=f01" className={styles.primary}>이제 인사말 배워보기</Link>{groupIndex < BEGINNER_KANA_GROUPS.length - 1 && <button type="button" onClick={() => { audio.stop(); setGroupIndex((index) => index + 1); setLetterIndex(0); setMode("learn"); setPicked(null); }}>다음 글자 묶음</button>}<Link href="/language/kana">전체 가나·따라 쓰기</Link></div></div> : <><p className={styles.kicker}>{mode === "learn" ? "글자 만나기" : "글자 찾기"} {letterIndex + 1} / {chars.length}</p>
        {mode === "learn" ? <div className={styles.word}><strong className={styles.kanaLetter} lang="ja">{current}</strong><p className={styles.meaning}>{sound}</p><p className={styles.muted}>{current === "を" ? "글자 이름은 ‘wo’, 조사로 쓸 때는 ‘오’로 읽어요." : current === "ん" ? "다음 소리에 따라 달라지는 코 소리예요. 한글 ‘ㄴ’은 대략적인 도움말이에요." : "한글은 소리를 익히는 보조예요. 듣기도 함께 해봐요."}</p></div> : <><h2>‘{sound}’ 소리가 나는 글자는?</h2><div className={styles.choices}>{choices.map((char) => <button className={styles.choice} type="button" key={char} disabled={picked === current} data-result={char === picked ? char === current ? "correct" : "wrong" : undefined} onClick={() => setPicked(char)} lang="ja">{char}</button>)}</div>{picked && <div ref={feedbackRef} className={styles.feedback} data-correct={picked === current} role="status"><LearningCompanion hidden={!showCompanion} action={picked === current ? "celebrate" : "encourage"} motionKey={`${group.id}:${letterIndex}:${picked}`}>{picked === current ? "맞았어요! " + current + "예요." : "괜찮아요. ‘" + sound + "’는 " + current + "예요. 다시 골라봐요."}</LearningCompanion></div>}</>}
        <div className={styles.row}><button type="button" disabled={audio.playing} onClick={() => void audio.play(current, 0.8)}>▶ 소리 듣기</button></div></>}
    </div>
    {audio.playing && <div className={styles.row}><button type="button" onClick={audio.stop}>■ 소리 멈추기</button></div>}
    {audio.audioError && <p role="status" className={styles.error}>{audio.audioError}</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {mode !== "done" && <footer className={styles.actions}><button type="button" disabled={letterIndex === 0} onClick={() => { audio.stop(); setLetterIndex((index) => index - 1); setPicked(null); }}>이전</button><button type="button" className={styles.primary} disabled={mode === "quiz" && picked !== current} onClick={next}>{letterIndex < chars.length - 1 ? "다음 글자" : mode === "learn" ? "배운 글자 찾아보기" : "이번 묶음 저장하기"}</button></footer>}
    {mode !== "done" && <p className={styles.muted}>묶음을 끝내면 진도가 저장돼요. <Link href="/language/learn?lesson=f01">이미 읽을 수 있어요 · 인사말로 이동</Link></p>}
  </section>;
}

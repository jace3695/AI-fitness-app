"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ChangeEvent as ReactChangeEvent, type MouseEvent as ReactMouseEvent } from "react";
import AppIdentity from "../../components/AppIdentity";
import {
  DRAWING_CONTINUATION_WEEKS,
  DRAWING_DAILY_MINUTES,
  DRAWING_LESSONS,
  DRAWING_PROGRAM_ID,
  DRAWING_PROGRAM_TITLE,
  DRAWING_SKILL_LABELS,
  DRAWING_WEEK_SUMMARIES,
  drawingLessonDayFromMetrics,
  drawingScoresFromMetrics,
  getDrawingLesson,
  getNextDrawingDay,
  getDrawingRoutineId,
  getDrawingScoreAdvice,
  getDrawingSessionId,
  type DrawingScoreValues,
} from "../../data/drawingPractice";
import type { GrowthRoutineRow } from "../../data/growthPlatform";
import { DRAWING_ROUTINE_TITLE } from "../../data/growthRoutines";
import { supabase } from "../../lib/supabase";
import { getLocalDateKey } from "@/utils/dateKey";
import { useGrowthData } from "../useGrowthData";
import DrawingGuide from "./DrawingGuide";
import DrawingPracticeCanvas, { type DrawingPracticeCanvasHandle } from "./DrawingPracticeCanvas";
import "./drawing.css";

type PracticeMode = "paper" | "ipad";

type DrawingPracticeDraft = {
  selectedDay: number;
  mode: PracticeMode;
  guideVisible: boolean;
  startedAt: string | null;
  elapsedSeconds: number;
  checks: boolean[];
  attemptConfirmed: boolean;
  scores: (number | null)[];
  reflection: string;
  paperPhotoSkipped?: boolean;
};

const DRAWING_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function drawingImageType(file: File) {
  if (DRAWING_IMAGE_TYPES.has(file.type)) return file.type;
  if (file.type) return null;
  const extension = file.name.split(".").pop()?.toLowerCase();
  return extension === "jpg" || extension === "jpeg" ? "image/jpeg" : extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : null;
}

function drawingImageExtension(mimeType: string) {
  return mimeType === "image/jpeg" ? "jpg" : mimeType === "image/webp" ? "webp" : "png";
}

function readSessionValue(key: string) {
  try { return window.sessionStorage.getItem(key); } catch { return null; }
}

function writeSessionValue(key: string, value: string) {
  try { window.sessionStorage.setItem(key, value); } catch { /* Keep the current in-memory state. */ }
}

function removeSessionValue(key: string) {
  try { window.sessionStorage.removeItem(key); } catch { /* Nothing else to clear. */ }
}

function pendingCleanupKey(userId: string) {
  return `drawing-pending-storage-cleanup:${userId}`;
}

function rememberPendingCleanup(userId: string, path: string) {
  try {
    const key = pendingCleanupKey(userId);
    const parsed = JSON.parse(window.localStorage.getItem(key) || "[]") as unknown;
    const current = Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
    window.localStorage.setItem(key, JSON.stringify(Array.from(new Set([...current, path])).slice(-20)));
  } catch {
    // The next manual resource review can still reveal metadata rows; never expose another user's path.
  }
}

const SCORE_ITEMS = [
  ["배치", "물건의 위치와 여백", ["0점 · 하나 이상 화면 밖으로 잘리거나 겹침 순서가 반대", "1점 · 모두 들어오지만 중심 위치·간격 오차가 15% 초과", "2점 · 모두 들어오고 중심 위치·간격 오차가 15% 이하"]],
  ["비율", "주요 너비와 높이의 관계", ["0점 · 가로세로 비율 오차가 25% 초과", "1점 · 비율 오차가 13~25%", "2점 · 비율 오차가 12% 이하"]],
  ["선", "한 획의 방향과 덧그림 비율", ["0점 · 주요 선 절반보다 많이 세 번 이상 덧그림", "1점 · 주요 선의 25~50%를 덧그림", "2점 · 주요 선의 25% 미만만 덧그림"]],
  ["입체", "중심축·타원·상자의 방향", ["0점 · 형태 절반 이상에서 축·면 방향이 서로 다름", "1점 · 형태 절반 이상에서 방향이 맞음", "2점 · 형태 80% 이상에서 축·면 방향이 맞음"]],
  ["명암", "세 밝기와 한 방향의 빛", ["0점 · 세 밝기가 구별되지 않음", "1점 · 세 밝기는 보이나 물건 하나의 빛 방향이 다름", "2점 · 모든 물건에서 세 밝기와 빛 방향이 일치"]],
] as const;

type DrawingScoreLabel = (typeof SCORE_ITEMS)[number][0];

const SUPPLEMENT_EXERCISES: Record<DrawingScoreLabel, string> = {
  배치: "빈 사각형 3개에 큰 덩어리 세 개의 중심점과 간격만 표시하세요.",
  비율: "실제 물건 3개를 감싸는 사각형으로 그리고 가로:세로 비율을 적으세요.",
  선: "두 점을 먼저 찍고 가로·세로·양쪽 대각선을 각 5개씩 한 획으로 이으세요.",
  입체: "상자·원기둥·구를 중심축과 보이지 않는 면부터 각 3개씩 그리세요.",
  명암: "5단계 명암띠 2줄과 한 방향 빛을 받는 구 1개를 그리세요.",
};

const EMPTY_SCORES: [null, null, null, null, null] = [null, null, null, null, null];
const STEP_SECONDS = [60, 180, 480, 240, 120] as const;
const TOTAL_SECONDS = STEP_SECONDS.reduce((sum, seconds) => sum + seconds, 0);

export default function GrowthDrawingPage() {
  const growth = useGrowthData(null, DRAWING_PROGRAM_ID);
  const canvasRef = useRef<DrawingPracticeCanvasHandle>(null);
  const choseInitialDayRef = useRef(false);
  const formStateDayRef = useRef<number | null>(null);
  const restoredDraftDayRef = useRef<number | null>(null);
  const savingRef = useRef(false);
  const elapsedBeforeRunRef = useRef(0);
  const runStartedAtRef = useRef<number | null>(null);
  const [selectedDay, setSelectedDay] = useState(1);
  const [mode, setMode] = useState<PracticeMode>("paper");
  const [guideVisible, setGuideVisible] = useState(true);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [canvasDirty, setCanvasDirty] = useState(false);
  const [checks, setChecks] = useState([false, false, false]);
  const [attemptConfirmed, setAttemptConfirmed] = useState(false);
  const [scores, setScores] = useState<(number | null)[]>(EMPTY_SCORES);
  const [reflection, setReflection] = useState("");
  const [paperPhoto, setPaperPhoto] = useState<File | null>(null);
  const [paperPhotoSkipped, setPaperPhotoSkipped] = useState(false);
  const [drawingRoutineCloudId, setDrawingRoutineCloudId] = useState<string | null>(null);

  const completedDays = useMemo(() => new Set(
    growth.sessions
      .filter((session) => session.status === "completed")
      .map((session) => drawingLessonDayFromMetrics(session.metrics))
      .filter((day): day is number => day !== null),
  ), [growth.sessions]);
  const lesson = getDrawingLesson(selectedDay);
  const practiceDraftKey = `drawing-practice-state:${growth.user?.id ?? "signed-out"}:${DRAWING_PROGRAM_ID}`;
  const canvasDraftKey = `drawing-practice-draft:${growth.user?.id ?? "signed-out"}:${DRAWING_PROGRAM_ID}:${lesson.id}`;
  const completedSession = growth.sessions.find((session) => drawingLessonDayFromMetrics(session.metrics) === lesson.day && session.status === "completed") ?? null;
  const storedScores = useMemo(() => drawingScoresFromMetrics(completedSession?.metrics), [completedSession]);
  const growthUserId = growth.user?.id ?? null;
  const drawingRoutine = growth.routines.find((routine) => routine.id === drawingRoutineCloudId) ?? null;
  const completed = completedDays.has(lesson.day);
  const courseCompleted = completedDays.size >= DRAWING_LESSONS.length;
  const nextPracticeDay = getNextDrawingDay(completedDays);
  const practiceLocked = !completed && (courseCompleted || lesson.day !== nextPracticeDay);
  const completedMetrics = completedSession?.metrics && typeof completedSession.metrics === "object" ? completedSession.metrics as Record<string, unknown> : {};
  const completedMode = completedMetrics.mode === "ipad" ? "iPad" : "종이";
  const completedCheckedCount = Math.min(3, Math.max(0, Number(completedMetrics.checkedCount) || 0));
  const completedResourceId = typeof completedMetrics.resourceId === "string" ? completedMetrics.resourceId : null;
  const progress = Math.round((completedDays.size / DRAWING_LESSONS.length) * 100);
  const checkpointScores = useMemo(() => [1, 7, 14, 21, 27, 28].flatMap((day) => {
    const session = growth.sessions.find((item) => drawingLessonDayFromMetrics(item.metrics) === day && item.status === "completed");
    const values = drawingScoresFromMetrics(session?.metrics);
    return values ? [{ day, total: values.reduce((sum, score) => sum + score, 0) }] : [];
  }), [growth.sessions]);
  const firstScore = checkpointScores.find((item) => item.day === 1)?.total;
  const finalScore = checkpointScores.find((item) => item.day === 28)?.total;
  const scoresComplete = scores.every((score) => score !== null);
  const scoreAdvice = scoresComplete ? getDrawingScoreAdvice(scores as DrawingScoreValues, lesson.checkpointTarget ?? null, lesson.day === 28 ? firstScore : undefined) : null;
  const weakestSkills = scoresComplete
    ? SCORE_ITEMS.filter((_, index) => scores[index] === Math.min(...scores as number[])).map(([label]) => label)
    : [];
  const previousCheckpointSession = growth.sessions.find((session) => drawingLessonDayFromMetrics(session.metrics) === lesson.day - 1 && drawingScoresFromMetrics(session.metrics));
  const previousCheckpointScores = drawingScoresFromMetrics(previousCheckpointSession?.metrics);
  const previousAdvice = previousCheckpointScores ? getDrawingScoreAdvice(previousCheckpointScores, getDrawingLesson(lesson.day - 1).checkpointTarget ?? null) : null;
  const previousMetrics = previousCheckpointSession?.metrics && typeof previousCheckpointSession.metrics === "object" ? previousCheckpointSession.metrics as Record<string, unknown> : null;
  const previousStoredWeakest = Array.isArray(previousMetrics?.weakestSkills) ? previousMetrics.weakestSkills.find((skill): skill is string => typeof skill === "string") : null;
  const previousDerivedWeakest = previousCheckpointScores
    ? SCORE_ITEMS[previousCheckpointScores.indexOf(Math.min(...previousCheckpointScores))][0]
    : null;
  const previousWeakestSkill = previousStoredWeakest && previousStoredWeakest in SUPPLEMENT_EXERCISES
    ? previousStoredWeakest as DrawingScoreLabel
    : previousDerivedWeakest;
  const hasUnsavedPractice = !completed && (Boolean(startedAt) || canvasDirty || Boolean(paperPhoto) || paperPhotoSkipped || checks.some(Boolean) || scores.some((score) => score !== null) || Boolean(reflection.trim()));
  const growthLoading = growth.loading;
  const growthUser = growth.user;
  const setGrowthNotice = growth.setNotice;

  useEffect(() => {
    let active = true;
    setPaperPhoto(null);
    if (!growthUserId) {
      setDrawingRoutineCloudId(null);
      return () => { active = false; };
    }
    void getDrawingRoutineId(growthUserId).then((id) => {
      if (active) setDrawingRoutineCloudId(id);
    });
    return () => { active = false; };
  }, [growthUserId]);

  useEffect(() => {
    if (paperPhoto) return;
    const input = document.getElementById(`drawing-paper-photo-${lesson.id}`) as HTMLInputElement | null;
    if (input) input.value = "";
  }, [lesson.id, paperPhoto]);

  useEffect(() => {
    if (growthLoading || choseInitialDayRef.current || !growthUser) return;
    let draft: DrawingPracticeDraft | null = null;
    try {
      const raw = readSessionValue(practiceDraftKey);
      draft = raw ? JSON.parse(raw) as DrawingPracticeDraft : null;
    } catch {
      removeSessionValue(practiceDraftKey);
    }
    const draftDay = Number(draft?.selectedDay);
    const nextDay = getNextDrawingDay(completedDays);
    const validDraft = Number.isInteger(draftDay) && draftDay === nextDay && !completedDays.has(draftDay);
    if (draft && validDraft) {
      const restoredScores = Array.isArray(draft.scores) && draft.scores.length === 5 && draft.scores.every((score) => score === null || (Number.isInteger(score) && Number(score) >= 0 && Number(score) <= 2))
        ? draft.scores
        : EMPTY_SCORES;
      const restoredChecks = Array.isArray(draft.checks) && draft.checks.length === 3 && draft.checks.every((check) => typeof check === "boolean")
        ? draft.checks
        : [false, false, false];
      restoredDraftDayRef.current = draftDay;
      formStateDayRef.current = draftDay;
      setSelectedDay(draftDay);
      setMode(draft.mode === "ipad" ? "ipad" : "paper");
      setGuideVisible(draft.guideVisible !== false);
      setStartedAt(typeof draft.startedAt === "string" ? draft.startedAt : null);
      const restoredElapsed = Math.min(14_400, Math.max(0, Math.round(Number(draft.elapsedSeconds) || 0)));
      setElapsedSeconds(restoredElapsed);
      elapsedBeforeRunRef.current = restoredElapsed;
      runStartedAtRef.current = null;
      setTimerRunning(false);
      setChecks(restoredChecks);
      setAttemptConfirmed(draft.attemptConfirmed === true);
      setScores(restoredScores);
      setReflection(typeof draft.reflection === "string" ? draft.reflection.slice(0, 500) : "");
      setPaperPhotoSkipped(draft.paperPhotoSkipped === true);
      setGrowthNotice("임시 연습 상태를 복원했어요. 타이머는 멈춘 상태이니 준비되면 계속 눌러 주세요.");
    } else {
      if (draft) removeSessionValue(practiceDraftKey);
      formStateDayRef.current = nextDay;
      setSelectedDay(nextDay);
    }
    choseInitialDayRef.current = true;
  }, [completedDays, growthLoading, growthUser, practiceDraftKey, setGrowthNotice]);

  useEffect(() => {
    if (!timerRunning) return;
    const update = () => {
      const runStartedAt = runStartedAtRef.current;
      if (runStartedAt === null) return;
      setElapsedSeconds(elapsedBeforeRunRef.current + Math.floor((Date.now() - runStartedAt) / 1000));
    };
    update();
    const id = window.setInterval(update, 1000);
    return () => window.clearInterval(id);
  }, [timerRunning]);

  useEffect(() => {
    if (restoredDraftDayRef.current !== null) {
      if (restoredDraftDayRef.current === lesson.day) restoredDraftDayRef.current = null;
      return;
    }
    setScores(storedScores ?? EMPTY_SCORES);
  }, [lesson.day, storedScores]);

  useEffect(() => {
    if (!completedSession || formStateDayRef.current !== lesson.day) return;
    const metrics = completedSession.metrics && typeof completedSession.metrics === "object" ? completedSession.metrics as Record<string, unknown> : {};
    const savedChecks = Array.isArray(metrics.checks) && metrics.checks.length === 3 && metrics.checks.every((check) => typeof check === "boolean")
      ? metrics.checks as boolean[]
      : [true, true, true].map((_, index) => index < Math.min(3, Math.max(0, Number(metrics.checkedCount) || 0)));
    setChecks(savedChecks);
    setAttemptConfirmed(metrics.attemptConfirmed === true);
    setReflection(completedSession.memo ?? "");
  }, [completedSession, lesson.day]);

  useEffect(() => {
    if (growth.loading || !growth.user || !choseInitialDayRef.current) return;
    if (!hasUnsavedPractice) {
      removeSessionValue(practiceDraftKey);
      return;
    }
    const draft: DrawingPracticeDraft = {
      selectedDay: lesson.day,
      mode,
      guideVisible,
      startedAt,
      elapsedSeconds,
      checks,
      attemptConfirmed,
      scores,
      reflection,
      paperPhotoSkipped,
    };
    writeSessionValue(practiceDraftKey, JSON.stringify(draft));
  }, [attemptConfirmed, checks, elapsedSeconds, growth.loading, growth.user, guideVisible, hasUnsavedPractice, lesson.day, mode, paperPhotoSkipped, practiceDraftKey, reflection, scores, startedAt]);

  useEffect(() => {
    if (!hasUnsavedPractice) return;
    const protectDraft = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", protectDraft);
    return () => window.removeEventListener("beforeunload", protectDraft);
  }, [hasUnsavedPractice]);

  useEffect(() => {
    if (!supabase || !growth.user) return;
    const cleanupClient = supabase;
    const key = pendingCleanupKey(growth.user.id);
    let paths: string[] = [];
    try {
      const parsed = JSON.parse(window.localStorage.getItem(key) || "[]") as unknown;
      paths = Array.isArray(parsed)
        ? parsed.filter((path): path is string => typeof path === "string" && path.startsWith(`${growth.user!.id}/`)).slice(-20)
        : [];
    } catch {
      try { window.localStorage.removeItem(key); } catch { /* Retry is unavailable when storage is blocked. */ }
      return;
    }
    if (!paths.length) return;
    void cleanupClient.storage.from("growth-resources").remove(paths).then(({ error }) => {
      if (!error) {
        try {
          const parsed = JSON.parse(window.localStorage.getItem(key) || "[]") as unknown;
          const latest = Array.isArray(parsed) ? parsed.filter((path): path is string => typeof path === "string") : [];
          const removed = new Set(paths);
          const remaining = latest.filter((path) => !removed.has(path));
          if (remaining.length) window.localStorage.setItem(key, JSON.stringify(remaining.slice(-20)));
          else window.localStorage.removeItem(key);
        } catch { /* Cleanup itself already succeeded. */ }
      }
    });
  }, [growth.user]);

  const chooseDay = (day: number) => {
    if (growth.loading || saving || day === lesson.day) return;
    if (hasUnsavedPractice && !window.confirm("저장하지 않은 연습 상태가 있습니다. iPad 선은 회차별로 임시 보관되지만 타이머·체크·메모는 초기화되고 선택한 종이 사진은 다시 골라야 합니다. 다른 회차로 이동할까요?")) return;
    formStateDayRef.current = day;
    setSelectedDay(day);
    setStartedAt(null);
    setElapsedSeconds(0);
    setTimerRunning(false);
    elapsedBeforeRunRef.current = 0;
    runStartedAtRef.current = null;
    setChecks([false, false, false]);
    setAttemptConfirmed(false);
    setScores(EMPTY_SCORES);
    setCanvasDirty(false);
    setReflection("");
    setPaperPhoto(null);
    setPaperPhotoSkipped(false);
    setGuideVisible(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const guardNavigation = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    if (saving || growth.loading) {
      event.preventDefault();
      return;
    }
    if (hasUnsavedPractice && !window.confirm("현재 연습 상태는 이 탭에 임시 보관되고 타이머는 돌아올 때 멈춘 상태가 됩니다. 선택한 종이 사진은 보안상 다시 골라야 합니다. 이동할까요?")) event.preventDefault();
  };

  const chooseMode = (nextMode: PracticeMode) => {
    if (saving || growth.loading || completed || practiceLocked || nextMode === mode) return;
    if (mode === "ipad" && nextMode === "paper" && canvasDirty && !window.confirm("iPad 그림 초안은 다시 iPad 모드로 돌아오면 복원됩니다. 종이 모드로 완료하면 이 초안은 삭제됩니다. 바꿀까요?")) return;
    setMode(nextMode);
  };

  const choosePaperPhoto = (event: ReactChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0] ?? null;
    if (!selected) {
      setPaperPhoto(null);
      return;
    }
    if (!drawingImageType(selected)) {
      event.target.value = "";
      setPaperPhoto(null);
      growth.setNotice("종이 그림은 JPG·PNG·WebP 사진만 첨부할 수 있어요.");
      return;
    }
    if (selected.size > 10_485_760) {
      event.target.value = "";
      setPaperPhoto(null);
      growth.setNotice("그림 사진은 10MB 이하만 첨부할 수 있어요.");
      return;
    }
    setPaperPhoto(selected);
    setPaperPhotoSkipped(false);
    growth.setNotice("종이 그림 사진을 선택했어요. 완료할 때 비공개 자료함에 함께 저장합니다.");
  };

  const startTimer = () => {
    if (growth.loading || saving || completed || practiceLocked) return;
    const now = Date.now();
    if (!startedAt) setStartedAt(new Date(now).toISOString());
    runStartedAtRef.current = now;
    setTimerRunning(true);
  };

  const pauseTimer = () => {
    elapsedBeforeRunRef.current = elapsedSeconds;
    runStartedAtRef.current = null;
    setTimerRunning(false);
  };

  const ensureDrawingRoutine = async (): Promise<GrowthRoutineRow | null> => {
    if (drawingRoutine) return drawingRoutine;
    if (!supabase || !growth.user) return null;
    const routineId = await getDrawingRoutineId(growth.user.id);
    const current = await supabase.from("growth_routines").select("*").eq("user_id", growth.user.id).eq("id", routineId).maybeSingle();
    if (current.error) return null;
    if (current.data) return current.data as GrowthRoutineRow;
    const result = await growth.addRoutine({ id: routineId, title: DRAWING_ROUTINE_TITLE, category: "custom", targetMinutes: DRAWING_DAILY_MINUTES });
    if (!result.error && result.data) return result.data as GrowthRoutineRow;
    const existing = await supabase.from("growth_routines").select("*").eq("id", routineId).eq("user_id", growth.user.id).maybeSingle();
    return existing.data ? existing.data as GrowthRoutineRow : null;
  };

  const saveCompletion = async () => {
    if (!supabase || !growth.user || savingRef.current || completed || practiceLocked || !attemptConfirmed || elapsedSeconds < TOTAL_SECONDS) return;
    if (lesson.checkpoint && !scoresComplete) return;
    if (lesson.checkpoint && mode === "paper" && !paperPhoto && !paperPhotoSkipped) return;
    const drawingClient = supabase;
    savingRef.current = true;
    setSaving(true);
    growth.setNotice("");
    try {
      const savedLesson = lesson;
      const savedMode = mode;
      const savedElapsedSeconds = elapsedSeconds;
      const savedStartedAt = startedAt;
      const savedReflection = reflection.trim();
      const savedChecks = [...checks];
      const savedScores = scoresComplete ? [...scores] as DrawingScoreValues : null;
      const savedAdvice = scoreAdvice;
      const savedWeakestSkills = [...weakestSkills];
      const savedPaperPhoto = savedMode === "paper" ? paperPhoto : null;
      const savedPaperPhotoSkipped = savedMode === "paper" && Boolean(savedLesson.checkpoint) && !savedPaperPhoto && paperPhotoSkipped;
      const savedBlob = savedMode === "ipad" ? await canvasRef.current?.toBlob() : savedPaperPhoto;
      const savedMimeType = savedMode === "ipad" ? "image/png" : savedPaperPhoto ? drawingImageType(savedPaperPhoto) : null;
      const savedSessionId = await getDrawingSessionId(growth.user.id, savedLesson.id);
      if (savedMode === "ipad" && !savedBlob) {
        growth.setNotice("그림 이미지를 만들지 못했어요. 다시 시도해 주세요.");
        return;
      }
      if (savedPaperPhoto && !savedMimeType) {
        growth.setNotice("종이 그림 사진 형식을 확인하지 못했어요. JPG·PNG·WebP 사진을 다시 선택해 주세요.");
        return;
      }
      const routine = await ensureDrawingRoutine();
      if (!routine) {
        growth.setNotice("그림 연습 루틴을 준비하지 못했어요. 잠시 후 다시 시도해 주세요.");
        return;
      }
      const archiveRoutineIfFinished = async () => {
        if (!routine.enabled) return "already-hidden" as const;
        const finishedSessions = await drawingClient.from("growth_sessions").select("metrics").eq("user_id", growth.user!.id).eq("status", "completed").contains("metrics", { programId: DRAWING_PROGRAM_ID }).limit(100);
        if (finishedSessions.error) return "check-failed" as const;
        const finishedDays = new Set((finishedSessions.data ?? []).map((session) => drawingLessonDayFromMetrics(session.metrics)).filter((day): day is number => day !== null));
        if (finishedDays.size < DRAWING_LESSONS.length) return "not-finished" as const;
        const archived = await growth.updateRoutine(routine.id, { enabled: false });
        return archived.error ? "archive-failed" as const : "archived" as const;
      };

      const existing = await supabase.from("growth_sessions").select("id").eq("user_id", growth.user.id).eq("status", "completed").contains("metrics", { programId: DRAWING_PROGRAM_ID, lessonId: savedLesson.id }).limit(1).maybeSingle();
      if (existing.error) {
        growth.setNotice("기존 완료 기록을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.");
        return;
      }
      if (existing.data) {
        await growth.refresh();
        const archiveStatus = await archiveRoutineIfFinished();
        canvasRef.current?.discardDraft();
        removeSessionValue(canvasDraftKey);
        removeSessionValue(practiceDraftKey);
        setCanvasDirty(false);
        setPaperPhoto(null);
        setPaperPhotoSkipped(false);
        setStartedAt(null);
        setTimerRunning(false);
        growth.setNotice(archiveStatus === "archived"
          ? "28회 과정을 모두 마쳐 일일 루틴에서는 자동으로 보관했어요. 기록과 작품은 그대로 남습니다."
          : `${savedLesson.day}회차는 이미 완료로 저장되어 있어요.`);
        return;
      }

      let resourceId: string | null = null;
      let resourcePath: string | null = null;
      const cleanupCreatedResource = async () => {
        if (!resourcePath) return "clean" as const;
        if (resourceId) {
          const metadataDelete = await drawingClient.from("growth_resources").delete().eq("id", resourceId).eq("user_id", growth.user!.id);
          if (metadataDelete.error) {
            const metadataStillExists = await drawingClient.from("growth_resources").select("id").eq("id", resourceId).eq("user_id", growth.user!.id).maybeSingle();
            if (metadataStillExists.error || metadataStillExists.data) return "preserved" as const;
          }
        }
        const storageDelete = await drawingClient.storage.from("growth-resources").remove([resourcePath]);
        if (storageDelete.error) {
          rememberPendingCleanup(growth.user!.id, resourcePath);
          return "queued" as const;
        }
        return "clean" as const;
      };
      if (savedBlob && savedMimeType) {
        const date = getLocalDateKey();
        const extension = drawingImageExtension(savedMimeType);
        const path = `${growth.user.id}/${date}/drawing-day-${String(savedLesson.day).padStart(2, "0")}-${crypto.randomUUID()}.${extension}`;
        const upload = await supabase.storage.from("growth-resources").upload(path, savedBlob, { contentType: savedMimeType, upsert: false });
        if (upload.error) {
          const rollback = await drawingClient.storage.from("growth-resources").remove([path]);
          if (rollback.error) rememberPendingCleanup(growth.user.id, path);
          growth.setNotice(rollback.error
            ? "그림 이미지 저장에 실패했고 남은 업로드 정리는 다음 접속 때 다시 시도합니다. 초안은 유지했어요."
            : "그림 이미지를 비공개 자료함에 저장하지 못했어요. 초안은 유지했으니 다시 시도해 주세요.");
          return;
        }
        resourcePath = path;
        const resource = await supabase.from("growth_resources").insert({
          user_id: growth.user.id,
          routine_id: routine.id,
          title: `그림 기초 ${savedLesson.day}회차 · ${savedLesson.title}`,
          category: "custom",
          storage_path: path,
          mime_type: savedMimeType,
          size_bytes: savedBlob.size,
          classification: "direct",
          notes: savedReflection.slice(0, 500) || savedLesson.purpose,
        }).select("id").single();
        if (resource.error) {
          const committedResource = await drawingClient.from("growth_resources").select("id").eq("user_id", growth.user.id).eq("storage_path", path).maybeSingle();
          if (committedResource.error) {
            growth.setNotice("그림 정보 저장 결과를 확인하지 못해 업로드는 삭제하지 않았어요. 초안도 유지했으니 내 자료를 확인해 주세요.");
            return;
          }
          if (committedResource.data) {
            resourceId = committedResource.data.id;
          } else {
            const rollback = await drawingClient.storage.from("growth-resources").remove([path]);
            if (rollback.error) rememberPendingCleanup(growth.user.id, path);
            growth.setNotice(rollback.error
              ? "그림 정보 저장에 실패했고 업로드 정리를 다음 접속 때 다시 시도합니다. 초안은 유지했어요."
              : "그림 정보를 저장하지 못해 이미지 업로드를 되돌렸어요. 초안은 유지했어요.");
            return;
          }
        } else {
          resourceId = resource.data.id;
        }
      }

      const actualMinutes = Math.max(1, Math.min(240, Math.round(savedElapsedSeconds / 60)));
      const result = await growth.saveSession({
        id: savedSessionId,
        routineId: routine.id,
        sessionDate: getLocalDateKey(),
        status: "completed",
        plannedMinutes: DRAWING_DAILY_MINUTES,
        actualMinutes,
        memo: savedReflection || `${savedLesson.day}회차 ${savedLesson.title}`,
        source: "manual",
        metrics: {
          programId: DRAWING_PROGRAM_ID,
          lessonId: savedLesson.id,
          lessonDay: savedLesson.day,
          week: savedLesson.week,
          mode: savedMode,
          checkedCount: savedChecks.filter(Boolean).length,
          checks: savedChecks,
          attemptConfirmed: true,
          resourceId,
          artworkSkipped: savedPaperPhotoSkipped,
          scores: savedScores,
          scoreTotal: savedAdvice?.total ?? null,
          checkpointTarget: savedLesson.checkpointTarget ?? null,
          weakestSkills: savedWeakestSkills,
          supplementMinutes: savedAdvice?.supplementMinutes ?? null,
        },
        startedAt: savedStartedAt,
        endedAt: new Date().toISOString(),
      });
      if (result.error) {
        const committed = await supabase.from("growth_sessions").select("id,metrics").eq("id", savedSessionId).eq("user_id", growth.user.id).maybeSingle();
        if (committed.data) {
          const linkedResourceId = committed.data.metrics && typeof committed.data.metrics === "object"
            ? (committed.data.metrics as Record<string, unknown>).resourceId
            : null;
          await growth.refresh();
          const archiveStatus = await archiveRoutineIfFinished();
          canvasRef.current?.discardDraft();
          removeSessionValue(canvasDraftKey);
          removeSessionValue(practiceDraftKey);
          setCanvasDirty(false);
          setPaperPhoto(null);
          setPaperPhotoSkipped(false);
          setStartedAt(null);
          setTimerRunning(false);
          growth.setNotice(archiveStatus === "archived"
            ? "28회 과정을 모두 마쳐 일일 루틴에서는 자동으로 보관했어요. 기록과 작품은 그대로 남습니다."
            : resourceId && linkedResourceId !== resourceId
            ? `${savedLesson.day}회차는 다른 화면에서 이미 완료됐고, 방금 그림은 내 자료에 따로 보관했어요.`
            : `${savedLesson.day}회차는 다른 화면에서 이미 완료로 저장되어 있어요.`);
          return;
        }
        const cleanupStatus = committed.error ? "not-attempted" : await cleanupCreatedResource();
        growth.setNotice(committed.error
          ? "완료 저장 결과를 확인하지 못했어요. 그림 초안은 유지했으니 잠시 후 다시 확인해 주세요."
          : cleanupStatus === "preserved"
            ? "완료 기록은 저장되지 않았지만 그림은 삭제하지 않고 보존했어요. 초안도 유지했으니 내 자료를 확인해 주세요."
            : cleanupStatus === "queued"
              ? "완료 기록 저장에 실패했고 남은 업로드 정리는 다음 접속 때 자동 재시도합니다. 그림 초안은 유지했어요."
            : "완료 기록을 저장하지 못했어요. 그림 초안은 유지했으니 다시 시도해 주세요.");
        return;
      }
      canvasRef.current?.discardDraft();
      removeSessionValue(canvasDraftKey);
      removeSessionValue(practiceDraftKey);
      setCanvasDirty(false);
      setPaperPhoto(null);
      setPaperPhotoSkipped(false);
      setStartedAt(null);
      setTimerRunning(false);
      const archiveStatus = await archiveRoutineIfFinished();
      growth.setNotice(archiveStatus === "archived"
        ? "28회 과정을 모두 마쳐 일일 루틴에서는 자동으로 보관했어요. 기록과 작품은 그대로 남습니다."
        : archiveStatus === "archive-failed" || archiveStatus === "check-failed"
          ? `${savedLesson.day}회차를 완료로 저장했어요. 과정 보관 상태는 자기계발 홈에서 확인해 주세요.`
          : `${savedLesson.day}회차를 완료로 저장했어요. 그림의 예쁨이 아니라 실제 시도를 기록합니다.`);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const displayedSeconds = completedSession ? completedSession.actual_minutes * 60 : elapsedSeconds;
  const timeLabel = `${String(Math.floor(displayedSeconds / 60)).padStart(2, "0")}:${String(displayedSeconds % 60).padStart(2, "0")}`;
  let elapsedForStep = elapsedSeconds;
  let currentStepIndex = STEP_SECONDS.length - 1;
  for (let index = 0; index < STEP_SECONDS.length; index += 1) {
    if (elapsedForStep < STEP_SECONDS[index]) {
      currentStepIndex = index;
      break;
    }
    elapsedForStep -= STEP_SECONDS[index];
  }
  const currentStepRemaining = Math.max(0, STEP_SECONDS[currentStepIndex] - elapsedForStep);
  const checkpointRequired = Boolean(lesson.checkpoint && !scoresComplete);
  const canvasRequired = mode === "ipad" && !canvasDirty;
  const paperArchiveRequired = Boolean(lesson.checkpoint && mode === "paper" && !paperPhoto && !paperPhotoSkipped);
  const completionDisabled = saving || completed || practiceLocked || !startedAt || elapsedSeconds < TOTAL_SECONDS || !attemptConfirmed || checkpointRequired || canvasRequired || paperArchiveRequired || growth.loading;

  return <main className="min-h-dvh bg-[#f5f4fa] pb-12 text-[#242231]">
    <header className="app-module-header no-print"><div className="app-module-header-inner"><AppIdentity kind="growth" title="그림 기초 연습" subtitle="그림을 처음 시작하는 사람을 위한 28회 과정" /><Link href="/growth" onClick={guardNavigation} aria-disabled={saving || growth.loading} className="inline-flex min-h-11 items-center rounded-xl bg-gray-100 px-3 py-2 text-xs font-bold text-gray-600 aria-disabled:opacity-40">자기계발 홈</Link></div></header>

    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-9">
      <section className="drawing-print-sheet rounded-[30px] bg-gradient-to-br from-violet-900 via-violet-800 to-indigo-700 p-5 text-white shadow-[0_22px_55px_rgba(91,75,180,0.22)] sm:p-8">
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div><p className="text-sm font-bold text-white/90">{DRAWING_PROGRAM_TITLE}</p><h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">{lesson.day}회차. {lesson.title}</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-white/90">{lesson.purpose}</p></div>
          <div className="min-w-44 rounded-2xl bg-black/20 p-4 ring-1 ring-white/30"><div className="flex items-end justify-between"><span className="text-xs font-bold text-white/90">전체 진도</span><strong className="text-2xl">{completedDays.size}/28</strong></div><div role="progressbar" aria-label="28회 그림 기초 과정 진도" aria-valuemin={0} aria-valuemax={28} aria-valuenow={completedDays.size} className="mt-3 h-2 overflow-hidden rounded-full bg-white/30"><div className="h-full rounded-full bg-white" style={{ width: `${progress}%` }} /></div><p className="mt-2 text-right text-xs text-white/90">{progress}% 완료</p></div>
        </div>
      </section>

      <nav aria-label="그림 연습 주차 선택" className="no-print mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
        {DRAWING_WEEK_SUMMARIES.map((week) => {
          const active = lesson.week === week.week;
          const completeCount = DRAWING_LESSONS.filter((item) => item.week === week.week && completedDays.has(item.day)).length;
          return <button key={week.week} type="button" disabled={growth.loading || saving} onClick={() => chooseDay((week.week - 1) * 7 + 1)} aria-current={active ? "step" : undefined} className={`min-h-16 rounded-2xl px-4 py-3 text-left ring-1 disabled:opacity-40 ${active ? "bg-violet-700 text-white ring-violet-700" : "bg-white text-gray-700 ring-gray-100"}`}><span className={`text-xs font-bold ${active ? "text-white/90" : "text-gray-500"}`}>{week.week}주차 · {completeCount}/7</span><strong className="mt-1 block text-sm">{week.title}</strong></button>;
        })}
      </nav>

      <section className="no-print mt-4 rounded-[26px] bg-white p-4 shadow-sm sm:p-5">
        <div className="flex gap-2 overflow-x-auto pb-1" aria-label={`${lesson.week}주차 회차 선택`}>
          {DRAWING_LESSONS.filter((item) => item.week === lesson.week).map((item) => <button key={item.id} type="button" disabled={growth.loading || saving} onClick={() => chooseDay(item.day)} aria-current={item.day === lesson.day ? "step" : undefined} className={`relative min-h-12 min-w-20 rounded-xl px-3 text-xs font-bold disabled:opacity-40 ${item.day === lesson.day ? "bg-violet-600 text-white" : "bg-gray-50 text-gray-600"}`}>{completedDays.has(item.day) ? <><span aria-hidden="true" className="mr-1 text-emerald-500">✓</span><span className="sr-only">완료한 </span></> : null}{item.day}회</button>)}
        </div>
      </section>

      {practiceLocked ? <section role="status" className="no-print mt-4 flex flex-col gap-3 rounded-2xl bg-amber-50 p-4 text-sm leading-6 text-amber-950 ring-1 ring-amber-200 sm:flex-row sm:items-center sm:justify-between"><p><strong>{lesson.day}회차는 미리 보는 중입니다.</strong><br />기준 그림과 점수의 순서가 뒤바뀌지 않도록 {nextPracticeDay}회차부터 완료해 주세요.</p><button type="button" onClick={() => chooseDay(nextPracticeDay)} className="min-h-11 shrink-0 rounded-xl bg-amber-800 px-4 text-xs font-bold text-white">{nextPracticeDay}회차로 이동</button></section> : null}

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.08fr)_minmax(340px,.92fr)]">
        <aside className="space-y-5 lg:col-start-2 lg:row-start-1">
          <section className="no-print rounded-[28px] bg-[#242231] p-5 text-white shadow-lg sm:p-6 lg:sticky lg:top-5">
            <p className="text-xs font-bold text-violet-300">오늘은 예쁨이 아니라 시도를 기록해요</p><div className="mt-3 flex items-end justify-between"><div><h2 className="text-2xl font-bold">{startedAt ? timerRunning ? "연습 진행 중" : "연습 잠시 멈춤" : completed ? "오늘 과제 완료" : "준비됐어요"}</h2><p className="mt-1 text-sm text-white/60">목표 {DRAWING_DAILY_MINUTES}분 · 실제 시간 저장</p></div><strong aria-label={`기록 시간 ${Math.floor(displayedSeconds / 60)}분 ${displayedSeconds % 60}초`} className="font-mono text-3xl">{timeLabel}</strong></div>
            {completedSession ? <div className="mt-4 rounded-2xl bg-emerald-400/15 p-4 text-sm leading-6 text-emerald-100"><strong>{completedSession.session_date} 완료 기록</strong><p>{completedMode} · {completedSession.actual_minutes}분 · 자기 확인 {completedCheckedCount}/3</p>{completedResourceId ? <Link href="/growth/resources" className="mt-2 inline-flex min-h-11 items-center rounded-xl bg-white px-3 text-xs font-bold text-[#242231]">저장한 그림 보기 →</Link> : null}</div> : null}
            {!startedAt && !completed ? practiceLocked
              ? <button type="button" onClick={() => chooseDay(nextPracticeDay)} className="mt-5 min-h-14 w-full rounded-2xl bg-amber-500 text-base font-black text-[#242231]">먼저 {nextPracticeDay}회차 시작</button>
              : <button type="button" disabled={saving || growth.loading} onClick={startTimer} className="mt-5 min-h-14 w-full rounded-2xl bg-violet-700 text-base font-black text-white disabled:opacity-40">18분 연습 시작</button> : null}
            {startedAt ? <div className="mt-5 rounded-2xl bg-white/10 p-4 text-sm leading-6 text-white/80"><p aria-live="polite" className="font-bold text-white">{elapsedSeconds >= TOTAL_SECONDS ? "18분 패턴 완료 · 추가 연습 중" : `${currentStepIndex + 1}단계 · ${lesson.steps[currentStepIndex].label}`}</p><p className="mt-1">{elapsedSeconds >= TOTAL_SECONDS ? "완료를 저장할 때까지 추가로 연습한 시간도 실제 기록에 포함됩니다." : `이 단계 남은 시간 ${Math.floor(currentStepRemaining / 60)}분 ${currentStepRemaining % 60}초`}</p><button type="button" onClick={timerRunning ? pauseTimer : startTimer} disabled={saving || growth.loading || completed} className="mt-3 min-h-11 rounded-xl bg-white px-4 text-xs font-bold text-[#242231] disabled:opacity-40">{timerRunning ? "타이머 잠시 멈춤" : "타이머 계속"}</button></div> : null}
          </section>
        </aside>

        <div className="space-y-5 lg:col-start-1 lg:row-span-2 lg:row-start-1">
          {startedAt && !completed ? <div className="no-print sticky top-2 z-20 flex items-center justify-between gap-3 rounded-2xl bg-[#242231] px-4 py-3 text-sm text-white shadow-lg lg:hidden"><div><strong className="font-mono text-lg">{timeLabel}</strong><span className="ml-2 text-white/70">{elapsedSeconds >= TOTAL_SECONDS ? "패턴 완료" : `${currentStepIndex + 1}단계 · ${lesson.steps[currentStepIndex].label}`}</span></div><button type="button" disabled={saving || growth.loading || completed} onClick={timerRunning ? pauseTimer : startTimer} className="min-h-11 rounded-xl bg-white px-3 text-xs font-bold text-[#242231] disabled:opacity-40">{timerRunning ? "멈춤" : "계속"}</button></div> : null}
          <section className="drawing-print-sheet rounded-[28px] bg-white p-4 shadow-sm sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold text-violet-600">{lesson.week}주차 · {DRAWING_SKILL_LABELS[lesson.skill]}</p><h2 className="mt-1 text-2xl font-bold">오늘의 직접 제작 가이드</h2><p className="mt-2 text-sm text-gray-500">{lesson.repetitions} · 약 {DRAWING_DAILY_MINUTES}분</p></div><div className="no-print flex gap-2"><button type="button" onClick={() => setGuideVisible((value) => !value)} aria-expanded={guideVisible} aria-controls="drawing-practice-guide" className="min-h-11 rounded-xl bg-violet-50 px-4 text-xs font-bold text-violet-700">{guideVisible ? "가이드 숨기기" : "가이드 다시 보기"}</button><button type="button" onClick={() => window.print()} className="min-h-11 rounded-xl bg-gray-100 px-4 text-xs font-bold text-gray-700">A4 인쇄</button></div></div>
            <div id="drawing-practice-guide" className="mt-4"><DrawingGuide kind={lesson.guide} hidden={!guideVisible} /></div>
            <p className="mt-3 rounded-xl bg-violet-50 px-3 py-2 text-xs leading-5 text-violet-800">모든 가이드는 이 과정용으로 직접 만든 도형입니다. 회색 선은 따라가기용이며, 숨긴 뒤 같은 과제를 다시 그리는 것이 핵심입니다.</p>
          </section>

          <section className="drawing-print-sheet rounded-[28px] bg-white p-4 shadow-sm sm:p-6">
            <h2 className="text-xl font-bold">매일 같은 18분 패턴</h2><p className="mt-2 text-sm leading-6 text-gray-500">순서를 바꾸지 마세요. 한 번에 여러 기술을 잘하려 하지 않고 오늘 기술 하나만 연습합니다.</p>
            <ol className="mt-5 space-y-3">{lesson.steps.map((step, index) => <li key={step.label} className="grid grid-cols-[44px_1fr] gap-3 rounded-2xl bg-gray-50 p-3 sm:p-4"><span className="grid h-11 w-11 place-items-center rounded-full bg-violet-600 text-sm font-black text-white">{step.minutes}분</span><div><strong className="text-sm">{index + 1}. {step.label}</strong><p className="mt-1 text-sm leading-6 text-gray-600">{step.instruction}</p></div></li>)}</ol>
            <div className="mt-4 grid gap-3 sm:grid-cols-2"><div className="rounded-2xl bg-red-50 p-4"><p className="text-xs font-bold text-red-700">자주 생기는 문제</p><p className="mt-2 text-sm leading-6 text-red-950">{lesson.mistake}</p></div><div className="rounded-2xl bg-emerald-50 p-4"><p className="text-xs font-bold text-emerald-700">오늘 고칠 방법</p><p className="mt-2 text-sm leading-6 text-emerald-950">{lesson.correction}</p></div></div>
            {lesson.checkpoint && <p className="mt-4 rounded-2xl bg-amber-50 p-4 text-sm font-semibold leading-6 text-amber-900">확인 기준: {lesson.checkpoint}</p>}
          </section>

          <section className="print-only drawing-blank-sheet" aria-label="인쇄용 빈 연습 공간"><header><strong>{lesson.day}회 · {lesson.title}</strong><span>날짜: ____________</span></header><h2>가이드 따라 하기</h2><div /><h2>가이드 없이 다시 그리기</h2><div /><h2>가장 큰 오류 하나와 재도전</h2><div /></section>

          <section className="no-print rounded-[28px] bg-white p-4 shadow-sm sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs font-bold text-violet-600">연습 도구</p><h2 className="mt-1 text-xl font-bold">어디에 그릴까요?</h2></div><div className="grid grid-cols-2 gap-2"><button type="button" disabled={saving || growth.loading || completed || practiceLocked} onClick={() => chooseMode("paper")} aria-pressed={mode === "paper"} className={`min-h-12 rounded-xl px-4 text-sm font-bold disabled:opacity-40 ${mode === "paper" ? "bg-violet-600 text-white" : "bg-gray-100 text-gray-600"}`}>종이에 그리기</button><button type="button" disabled={saving || growth.loading || completed || practiceLocked} onClick={() => chooseMode("ipad")} aria-pressed={mode === "ipad"} className={`min-h-12 rounded-xl px-4 text-sm font-bold disabled:opacity-40 ${mode === "ipad" ? "bg-violet-600 text-white" : "bg-gray-100 text-gray-600"}`}>iPad에 그리기</button></div></div>
            {mode === "paper" ? <div className="mt-4 rounded-2xl bg-amber-50 p-4 text-sm leading-6 text-amber-950"><strong>종이 사용 순서</strong><p className="mt-1">A4로 인쇄하거나 빈 종이를 준비하세요. 1·7·14·21·27·28회는 전후 비교용 체크포인트이므로 완료 전에 사진 보관 여부를 직접 확인합니다.</p>{lesson.checkpoint && !completed ? <div className="mt-4 rounded-xl bg-white p-3 ring-1 ring-amber-200"><label className="block text-xs font-bold text-amber-900" htmlFor={`drawing-paper-photo-${lesson.id}`}>이 회차 종이 그림 사진 · JPG/PNG/WebP, 최대 10MB</label><input key={lesson.id} id={`drawing-paper-photo-${lesson.id}`} type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" disabled={saving || growth.loading || practiceLocked} onChange={choosePaperPhoto} className="mt-2 min-h-12 w-full rounded-xl bg-amber-50 p-3 text-xs ring-1 ring-amber-200 file:mr-3 file:rounded-lg file:border-0 file:bg-amber-800 file:px-3 file:py-2 file:font-bold file:text-white disabled:opacity-40" />{paperPhoto ? <div className="mt-2 flex items-center justify-between gap-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800"><span className="min-w-0 truncate">선택됨: {paperPhoto.name}</span><button type="button" disabled={saving} onClick={() => setPaperPhoto(null)} className="min-h-10 shrink-0 rounded-lg bg-white px-3 font-bold ring-1 ring-emerald-200">선택 취소</button></div> : <label className="mt-3 flex min-h-12 cursor-pointer items-center gap-3 rounded-xl bg-amber-50 px-3 py-2 text-xs leading-5"><input type="checkbox" checked={paperPhotoSkipped} disabled={saving || growth.loading || practiceLocked} onChange={(event) => setPaperPhotoSkipped(event.target.checked)} className="h-5 w-5 shrink-0 accent-amber-800" /><span><strong>지금은 사진 없이 완료</strong><br />종이 원본을 직접 보관하며, 잃어버리면 28회차 전후 비교가 어려워질 수 있음을 확인합니다.</span></label>}</div> : <Link href="/growth/resources" onClick={guardNavigation} aria-disabled={saving || growth.loading} className="mt-3 inline-flex min-h-11 items-center rounded-xl bg-white px-4 text-xs font-bold text-amber-800 ring-1 ring-amber-200 aria-disabled:opacity-40">선택한 그림을 내 자료에 보관 →</Link>}</div> : <div className="mt-4"><DrawingPracticeCanvas key={`${growth.user?.id ?? "loading"}:${lesson.id}`} ref={canvasRef} guide={<DrawingGuide kind={lesson.guide} transparent />} guideVisible={guideVisible} onToggleGuide={() => setGuideVisible((value) => !value)} draftKey={canvasDraftKey} disabled={saving || growth.loading || completed || practiceLocked} onDirtyChange={setCanvasDirty} /></div>}
          </section>

          <section className="no-print rounded-[28px] bg-white p-4 shadow-sm sm:p-6"><details open={Boolean(lesson.checkpoint)}><summary className="flex min-h-11 cursor-pointer list-none items-center text-lg font-bold">10점 채점 기준 <span className="ml-1 text-sm text-violet-600">배치·비율·선·입체·명암</span></summary><p className="mt-3 text-sm leading-6 text-gray-500">각 항목을 0점(아직 어려움), 1점(부분 성공), 2점(대체로 안정)으로 기록합니다. 점수는 재능 평가가 아니라 다음 보충 기술을 고르는 표시입니다.</p><div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{SCORE_ITEMS.map(([title, description, levels]) => <article key={title} className="rounded-2xl bg-gray-50 p-4"><strong>{title} · {description}</strong><ol className="mt-2 space-y-1 text-xs leading-5 text-gray-600">{levels.map((level) => <li key={level}>{level}</li>)}</ol></article>)}</div>{checkpointScores.length ? <div className="mt-5 overflow-x-auto"><table className="w-full min-w-[420px] text-left text-sm"><caption className="mb-2 text-left font-bold">저장된 체크포인트 점수</caption><thead><tr className="border-b border-gray-200 text-xs text-gray-500"><th className="px-2 py-2">회차</th>{checkpointScores.map((item) => <th key={item.day} className="px-2 py-2">{item.day}회</th>)}</tr></thead><tbody><tr><th className="px-2 py-3">합계</th>{checkpointScores.map((item) => <td key={item.day} className="px-2 py-3 font-bold">{item.total}/10</td>)}</tr></tbody></table>{firstScore !== undefined && finalScore !== undefined ? <p className="mt-3 rounded-xl bg-violet-50 px-3 py-2 text-sm font-bold text-violet-800">1회차 대비 28회차 변화: {finalScore - firstScore >= 0 ? "+" : ""}{finalScore - firstScore}점</p> : null}</div> : null}</details></section>
        </div>

        <aside className="no-print lg:col-start-2 lg:row-start-2">
          <section className="rounded-[28px] bg-[#242231] p-5 text-white shadow-lg sm:p-6">
            <p className="text-xs font-bold text-violet-300">연습을 마친 뒤 기록하세요</p><h2 className="mt-1 text-xl font-bold">자기 확인과 완료 저장</h2>
            {previousAdvice?.supplementMinutes && previousWeakestSkill ? <div className="mt-4 rounded-2xl bg-violet-400/15 p-4 text-sm leading-6 text-violet-100"><strong>이전 점수 보충 · {previousWeakestSkill} {previousAdvice.supplementMinutes}분</strong><p className="mt-1">{SUPPLEMENT_EXERCISES[previousWeakestSkill]}{previousAdvice.supplementMinutes === 5 ? " 끝나면 가장 어긋난 하나를 같은 방법으로 다시 그리세요." : ""}</p></div> : null}
            <fieldset className="mt-5" disabled={saving || growth.loading || completed || practiceLocked}><legend className="font-bold">내가 직접 확인할 3가지</legend><div className="mt-3 space-y-2">{lesson.checks.map((check, index) => <label key={check} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl bg-white/10 px-3 py-2 text-sm leading-5"><input type="checkbox" checked={checks[index]} onChange={(event) => setChecks((current) => current.map((value, checkIndex) => checkIndex === index ? event.target.checked : value))} className="h-5 w-5 accent-violet-400" /><span>{check}</span></label>)}</div></fieldset>
            {lesson.checkpoint ? <fieldset className="mt-5" disabled={saving || growth.loading || completed || practiceLocked}><legend className="font-bold">체크포인트 10점 기록 <span className="text-xs font-normal text-white/60">(성공 여부와 무관)</span></legend><div className="mt-3 space-y-2">{SCORE_ITEMS.map(([label], index) => <label key={label} className="grid min-h-12 grid-cols-[1fr_88px] items-center gap-3 rounded-xl bg-white/10 px-3 py-2 text-sm"><span>{label}</span><select aria-label={`${label} 점수`} value={scores[index] ?? ""} onChange={(event) => setScores((current) => current.map((score, scoreIndex) => scoreIndex === index ? Number(event.target.value) : score))} className="min-h-11 rounded-lg bg-white px-2 font-bold text-[#242231]"><option value="" disabled>선택</option><option value="0">0점</option><option value="1">1점</option><option value="2">2점</option></select></label>)}</div><p className="mt-3 text-sm font-bold text-violet-200">합계 {scoreAdvice ? `${scoreAdvice.total}/10 · ${scoreAdvice.label}` : "점수를 모두 선택해 주세요"}</p></fieldset> : null}
            <label className="mt-4 block text-sm font-bold">오늘 가장 큰 오류 또는 좋아진 점<textarea value={reflection} disabled={saving || growth.loading || completed || practiceLocked} onChange={(event) => setReflection(event.target.value)} maxLength={500} placeholder="예: 컵 높이는 좋아졌고 입구 타원이 아직 기울어요" className="mt-2 min-h-24 w-full rounded-2xl border-0 bg-white/10 p-3 text-sm font-normal text-white outline-none placeholder:text-white/35 ring-1 ring-white/15 focus-visible:ring-2 focus-visible:ring-violet-300 disabled:opacity-50" /></label>
            <label className="mt-4 flex min-h-12 cursor-pointer items-center gap-3 rounded-xl bg-white/10 px-3 py-2 text-sm leading-5"><input type="checkbox" checked={attemptConfirmed} disabled={saving || growth.loading || completed || practiceLocked} onChange={(event) => setAttemptConfirmed(event.target.checked)} className="h-5 w-5 accent-emerald-400" /><span>안내된 횟수를 실제로 시도했습니다</span></label>
            <button type="button" disabled={completionDisabled} onClick={() => void saveCompletion()} className="mt-4 min-h-14 w-full rounded-2xl bg-emerald-700 text-base font-black text-white disabled:bg-white/15 disabled:text-white/45">{saving ? "비공개 저장 중…" : completed ? "이 과제는 완료했어요" : practiceLocked ? `먼저 ${nextPracticeDay}회차를 완료해 주세요` : !startedAt ? "먼저 18분 연습 시작" : elapsedSeconds < TOTAL_SECONDS ? `18분 패턴 진행 중 · ${Math.ceil((TOTAL_SECONDS - elapsedSeconds) / 60)}분 남음` : checkpointRequired ? "10점 기록 후 저장" : canvasRequired ? "연습장에 선을 그린 후 저장" : paperArchiveRequired ? "그림 사진 또는 건너뛰기 확인 필요" : !attemptConfirmed ? "시도 확인 후 저장" : mode === "ipad" || paperPhoto ? "그림과 완료 기록 저장" : "종이 연습 완료 기록"}</button>
            {!drawingRoutine && !growth.loading && <p className="mt-3 text-xs leading-5 text-white/55">첫 완료 때 그림 루틴이 계정에 한 번만 만들어집니다.</p>}
            {growth.notice && <p role="status" className="mt-4 rounded-xl bg-amber-300/15 px-3 py-2 text-sm leading-5 text-amber-100">{growth.notice}</p>}
            <div className="mt-5 grid grid-cols-2 gap-2"><button type="button" disabled={growth.loading || saving || lesson.day <= 1} onClick={() => chooseDay(lesson.day - 1)} className="min-h-11 rounded-xl bg-white/10 text-xs font-bold disabled:opacity-30">이전 수업</button><button type="button" disabled={growth.loading || saving || lesson.day >= 28} onClick={() => chooseDay(lesson.day + 1)} className="min-h-11 rounded-xl bg-white text-xs font-bold text-[#242231] disabled:opacity-30">다음 수업</button></div>
          </section>
        </aside>

      </div>

      <section className="no-print mt-5 rounded-[28px] bg-white p-4 shadow-sm sm:p-6"><details><summary className="flex min-h-11 cursor-pointer list-none items-center text-lg font-bold">28회 이후 12주까지 이어지는 연습표</summary><p className="mt-3 max-w-3xl text-sm leading-6 text-gray-500">첫 4주는 기초 기술을 익히는 첫 단계입니다. 큰 변화를 안정적으로 만들려면 같은 18분 패턴을 주 5회, 12주까지 이어가세요. 2일은 쉬거나 보충하며, 빠진 날이 있어도 처음으로 돌아가지 않습니다.</p><div className="mt-4 grid gap-3 sm:grid-cols-2">{DRAWING_CONTINUATION_WEEKS.map((item) => <article key={item.weeks} className="rounded-2xl bg-violet-50 p-4"><p className="text-xs font-bold text-violet-600">{item.weeks}</p><h3 className="mt-1 font-bold">{item.title}</h3><p className="mt-2 text-xs leading-5 text-gray-600">{item.description}</p><ol className="mt-3 space-y-1 text-xs leading-5 text-gray-700">{item.sessions.map((session, index) => <li key={session}>{index + 1}회. {session}</li>)}</ol></article>)}</div></details></section>

      <p className="no-print mx-auto mt-6 max-w-3xl text-center text-xs leading-5 text-gray-500">28회를 마친다고 전문가가 된다고 약속하지는 않습니다. 대신 같은 조건의 첫 그림·새 정물·마지막 그림과 10점 기록을 비교해 선, 비율, 입체, 명암이 실제로 좋아졌는지 확인합니다.</p>
    </div>
  </main>;
}

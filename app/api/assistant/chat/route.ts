import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getWorkoutDayForDate, getWorkoutRecord, isWorkoutPerformed, type WorkoutCompletionStore } from "@/app/data/workoutCompletion";
import { dayIdToKoreanLabel, getDayWorkoutForPlan, getWeeklyWorkoutPlanById, getWorkoutGroupForPlanDay } from "@/app/data/workoutPlans";
import { nextRecurringDueAt, parseRecurrence, recurrenceLabel, type RecurrenceRule } from "@/app/lib/assistantRecurrence";

export const dynamic = "force-dynamic";

type AssistantReply = { reply: string; action?: { label: string; href: string }; changed?: boolean };
type ChatHistoryItem = { role: "user" | "assistant"; text: string };

function seoulDate(offsetDays = 0) {
  const date = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function won(value: number) {
  return `${Math.round(value).toLocaleString("ko-KR")}원`;
}

function taskTitle(message: string) {
  return message
    .replace(/^((오늘|내일|모레|긴급|중요|높은\s*우선순위|낮은\s*우선순위)\s*)*(할\s*일|일정)(에|로|으로)?\s*/, "")
    .replace(/\s*(추가|등록|기록)(해\s*줘|해줘|해|해주세요|해요)?[.!?]?$/, "")
    .replace(/\s*(오늘|내일|모레|긴급|중요|높은\s*우선순위|낮은\s*우선순위)(로|까지|으로)?\s*/g, " ")
    .replace(/\s*\d{1,2}월\s*\d{1,2}일(까지|로)?\s*/g, " ")
    .replace(/\s*\d{4}-\d{2}-\d{2}(까지|로)?\s*/g, " ")
    .replace(/\s*['“”]?[^'“”]+['“”]?\s*프로젝트에\s*/, " ")
    .replace(/\s*(매일|날마다|매주|주마다|매월|매달|달마다)(\s*반복)?\s*/g, " ")
    .trim();
}

function parsePriority(message: string) {
  if (/(긴급|최우선|매우\s*중요|우선순위\s*5)/.test(message)) return 5;
  if (/(중요|높은\s*우선순위|우선순위\s*4)/.test(message)) return 4;
  if (/(낮은\s*우선순위|여유|우선순위\s*1)/.test(message)) return 1;
  if (/(보통|우선순위\s*2)/.test(message)) return 2;
  return 3;
}

function parseDueDate(message: string, today: string) {
  const explicit = message.match(/(20\d{2})[-./년]\s*(\d{1,2})[-./월]\s*(\d{1,2})일?/);
  if (explicit) return `${explicit[1]}-${explicit[2].padStart(2, "0")}-${explicit[3].padStart(2, "0")}`;
  const monthDay = message.match(/(\d{1,2})월\s*(\d{1,2})일/);
  if (monthDay) return `${today.slice(0, 4)}-${monthDay[1].padStart(2, "0")}-${monthDay[2].padStart(2, "0")}`;
  if (/모레/.test(message)) return seoulDate(2);
  if (/내일/.test(message)) return seoulDate(1);
  if (/오늘/.test(message)) return today;
  return null;
}

function cleanTaskTarget(message: string) {
  return message
    .replace(/^(할\s*일|일정)\s*/, "")
    .replace(/\s*(오늘|내일|모레|\d{1,2}월\s*\d{1,2}일)(로|까지)?\s*(마감|날짜)?\s*/, " ")
    .replace(/\s*(긴급|중요|높은\s*우선순위|낮은\s*우선순위)(로)?\s*/, " ")
    .replace(/\s*(할\s*일|일정)?(을|를)?\s*(완료|끝|수정|변경)(\s*처리)?(해\s*줘|해주세요|해)?[.!?]?$/, "")
    .trim();
}

function parseState(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") return {};
  try { return JSON.parse(value) as Record<string, unknown>; } catch { return {}; }
}

const LANGUAGE_ROUTINES = ["kana", "words", "sentences", "grammar", "review"] as const;
const LANGUAGE_LABELS: Record<typeof LANGUAGE_ROUTINES[number], string> = { kana: "가나", words: "단어", sentences: "문장", grammar: "문법", review: "복습" };

function parseStoredValue<T>(value: unknown, fallback: T): T {
  if (typeof value === "string") {
    try { return JSON.parse(value) as T; } catch { return fallback; }
  }
  return value && typeof value === "object" ? value as T : fallback;
}

function storedArrayLength(value: unknown) {
  const parsed = parseStoredValue<unknown>(value, []);
  return Array.isArray(parsed) ? parsed.length : 0;
}

function getLanguageSnapshot(state: Record<string, unknown>, today: string) {
  const routine = parseStoredValue<{ date?: unknown; completedIds?: unknown }>(state.dailyRoutineProgress, {});
  const completedIds = routine.date === today && Array.isArray(routine.completedIds)
    ? Array.from(new Set(routine.completedIds.filter((id): id is typeof LANGUAGE_ROUTINES[number] => typeof id === "string" && LANGUAGE_ROUTINES.includes(id as typeof LANGUAGE_ROUTINES[number]))))
    : [];
  const grammarProgress = parseStoredValue<unknown>(state.grammarProgress, []);
  const grammarReview = Array.isArray(grammarProgress) ? grammarProgress.filter((item) => item && typeof item === "object" && (("wrongCount" in item && Number(item.wrongCount) > 0) || ("lastResult" in item && item.lastResult === "wrong"))).length : 0;
  const counts = {
    kana: storedArrayLength(state.wrongKana) + storedArrayLength(state.wrongKanaChars),
    words: storedArrayLength(state.wrongWords) + storedArrayLength(state.savedWords),
    sentences: storedArrayLength(state.wrongSentences) + storedArrayLength(state.savedSentences),
    grammar: grammarReview,
    course: storedArrayLength(state.japaneseCurriculumReviewV1),
  };
  return { completedIds, counts, totalReview: Object.values(counts).reduce((sum, count) => sum + count, 0) };
}

function detectLanguageRoutine(message: string): typeof LANGUAGE_ROUTINES[number] | null {
  if (/(가나|히라가나|카타카나)/.test(message)) return "kana";
  if (/단어/.test(message)) return "words";
  if (/문장/.test(message)) return "sentences";
  if (/문법/.test(message)) return "grammar";
  if (/복습/.test(message)) return "review";
  return null;
}

async function saveLanguageRoutineCompletion(supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>, userId: string, today: string, routineId: typeof LANGUAGE_ROUTINES[number]) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data, error } = await supabase.from("language_user_state").select("state,updated_at").eq("user_id", userId).maybeSingle();
    if (error) throw error;
    const state = parseState(data?.state);
    const snapshot = getLanguageSnapshot(state, today);
    if (snapshot.completedIds.includes(routineId)) return { alreadyCompleted: true, snapshot };
    const completedIds = [...snapshot.completedIds, routineId];
    const history = parseStoredValue<Record<string, unknown>>(state.dailyLearningHistory, {});
    const nextState = {
      ...state,
      dailyRoutineProgress: JSON.stringify({ date: today, completedIds }),
      dailyLearningHistory: JSON.stringify({ ...history, [today]: { completedIds, completedCount: completedIds.length, totalCount: LANGUAGE_ROUTINES.length, updatedAt: new Date().toISOString() } }),
    };
    if (!data) {
      const { error: insertError } = await supabase.from("language_user_state").insert({ user_id: userId, state: nextState, updated_at: new Date().toISOString() });
      if (insertError) throw insertError;
      return { alreadyCompleted: false, snapshot };
    }
    const { data: updated, error: updateError } = await supabase.from("language_user_state").update({ state: nextState, updated_at: new Date().toISOString() }).eq("user_id", userId).eq("updated_at", data.updated_at).select("updated_at").maybeSingle();
    if (updateError) throw updateError;
    if (updated) return { alreadyCompleted: false, snapshot };
  }
  throw new Error("다른 기기에서 학습 기록이 변경되었습니다. 다시 시도해 주세요.");
}

function getTodayWorkout(state: Record<string, unknown>, today: string) {
  const planId = typeof state["ai-fitness-selected-weekly-workout-plan"] === "string" ? state["ai-fitness-selected-weekly-workout-plan"] as string : undefined;
  const plan = getWeeklyWorkoutPlanById(planId);
  const localNoon = new Date(`${today}T12:00:00+09:00`);
  const dayId = getWorkoutDayForDate(localNoon);
  if (!dayId) return null;
  const group = getWorkoutGroupForPlanDay(plan, dayId);
  const workout = getDayWorkoutForPlan(plan, dayId);
  const exerciseNames = workout.phases.flatMap((phase) => phase.exercises.map((exercise) => exercise.name));
  const cardioOptions = workout.optionalCardio?.options.map((option) => `${option.name} ${option.duration}`) ?? [];
  const completedStore = parseState(state["ai-fitness-workout-completed-days"]) as WorkoutCompletionStore;
  return { plan, dayId, group, workout, exerciseNames, cardioOptions, completedStore, completed: isWorkoutPerformed(completedStore[today]) };
}

async function saveWorkoutCompletion(supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>, userId: string, today: string) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data, error } = await supabase.from("user_app_state").select("state,updated_at").eq("user_id", userId).maybeSingle();
    if (error) throw error;
    const state = parseState(data?.state);
    const workoutInfo = getTodayWorkout(state, today);
    if (!workoutInfo) throw new Error("오늘 운동 정보를 확인하지 못했습니다.");
    if (workoutInfo.completed || workoutInfo.group.category === "rest") return workoutInfo;
    const current = getWorkoutRecord(workoutInfo.completedStore[today]);
    const nextStore: WorkoutCompletionStore = {
      ...workoutInfo.completedStore,
      [today]: {
        ...current,
        workoutDone: true,
        workoutStatus: "completed",
        workoutRoutineName: workoutInfo.group.name,
        workoutPlanName: workoutInfo.plan.name,
        workoutGroupId: workoutInfo.group.id,
        workoutExerciseNames: workoutInfo.exerciseNames,
        workoutSourceDay: workoutInfo.dayId,
        workoutExerciseRecords: workoutInfo.exerciseNames.map((exerciseName) => ({ exerciseName, status: "completed" as const })),
        workoutMemo: current.workoutMemo || "제이스비서에서 완료 기록",
      },
    };
    const nextState = { ...state, "ai-fitness-workout-completed-days": nextStore };
    if (!data) {
      const { error: insertError } = await supabase.from("user_app_state").insert({ user_id: userId, state: nextState, updated_at: new Date().toISOString() });
      if (insertError) throw insertError;
      return workoutInfo;
    }
    const { data: updated, error: updateError } = await supabase.from("user_app_state").update({ state: nextState, updated_at: new Date().toISOString() }).eq("user_id", userId).eq("updated_at", data.updated_at).select("updated_at").maybeSingle();
    if (updateError) throw updateError;
    if (updated) return workoutInfo;
  }
  throw new Error("다른 기기에서 운동 기록이 변경되었습니다. 다시 시도해 주세요.");
}

const ASSISTANT_CAPABILITY_GUIDE = "아직 이 요청을 앱에서 직접 실행할 수는 없어요. 대신 ‘오늘 브리핑 보여줘’, ‘이번 달 지출 알려줘’, ‘오늘 할 일에 우유 사기 추가해줘’, ‘오늘 운동 계획 보여줘’, ‘일본어 복습 시작해줘’처럼 말씀해 주세요.";

function normalizeGenerativeReply(value: unknown) {
  const reply = typeof value === "string" ? value.trim() : "";
  if (!reply) return ASSISTANT_CAPABILITY_GUIDE;
  if (/(제\s*능력\s*밖|저의\s*능력\s*밖|지금으로써.{0,12}능력\s*밖)/.test(reply)) {
    console.warn("Assistant replaced a vague model refusal");
    return ASSISTANT_CAPABILITY_GUIDE;
  }
  return reply;
}

function validatedHistory(value: unknown): ChatHistoryItem[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-8).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const role = "role" in item && (item.role === "user" || item.role === "assistant") ? item.role : null;
    const text = "text" in item && typeof item.text === "string" ? item.text.trim().slice(0, 500) : "";
    return role && text ? [{ role, text }] : [];
  });
}

function resolveContextualMessage(message: string, history: ChatHistoryItem[]) {
  if (!/(그거|그것|그\s*일|방금\s*말한)/.test(message)) return message;
  const previous = [...history].reverse().find((item) => item.role === "user" && /(할\s*일|일정)/.test(item.text));
  if (!previous) return message;
  const target = taskTitle(previous.text) || cleanTaskTarget(previous.text);
  return target ? message.replace(/그거|그것|그\s*일|방금\s*말한\s*(일|할\s*일)?/g, `${target} 할 일`) : message;
}

function splitCompoundCommands(message: string) {
  const parts = message.split(/\s*(?:그리고|그다음|그\s*다음|한\s*뒤|후에)\s*/).map((part) => part.trim()).filter(Boolean);
  return parts.length > 1 ? parts.slice(0, 3) : [message];
}

async function generativeFallback(message: string, history: ChatHistoryItem[]): Promise<string> {
  if (!process.env.GEMINI_API_KEY) return ASSISTANT_CAPABILITY_GUIDE;
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${process.env.GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: "당신은 Jace님의 친절한 한국어 개인 AI 비서 ‘연이’입니다. 일반적인 질문에는 알고 있는 범위에서 2~3문장으로 명확하게 답하세요. 개인정보를 추측하지 마세요. 앱 데이터 작업은 월 지출 조회, 오늘 브리핑, 할 일 조회·추가·완료·마감일/우선순위 수정, 프로젝트 연결, 운동 계획 확인·완료, 일본어 진도 확인·복습 시작·완료를 지원합니다. 앱에서 직접 실행할 수 없는 작업이라면 ‘능력 밖’이라고만 답하지 말고, 아직 직접 실행할 수 없다고 설명한 뒤 사용자가 대신 사용할 수 있는 가장 가까운 지원 명령 예시를 제시하세요." }] },
        contents: [
          ...history.map((item) => ({ role: item.role === "assistant" ? "model" : "user", parts: [{ text: item.text }] })),
          { role: "user", parts: [{ text: message }] },
        ],
        generationConfig: { maxOutputTokens: 220 },
      }),
    });
    if (!response.ok) {
      console.error("Gemini assistant request failed", { status: response.status });
      throw new Error("Gemini request failed");
    }
    const data = await response.json();
    return normalizeGenerativeReply(data.candidates?.[0]?.content?.parts?.[0]?.text);
  } catch (error) {
    console.error("Gemini assistant fallback failed", { message: error instanceof Error ? error.message : "unknown" });
    return ASSISTANT_CAPABILITY_GUIDE;
  }
}

async function processSingleCommand(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  userId: string,
  rawMessage: string,
  history: ChatHistoryItem[],
): Promise<AssistantReply> {
  const message = resolveContextualMessage(rawMessage, history);
  const today = seoulDate();
  const monthStart = `${today.slice(0, 7)}-01`;
  let result: AssistantReply;

  if (/(할\s*일|일정).*(완료|끝)|(완료|끝).*(할\s*일|일정)/.test(message)) {
    const target = cleanTaskTarget(message);
    if (!target) {
      result = { reply: "완료할 할 일 제목을 함께 말해 주세요. 예: ‘우유 사기 할 일 완료해줘’" };
    } else {
      const { data, error } = await supabase.from("assistant_items").select("id,title,kind,priority,project_id,due_at,recurrence_rule").eq("user_id", userId).neq("status", "completed").order("created_at", { ascending: false }).limit(50);
      if (error) throw new Error("할 일을 확인하지 못했습니다.");
      const matches = (data ?? []).filter((item) => item.title.includes(target) || target.includes(item.title));
      if (matches.length !== 1) result = { reply: matches.length ? `비슷한 할 일이 ${matches.length}개 있어요. 제목을 더 정확히 말씀해 주세요: ${matches.slice(0, 3).map((item) => item.title).join(" · ")}` : `‘${target}’과 일치하는 미완료 할 일을 찾지 못했습니다.` };
      else {
        const { error: updateError } = await supabase.from("assistant_items").update({ status: "completed", completed_at: new Date().toISOString() }).eq("user_id", userId).eq("id", matches[0].id);
        if (updateError) throw new Error("완료 상태를 저장하지 못했습니다.");
        const rule = (matches[0].recurrence_rule || "none") as RecurrenceRule;
        const nextDueAt = nextRecurringDueAt(matches[0].due_at, rule, today);
        if (nextDueAt) {
          const { error: repeatError } = await supabase.from("assistant_items").insert({ user_id: userId, title: matches[0].title, kind: matches[0].kind, status: "open", priority: matches[0].priority, project_id: matches[0].project_id, due_at: nextDueAt, recurrence_rule: rule, source: "recurrence" });
          if (repeatError) throw new Error("완료했지만 다음 반복 일정을 만들지 못했습니다.");
        }
        result = { reply: `‘${matches[0].title}’을 완료 처리했습니다.${nextDueAt ? ` 다음 ${recurrenceLabel(rule)} 일정은 ${nextDueAt.slice(0, 10)}입니다.` : ""}`, action: { label: "할 일 목록 보기", href: "#assistant-list" }, changed: true };
      }
    }
  } else if (/(할\s*일|일정).*(수정|변경)|(수정|변경).*(할\s*일|일정)/.test(message)) {
    const target = cleanTaskTarget(message);
    const dueDate = parseDueDate(message, today);
    const hasPriority = /(긴급|최우선|중요|우선순위|여유)/.test(message);
    const recurrence = parseRecurrence(message);
    const hasRecurrence = recurrence !== "none" || /(반복\s*(없음|해제|중지)|반복하지)/.test(message);
    if (!target || (!dueDate && !hasPriority && !hasRecurrence)) {
      result = { reply: "수정할 제목과 변경 내용을 말해 주세요. 예: ‘보고서 작성 할 일을 내일로 변경해줘’" };
    } else {
      const { data, error } = await supabase.from("assistant_items").select("id,title").eq("user_id", userId).neq("status", "completed").order("created_at", { ascending: false }).limit(50);
      if (error) throw new Error("할 일을 확인하지 못했습니다.");
      const matches = (data ?? []).filter((item) => item.title.includes(target) || target.includes(item.title));
      if (matches.length !== 1) result = { reply: matches.length ? `비슷한 할 일이 ${matches.length}개 있어요. 제목을 더 정확히 말씀해 주세요.` : `‘${target}’과 일치하는 할 일을 찾지 못했습니다.` };
      else {
        const updates: { due_at?: string; priority?: number; recurrence_rule?: RecurrenceRule } = {};
        if (dueDate) updates.due_at = `${dueDate}T23:59:00+09:00`;
        if (hasPriority) updates.priority = parsePriority(message);
        if (hasRecurrence) updates.recurrence_rule = recurrence;
        const { error: updateError } = await supabase.from("assistant_items").update(updates).eq("user_id", userId).eq("id", matches[0].id);
        if (updateError) throw new Error("할 일을 수정하지 못했습니다.");
        result = { reply: `‘${matches[0].title}’의 ${[dueDate && `마감일을 ${dueDate}로`, hasPriority && `우선순위를 ${parsePriority(message)}로`, hasRecurrence && `반복을 ${recurrenceLabel(recurrence)}으로`].filter(Boolean).join(", ")} 변경했습니다.`, action: { label: "할 일 목록 보기", href: "#assistant-list" }, changed: true };
      }
    }
  } else if (/브리핑/.test(message)) {
    const start = `${today}T00:00:00+09:00`;
    const end = `${today}T23:59:59+09:00`;
    const [taskResult, budgetResult, fitnessResult, languageResult] = await Promise.all([
      supabase.from("assistant_items").select("title").eq("user_id", userId).neq("status", "completed").gte("due_at", start).lte("due_at", end).order("priority", { ascending: false }).limit(5),
      supabase.from("budget_transactions").select("amount").eq("user_id", userId).gte("date", monthStart).lte("date", today),
      supabase.from("user_app_state").select("state").eq("user_id", userId).maybeSingle(),
      supabase.from("language_user_state").select("state").eq("user_id", userId).maybeSingle(),
    ]);
    const error = taskResult.error || budgetResult.error || fitnessResult.error || languageResult.error;
    if (error) throw new Error("통합 브리핑 데이터를 불러오지 못했습니다.");
    const spent = (budgetResult.data ?? []).reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const workoutInfo = getTodayWorkout(parseState(fitnessResult.data?.state), today);
    const workoutText = !workoutInfo ? "운동 계획 확인 필요" : workoutInfo.group.category === "rest" ? "오늘은 회복일" : workoutInfo.completed ? `${workoutInfo.group.name} 완료` : `${workoutInfo.group.name} 예정`;
    const language = getLanguageSnapshot(parseState(languageResult.data?.state), today);
    const taskText = taskResult.data?.length ? taskResult.data.map((item, index) => `${index + 1}. ${item.title}`).join(" · ") : "오늘 마감 할 일 없음";
    result = { reply: `오늘 브리핑입니다. 할 일: ${taskText}. 이번 달 지출은 ${won(spent)}입니다. 운동: ${workoutText}. 언어 학습은 ${language.completedIds.length}/${LANGUAGE_ROUTINES.length}개 완료했고 복습 대기는 ${language.totalReview}개입니다.`, action: { label: "통합 브리핑 자세히 보기", href: "/assistant" } };
  } else if (/(이번\s*달|월).*(지출|소비)|(지출|소비).*(이번\s*달|월)/.test(message)) {
    const { data, error } = await supabase.from("budget_transactions").select("amount,type,category").eq("user_id", userId).gte("date", monthStart).lte("date", today);
    if (error) throw new Error("가계부 데이터를 불러오지 못했습니다.");
    const rows = data ?? [];
    const total = rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const categories = rows.reduce<Record<string, number>>((acc, row) => { const key = row.category || "기타"; acc[key] = (acc[key] || 0) + Number(row.amount || 0); return acc; }, {});
    const top = Object.entries(categories).sort((a, b) => b[1] - a[1])[0];
    result = { reply: `이번 달 지출은 ${won(total)}, 총 ${rows.length}건입니다.${top ? ` 가장 큰 항목은 ${top[0]} ${won(top[1])}이에요.` : ""}`, action: { label: "가계부 자세히 보기", href: "/budget" } };
  } else if (/(할\s*일|일정).*(추가|등록|기록)|(추가|등록|기록).*(할\s*일|일정)/.test(message)) {
    const title = taskTitle(message);
    if (!title || /^(추가|등록|기록)$/.test(title)) {
      result = { reply: "추가할 내용을 함께 말해 주세요. 예: ‘오늘 할 일에 우유 사기 추가해줘’" };
    } else {
      const dueDate = parseDueDate(message, today);
      const dueAt = dueDate ? `${dueDate}T23:59:00+09:00` : null;
      const projectHint = message.match(/['“”]?([^'“”]+?)['“”]?\s*프로젝트에/);
      let projectId: string | null = null;
      let projectName = "";
      if (projectHint) {
        const hint = projectHint[1].trim().replace(/^(오늘|내일|모레)\s*할\s*일에?\s*/, "");
        const { data: projectRows } = await supabase.from("assistant_projects").select("id,name").eq("user_id", userId).neq("status", "archived");
        const projectMatches = (projectRows ?? []).filter((project) => project.name.includes(hint) || hint.includes(project.name));
        if (projectMatches.length !== 1) {
          result = { reply: projectMatches.length ? `‘${hint}’과 비슷한 프로젝트가 여러 개예요. 프로젝트 이름을 정확히 말씀해 주세요.` : `‘${hint}’ 프로젝트를 찾지 못했습니다. 프로젝트를 먼저 등록해 주세요.` };
          return result;
        }
        projectId = projectMatches[0].id;
        projectName = projectMatches[0].name;
      }
      const priority = parsePriority(message);
      const recurrence = parseRecurrence(message);
      const { error } = await supabase.from("assistant_items").insert({ user_id: userId, title, kind: "task", status: "open", priority, due_at: dueAt, project_id: projectId, recurrence_rule: recurrence, source: "assistant_chat" });
      if (error) throw new Error("할 일을 저장하지 못했습니다.");
      result = { reply: `‘${title}’을 할 일에 추가했습니다.${dueDate ? ` 마감일은 ${dueDate}` : ""}${priority !== 3 ? `, 우선순위는 ${priority}` : ""}${projectName ? `, 프로젝트는 ‘${projectName}’` : ""}${recurrence !== "none" ? `, 반복은 ${recurrenceLabel(recurrence)}` : ""}${dueDate || priority !== 3 || projectName || recurrence !== "none" ? "로 설정했습니다." : ""}`, action: { label: "할 일 목록 보기", href: "#assistant-list" }, changed: true };
    }
  } else if (/(오늘).*(할\s*일|일정)|(할\s*일|일정).*(오늘)/.test(message)) {
    const start = `${today}T00:00:00+09:00`;
    const end = `${today}T23:59:59+09:00`;
    const { data, error } = await supabase.from("assistant_items").select("title").eq("user_id", userId).neq("status", "completed").gte("due_at", start).lte("due_at", end).order("priority", { ascending: false }).limit(5);
    if (error) throw new Error("할 일을 불러오지 못했습니다.");
    result = { reply: data?.length ? `오늘 할 일은 ${data.length}건입니다. ${data.map((item, index) => `${index + 1}. ${item.title}`).join(" · ")}` : "오늘 마감인 미완료 할 일이 없습니다.", action: { label: "할 일 목록 보기", href: "#assistant-list" } };
  } else if (/(오늘\s*)?운동.*(완료|끝|마쳤|했어|했어요)/.test(message)) {
    try {
      const workoutInfo = await saveWorkoutCompletion(supabase, userId, today);
      result = { reply: workoutInfo.group.category === "rest" ? "오늘은 회복일이라 별도의 운동 완료 기록을 만들지 않았습니다. 충분히 쉬고 몸 상태를 확인해 주세요." : workoutInfo.completed ? "오늘 운동은 이미 완료로 기록되어 있습니다." : `오늘 ‘${workoutInfo.group.name}’ 운동을 완료로 기록했습니다. 운동 페이지에도 자동으로 동기화됩니다.`, action: { label: "운동 기록 확인", href: "/fitness" }, changed: workoutInfo.group.category !== "rest" && !workoutInfo.completed };
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : "운동 완료 기록을 저장하지 못했습니다.");
    }
  } else if (/(운동).*(계획|일정|뭐|보여|알려)|(오늘).*(운동)/.test(message)) {
    const { data, error } = await supabase.from("user_app_state").select("state").eq("user_id", userId).maybeSingle();
    if (error) throw new Error("운동 데이터를 불러오지 못했습니다.");
    const workoutInfo = getTodayWorkout(parseState(data?.state), today);
    if (!workoutInfo) result = { reply: "오늘 운동 계획을 확인하지 못했습니다.", action: { label: "운동 앱 열기", href: "/fitness" } };
    else if (workoutInfo.group.category === "rest") result = { reply: `오늘 ${dayIdToKoreanLabel[workoutInfo.dayId]}은 회복일입니다. ${workoutInfo.exerciseNames.join(" · ")}`, action: { label: "회복 계획 보기", href: "/fitness" } };
    else {
      const details = workoutInfo.exerciseNames.length ? workoutInfo.exerciseNames.map((name, index) => `${index + 1}. ${name}`).join(" · ") : workoutInfo.cardioOptions.join(" · ");
      result = { reply: `오늘은 ‘${workoutInfo.group.name}’ 계획이며 예상 시간은 ${workoutInfo.group.duration}입니다.${workoutInfo.completed ? " 이미 완료로 기록되어 있어요." : ""} ${details}`, action: { label: "운동 세부 화면 열기", href: "/fitness" } };
    }
  } else if (/(일본어|언어|가나|히라가나|카타카나|단어|문장|문법|복습).*(완료|끝|마쳤|했어|했어요)/.test(message)) {
    const routineId = detectLanguageRoutine(message);
    if (!routineId) result = { reply: "완료한 학습 종류를 함께 말해 주세요. 예: ‘단어 학습 완료했어’" };
    else {
      try {
        const saved = await saveLanguageRoutineCompletion(supabase, userId, today, routineId);
        result = { reply: saved.alreadyCompleted ? `오늘 ${LANGUAGE_LABELS[routineId]} 학습은 이미 완료로 기록되어 있습니다.` : `오늘 ${LANGUAGE_LABELS[routineId]} 학습을 완료로 기록했습니다. 언어 앱에도 자동으로 동기화됩니다.`, action: { label: "오늘 학습 현황 보기", href: "/language" }, changed: !saved.alreadyCompleted };
      } catch (error) {
        throw new Error(error instanceof Error ? error.message : "학습 완료 기록을 저장하지 못했습니다.");
      }
    }
  } else if (/(일본어|언어).*(진도|복습|틀린|학습).*(알려|보여|뭐|몇)|(복습).*(할|남은|몇)/.test(message)) {
    const { data, error } = await supabase.from("language_user_state").select("state").eq("user_id", userId).maybeSingle();
    if (error) throw new Error("언어 학습 데이터를 불러오지 못했습니다.");
    const snapshot = getLanguageSnapshot(parseState(data?.state), today);
    const nextRoutine = LANGUAGE_ROUTINES.find((id) => !snapshot.completedIds.includes(id));
    result = { reply: `오늘 학습은 ${snapshot.completedIds.length}/${LANGUAGE_ROUTINES.length}개 완료했습니다.${nextRoutine ? ` 다음 추천은 ${LANGUAGE_LABELS[nextRoutine]}입니다.` : " 오늘 루틴을 모두 마쳤습니다."} 복습 대기는 총 ${snapshot.totalReview}개이며, 가나 ${snapshot.counts.kana}개·단어 ${snapshot.counts.words}개·문장 ${snapshot.counts.sentences}개·문법 ${snapshot.counts.grammar}개·과정 복습 ${snapshot.counts.course}개입니다.`, action: { label: snapshot.totalReview ? "복습 시작" : "언어 학습 열기", href: snapshot.totalReview ? "/language/review" : "/language" } };
  } else if (/(일본어|언어).*(복습|학습).*(시작|해|보여)|(복습).*(시작)/.test(message)) {
    result = { reply: "일본어 복습 화면을 준비했습니다. 아래 버튼을 눌러 바로 시작하세요.", action: { label: "일본어 복습 시작", href: "/language/review" } };
  } else {
    result = { reply: await generativeFallback(message, history) };
  }

  return result;
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = await request.json().catch(() => null) as { message?: unknown; history?: unknown } | null;
  const message = typeof body?.message === "string" ? body.message.trim().slice(0, 500) : "";
  if (!message) return NextResponse.json({ error: "명령을 입력해 주세요." }, { status: 400 });
  const history = validatedHistory(body?.history);

  try {
    const replies: AssistantReply[] = [];
    for (const command of splitCompoundCommands(message)) {
      const compoundHistory = replies.flatMap((reply, index) => [
        { role: "user" as const, text: splitCompoundCommands(message)[index] },
        { role: "assistant" as const, text: reply.reply },
      ]);
      replies.push(await processSingleCommand(supabase, user.id, command, [...history, ...compoundHistory]));
    }
    const lastAction = [...replies].reverse().find((reply) => reply.action)?.action;
    return NextResponse.json({
      reply: replies.map((reply, index) => replies.length > 1 ? `${index + 1}. ${reply.reply}` : reply.reply).join("\n"),
      action: lastAction,
      changed: replies.some((reply) => reply.changed),
    });
  } catch (error) {
    console.error("Assistant command failed", { message: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ error: error instanceof Error ? error.message : "명령을 처리하지 못했습니다." }, { status: 500 });
  }
}

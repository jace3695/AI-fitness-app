import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.52.1";
import webpush from "npm:web-push@3.6.7";

type SubscriptionRow = {
  endpoint: string;
  user_id: string;
  p256dh: string;
  auth: string;
  days: string[];
  workout_time: string;
  incomplete_reminder: boolean;
  incomplete_delay_minutes: number;
  timezone: string;
  last_start_date: string | null;
  last_incomplete_date: string | null;
  briefing_enabled: boolean;
  briefing_time: string;
  last_briefing_date: string | null;
};

const DAY_IDS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function localParts(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value || "";
  const weekday = value("weekday").slice(0, 3).toLowerCase();
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    minutes: Number(value("hour")) * 60 + Number(value("minute")),
    dayId: DAY_IDS.find((day) => day.startsWith(weekday)) || "",
  };
}

function scheduledMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function workoutCompleted(state: Record<string, unknown> | null, date: string) {
  const store = state?.["ai-fitness-workout-completed-days"] as Record<string, unknown> | undefined;
  const record = store?.[date];
  if (typeof record === "boolean") return record;
  if (!record || typeof record !== "object") return false;
  const value = record as Record<string, unknown>;
  return value.workoutDone === true || value.workoutStatus === "completed";
}

function parseState(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
}

function parseStoredObject(value: unknown) {
  return parseState(value);
}

function won(value: number) {
  return `${Math.round(value).toLocaleString("ko-KR")}원`;
}

async function buildBriefing(admin: ReturnType<typeof createClient>, userId: string, date: string) {
  const monthStart = `${date.slice(0, 7)}-01`;
  const dayStart = `${date}T00:00:00+09:00`;
  const dayEnd = `${date}T23:59:59+09:00`;
  const [tasks, transactions, budget, fitness, language] = await Promise.all([
    admin.from("assistant_items").select("id", { count: "exact", head: true }).eq("user_id", userId).neq("status", "completed").gte("due_at", dayStart).lte("due_at", dayEnd),
    admin.from("budget_transactions").select("amount").eq("user_id", userId).gte("date", monthStart).lte("date", date),
    admin.from("budget_monthly_budgets").select("total_amount").eq("user_id", userId).eq("budget_month", monthStart).maybeSingle(),
    admin.from("user_app_state").select("state").eq("user_id", userId).maybeSingle(),
    admin.from("language_user_state").select("state").eq("user_id", userId).maybeSingle(),
  ]);
  const error = tasks.error || transactions.error || budget.error || fitness.error || language.error;
  if (error) throw error;

  const spent = (transactions.data || []).reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const budgetAmount = budget.data ? Number(budget.data.total_amount) : null;
  const fitnessState = parseState(fitness.data?.state);
  const workoutStore = parseState(fitnessState["ai-fitness-workout-completed-days"]);
  const todayWorkout = parseState(workoutStore[date]);
  const completed = workoutCompleted(fitnessState, date);
  const routineName = typeof todayWorkout.workoutRoutineName === "string" ? todayWorkout.workoutRoutineName : "오늘 운동 계획";
  const languageState = parseState(language.data?.state);
  const routine = parseStoredObject(languageState.dailyRoutineProgress);
  const completedIds = routine.date === date && Array.isArray(routine.completedIds) ? routine.completedIds.length : 0;

  const budgetText = budgetAmount === null
    ? `이번 달 지출 ${won(spent)}`
    : `지출 ${won(spent)} · 예산 ${won(Math.max(0, budgetAmount - spent))} 남음`;
  const workoutText = completed ? `${routineName} 완료` : `${routineName} 확인`;
  const languageText = completedIds >= 5 ? "언어 학습 완료" : `언어 학습 ${completedIds}/5 · 복습하기`;
  return `오늘 할 일 ${tasks.count || 0}건 · ${budgetText}\n${workoutText} · ${languageText}`;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return new Response("Server configuration missing", { status: 500 });
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  let dryRun = false;
  try { dryRun = (await request.json()).dryRun === true; } catch { /* 빈 본문 허용 */ }

  const { data: secrets, error: secretError } = await admin.rpc("get_workout_push_secrets");
  if (secretError || !secrets?.cron_secret || !secrets?.vapid_private_key) {
    return new Response("Server secrets unavailable", { status: 500 });
  }
  if (request.headers.get("x-cron-secret") !== secrets.cron_secret) {
    return new Response("Unauthorized", { status: 401 });
  }

  webpush.setVapidDetails("mailto:notifications@ai-fitness.app", secrets.vapid_public_key, secrets.vapid_private_key);
  const { data: subscriptions, error } = await admin.from("push_subscriptions").select("*").eq("enabled", true);
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  let sent = 0;
  let removed = 0;
  let briefings = 0;
  for (const subscription of (subscriptions || []) as SubscriptionRow[]) {
    let local;
    try { local = localParts(subscription.timezone || "Asia/Seoul"); } catch { local = localParts("Asia/Seoul"); }
    const start = scheduledMinutes(subscription.workout_time);
    const isStart = local.minutes >= start && local.minutes < start + 2 && subscription.last_start_date !== local.date;
    const isIncomplete = subscription.incomplete_reminder && local.minutes >= start + subscription.incomplete_delay_minutes && local.minutes < start + subscription.incomplete_delay_minutes + 2 && subscription.last_incomplete_date !== local.date;
    const briefingAt = scheduledMinutes(subscription.briefing_time || "07:30");
    const isBriefing = subscription.briefing_enabled !== false && local.minutes >= briefingAt && local.minutes < briefingAt + 2 && subscription.last_briefing_date !== local.date;
    const workoutDayEnabled = subscription.days.includes(local.dayId);
    if ((!workoutDayEnabled || (!isStart && !isIncomplete)) && !isBriefing && !dryRun) continue;

    const { data: appState } = await admin.from("user_app_state").select("state").eq("user_id", subscription.user_id).maybeSingle();
    if (isIncomplete && workoutCompleted(appState?.state as Record<string, unknown> | null, local.date) && !isBriefing && !dryRun) continue;
    let payload;
    if (isBriefing || dryRun) {
      payload = JSON.stringify({ title: "Jace AI 오늘 브리핑", body: await buildBriefing(admin, subscription.user_id, local.date), tag: `daily-briefing-${local.date}`, url: "/assistant" });
      briefings += 1;
    } else {
      payload = JSON.stringify({
        title: isStart ? "오늘의 운동 시간입니다" : "오늘 운동을 아직 완료하지 않았어요",
        body: isStart ? "AI 운동 앱에서 오늘 계획을 확인해 보세요." : "몸 상태에 맞게 가볍게라도 시작해 보세요.",
        tag: isStart ? `workout-start-${local.date}` : `workout-incomplete-${local.date}`,
        url: "/fitness",
      });
    }
    if (dryRun) continue;
    try {
      await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, payload);
      const update = isBriefing ? { last_briefing_date: local.date } : isStart ? { last_start_date: local.date } : { last_incomplete_date: local.date };
      await admin.from("push_subscriptions").update(update).eq("endpoint", subscription.endpoint);
      sent += 1;
    } catch (pushError) {
      const statusCode = (pushError as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await admin.from("push_subscriptions").delete().eq("endpoint", subscription.endpoint);
        removed += 1;
      } else {
        console.error("Push delivery failed", statusCode || "unknown");
      }
    }
  }

  return new Response(JSON.stringify({ ok: true, dryRun, checked: subscriptions?.length || 0, briefings, sent, removed }), { headers: { "content-type": "application/json" } });
});

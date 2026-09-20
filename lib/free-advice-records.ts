import type { SupabaseClient } from "@supabase/supabase-js";
import { adviceDateRange, buildFreeAdviceContext, type AdviceRecords, type FreeAdviceScope } from "./free-advice-context.ts";

// The caller authenticates with getUser(). This client retains that user's RLS;
// no service-role access and no user identifier supplied by the request body.
export async function loadFreeAdviceContext(client: SupabaseClient, userId: string, scope: FreeAdviceScope, now = new Date()) {
  const records: AdviceRecords = {};
  const jobs: Promise<void>[] = [];
  const range = adviceDateRange(now);
  if (scope === "fitness" || scope === "assistant") jobs.push((async () => {
    const { data, error } = await client.from("user_app_state").select("state").eq("user_id", userId).maybeSingle();
    if (error) throw new Error("운동·식단 기록을 불러오지 못했어요.");
    records.fitnessState = data?.state ?? {};
  })());
  if (scope === "language" || scope === "assistant") jobs.push((async () => {
    const { data, error } = await client.from("language_user_state").select("state").eq("user_id", userId).maybeSingle();
    if (error) throw new Error("학습 기록을 불러오지 못했어요.");
    records.languageState = data?.state ?? {};
  })());
  if (scope === "budget" || scope === "assistant") {
    for (const [table, key] of [["budget_transactions", "expenses"], ["budget_income", "income"], ["budget_savings", "savings"]] as const) {
      jobs.push((async () => {
        const { data, error, count } = await client.from(table).select("amount,date", { count: "exact" })
          .eq("user_id", userId).gte("date", range.startDate).lte("date", range.endDate).order("date", { ascending: false }).limit(1000);
        if (error || !Array.isArray(data)) throw new Error("가계부 기록을 불러오지 못했어요.");
        // Never label a truncated page as the entire period's financial total.
        if (count !== data.length) throw new Error("전체 가계부 기록을 확인하지 못했어요. 기본 가계부 통계를 이용해 주세요.");
        records[key] = data;
      })());
    }
  }
  const results = await Promise.allSettled(jobs);
  const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failure) throw failure.reason;
  return buildFreeAdviceContext(scope, records, now);
}

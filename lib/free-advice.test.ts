import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import vm from "node:vm";
import ts from "typescript";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as contextModule from "./free-advice-context.ts";
import { loadFreeAdviceContext } from "./free-advice-records.ts";
import * as provider from "./free-advice.ts";
import * as policy from "./free-gemini-policy.ts";

const now = new Date("2026-09-14T02:00:00Z");
const context = contextModule.buildFreeAdviceContext("budget", { expenses: [{ amount: 12000, date: "2026-09-14" }] }, now);
const advice = { summary: "오늘 기록한 지출은 12,000원이에요.", nextSteps: ["오늘 남은 지출을 한 번 적어 보세요."], basis: "최근 28일 지출 기록 1건", limitations: "기록하지 않은 지출은 알 수 없어요." };
const environment = { GEMINI_FREE_TIER_CONFIRMED: "true", GEMINI_FREE_API_KEY: " synthetic-free-only " };
const input = { context, question: "오늘 할 일", acknowledged: true };
const output = (finishReason = "STOP") => Response.json({ candidates: [{ finishReason, content: { parts: [{ text: JSON.stringify(advice) }] } }] });
const metric = (result: contextModule.FreeAdviceContext, id: string) => result.metrics.find(item => item.id === id)?.value;

test("summary uses Seoul dates, excludes future/invalid dates, and preserves observed zero water", () => {
  assert.deepEqual(contextModule.adviceDateRange(new Date("2026-09-14T15:01:00Z")), { startDate: "2026-08-19", endDate: "2026-09-15" });
  const result = contextModule.buildFreeAdviceContext("fitness", { fitnessState: {
    "ai-fitness-workout-completed-days": { "2026-09-14": { workoutStatus: "partial", workoutBackStatus: "pain", memo: "PRIVATE-MEMO" }, "2026-09-07": true, "2026-08-18": { workoutStatus: "stopped", workoutBackStatus: "none" }, "2026-08-17": true, "2026-09-15": true, "2026-08-32": true },
    "ai-fitness-water-intake": { "2026-09-14": 0, "2026-09-13": 600, "2026-09-12": null, "2026-09-11": "" },
  } }, now);
  assert.equal(metric(result, "workout.days"), 2);
  assert.equal(metric(result, "workout.recent7"), 1);
  assert.equal(metric(result, "workout.previous7"), 1);
  assert.equal(metric(result, "workout.stopped"), 1);
  assert.equal(metric(result, "workout.discomfort"), 1);
  assert.equal(metric(result, "workout.unknownBack"), 1);
  assert.equal(metric(result, "water.days"), 2);
  assert.equal(metric(result, "water.average"), 300);
  assert.ok(!JSON.stringify(result).includes("PRIVATE-MEMO"));
});

test("current curriculum and legacy learning days are combined without duplicate dates or private text", () => {
  const result = contextModule.buildFreeAdviceContext("language", { languageState: {
    dailyLearningHistory: JSON.stringify({ "2026-09-14": { completedCount: 1 }, "2026-09-12": { completedCount: 0 } }),
    japaneseCurriculumProgressV1: JSON.stringify({ activityDates: ["2026-09-14", "2026-09-13", "2026-09-13", "2026-09-15", "invalid"], lastLessonId: "PRIVATE-LESSON" }),
    japaneseCurriculumReviewV1: JSON.stringify([{ prompt: "PRIVATE-PROMPT" }]),
  } }, now);
  assert.equal(metric(result, "language.days"), 2);
  assert.equal(metric(result, "language.review"), 1);
  assert.ok(!JSON.stringify(result).includes("PRIVATE-"));
});

test("budget totals cover the complete 28 days, omit names/memos and reject invalid stored money", () => {
  const result = contextModule.buildFreeAdviceContext("budget", { expenses: [
    { date: "2026-09-14", amount: "12000", place: "PRIVATE-MERCHANT", memo: "PRIVATE-MEMO" },
    { date: "2026-09-07", amount: 4000 }, { date: "2026-08-18", amount: 1000 },
    { date: "2026-08-17", amount: 90000 }, { date: "2026-09-15", amount: 90000 },
  ] }, now);
  assert.equal(metric(result, "budget.expense"), 17000);
  assert.equal(metric(result, "budget.expenseRecent7"), 12000);
  assert.equal(metric(result, "budget.expensePrevious7"), 4000);
  assert.ok(result.notes.some(note => note.includes("월 전체가 아닌")));
  assert.ok(!JSON.stringify(result).includes("PRIVATE-"));
  assert.throws(() => contextModule.buildFreeAdviceContext("budget", { expenses: [{ date: "2026-09-14", amount: "corrupt" }] }, now));
  assert.equal(contextModule.buildFreeAdviceContext("assistant", {}, now).recordCount, 0);
});

test("record loader selects only the owner and rejects errors or incomplete financial pages", async () => {
  const calls: { table: string; method: string; args: unknown[] }[] = [];
  let truncated = false; let failed = false;
  const client = { from(table: string) {
    const builder = {
      select(...args: unknown[]) { calls.push({ table, method: "select", args }); return builder; },
      eq(...args: unknown[]) { calls.push({ table, method: "eq", args }); return builder; },
      gte(...args: unknown[]) { calls.push({ table, method: "gte", args }); return builder; },
      lte(...args: unknown[]) { calls.push({ table, method: "lte", args }); return builder; },
      order() { return builder; },
      async limit() { return { data: [], error: failed ? { message: "PRIVATE-ERROR" } : null, count: truncated ? 1001 : 0 }; },
      async maybeSingle() { return { data: { state: {} }, error: failed ? { message: "PRIVATE-ERROR" } : null }; },
    }; return builder;
  } } as unknown as SupabaseClient;
  await loadFreeAdviceContext(client, "owner-fixture", "assistant", now);
  assert.equal(calls.filter(call => call.method === "eq").length, 5);
  assert.ok(calls.filter(call => call.method === "eq").every(call => JSON.stringify(call.args) === JSON.stringify(["user_id", "owner-fixture"])));
  assert.ok(calls.filter(call => call.table.startsWith("budget_") && call.method === "select").every(call => call.args[0] === "amount,date"));
  assert.equal(calls.filter(call => call.method === "gte" && call.args[1] === "2026-08-18").length, 3);
  truncated = true;
  await assert.rejects(() => loadFreeAdviceContext(client, "owner-fixture", "budget", now), /전체 가계부/);
  truncated = false; failed = true;
  await assert.rejects(() => loadFreeAdviceContext(client, "owner-fixture", "assistant", now), /기록을 불러오지/);
});

test("provider needs explicit consent and both dedicated free settings; paid keys cannot enable it", async () => {
  let calls = 0; const forbidden: typeof fetch = async () => { calls++; throw new Error("unexpected provider"); };
  await assert.rejects(() => provider.generateFreeAdvice({ ...input, acknowledged: false }, environment, forbidden), { code: "FREE_ADVICE_ACK_REQUIRED" });
  for (const env of [{}, { GEMINI_API_KEY: "old-paid", OPENAI_API_KEY: "old-paid", GEMINI_FREE_TIER_CONFIRMED: "true" }, { GEMINI_FREE_API_KEY: "synthetic", GEMINI_FREE_TIER_CONFIRMED: "false" }]) {
    await assert.rejects(() => provider.generateFreeAdvice(input, env, forbidden), { code: "FREE_ADVICE_NOT_CONFIGURED" });
  }
  assert.equal(calls, 0);
});

test("free advice makes one bounded request with no tools or raw records", async () => {
  let calls = 0;
  const request: typeof fetch = async (url, init) => {
    calls++;
    assert.equal(String(url), `https://generativelanguage.googleapis.com/v1beta/models/${policy.FREE_GEMINI_MODEL}:generateContent`);
    assert.equal(new Headers(init?.headers).get("x-goog-api-key"), "synthetic-free-only");
    assert.equal(init?.cache, "no-store"); assert.equal(init?.redirect, "error"); assert.ok(init?.signal);
    const body = JSON.parse(String(init?.body));
    assert.equal(body.store, false); assert.equal(body.tools, undefined); assert.equal(body.cachedContent, undefined);
    assert.ok(!String(init?.body).includes("synthetic-free-only"));
    assert.match(body.contents[0].parts[0].text, /기록 누락은 활동 없음이나 건강함으로 해석하지 않는다/);
    return output();
  };
  assert.deepEqual(await provider.generateFreeAdvice(input, environment, request), advice);
  assert.equal(calls, 1);
});

test("quota, network and incomplete output stop without retries, fallback or leaked errors", async () => {
  const cases: [typeof fetch, string][] = [
    [async () => Response.json({ error: { status: "RESOURCE_EXHAUSTED", message: "PRIVATE-PROVIDER" } }, { status: 429 }), "FREE_ADVICE_QUOTA"],
    [async () => { throw new Error("PRIVATE-KEY"); }, "FREE_ADVICE_UNAVAILABLE"],
    [async () => output("MAX_TOKENS"), "FREE_ADVICE_UNREADABLE"],
    [async () => Response.json({ candidates: [] }), "FREE_ADVICE_UNREADABLE"],
  ];
  for (const [response, code] of cases) {
    let calls = 0;
    await assert.rejects(() => provider.generateFreeAdvice(input, environment, async (...args) => { calls++; return response(...args); }), error => {
      assert.equal((error as provider.FreeAdviceError).code, code);
      assert.ok(!String(error).includes("PRIVATE-")); return true;
    });
    assert.equal(calls, 1);
  }
  assert.equal(provider.parseFreeAdvice(JSON.stringify({ ...advice, nextSteps: ["", "x"] })), null);
  assert.equal(provider.parseFreeAdvice(JSON.stringify({ ...advice, summary: "x".repeat(701) })), null);
});

function routeFixture() {
  const state = { authenticated: true, configured: true, recordsFail: false, context, recordCalls: 0, providerCalls: 0 };
  const exports = {};
  const modules: Record<string, unknown> = {
    "node:crypto": { createHash },
    "@/lib/supabase-server": { createServerSupabaseClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.authenticated ? { id: "owner-fixture" } : null }, error: null }) } }) },
    "@/lib/free-advice-context": contextModule,
    "@/lib/free-advice-records": { loadFreeAdviceContext: async (_client: unknown, userId: string) => { state.recordCalls++; assert.equal(userId, "owner-fixture"); if (state.recordsFail) throw new Error("PRIVATE-DB"); return state.context; } },
    "@/lib/free-gemini-policy": { ...policy, isFreeGeminiConfigured: () => state.configured },
    "@/lib/free-advice": { FreeAdviceError: provider.FreeAdviceError, generateFreeAdvice: async (args: typeof input) => { state.providerCalls++; assert.equal(args.acknowledged, true); assert.deepEqual(args.context, state.context); return advice; } },
  };
  const code = ts.transpileModule(readFileSync(new URL("../app/api/ai/free-advice/route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(`(function(exports, require) { ${code}\n})`, { Response, console })(exports, (name: string) => { assert.ok(name in modules, `unexpected import ${name}`); return modules[name]; });
  const { POST } = exports as { POST: (request: Request) => Promise<Response> };
  return { state, post: (body: unknown) => POST(new Request("https://fixture.local/api/ai/free-advice", { method: "POST", body: JSON.stringify(body) })) };
}

test("route validates authentication, literal actions, body fields and consent before reading records", async () => {
  const { state, post } = routeFixture();
  state.authenticated = false;
  assert.equal((await post({ action: "preview", scope: "budget" })).status, 401);
  state.authenticated = true;
  for (const body of [
    { action: ["preview"], scope: "budget" }, { action: ["analyze"], scope: "budget" },
    { action: "preview", scope: ["budget"] }, { action: "preview", scope: "budget", userId: "victim" },
    { action: "analyze", scope: "budget", freeDataUseAcknowledged: "true" },
    { action: "preview", scope: "budget", question: "x".repeat(501) },
  ]) assert.equal((await post(body)).status, 400);
  state.configured = false;
  assert.equal((await post({ action: "analyze", scope: "budget", freeDataUseAcknowledged: true })).status, 503);
  assert.equal(state.recordCalls, 0); assert.equal(state.providerCalls, 0);
});

test("preview does not call AI; analysis requires exactly the reviewed snapshot and real records", async () => {
  const { state, post } = routeFixture();
  const preview = await post({ action: "preview", scope: "budget" });
  assert.equal(preview.status, 200); assert.equal(preview.headers.get("cache-control"), "private, no-store");
  const { fingerprint } = await preview.json();
  assert.equal(state.providerCalls, 0);
  const analyze = { action: "analyze", scope: "budget", fingerprint, freeDataUseAcknowledged: true };
  assert.equal((await post({ ...analyze, fingerprint: "stale" })).status, 409);
  assert.equal(state.providerCalls, 0);
  const result = await post(analyze);
  assert.equal(result.status, 200); assert.equal((await result.json()).source, "free-gemini");
  assert.equal(state.providerCalls, 1);
  state.context = contextModule.buildFreeAdviceContext("budget", {}, now);
  const empty = await (await post({ action: "preview", scope: "budget" })).json();
  assert.equal((await post({ ...analyze, fingerprint: empty.fingerprint })).status, 422);
  state.recordsFail = true;
  const failed = await post(analyze); assert.equal(failed.status, 503); assert.ok(!(await failed.text()).includes("PRIVATE-DB"));
  assert.equal(state.providerCalls, 1);
});

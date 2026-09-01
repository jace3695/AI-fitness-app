import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const text = (value: unknown, maxLength = 80) => typeof value === "string" ? value.trim().slice(0, maxLength) : "";
const finiteNumber = (value: unknown) => {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
};

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const authorization = request.headers.get("Authorization") ?? "";
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authorization } } });
  const { data: { user } } = await anon.auth.getUser();
  if (!user) return json({ error: "Unauthorized" }, 401);
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const parsedBody = await request.json().catch(() => ({}));
  const body = parsedBody && typeof parsedBody === "object" && !Array.isArray(parsedBody)
    ? parsedBody as Record<string, unknown>
    : {};

  if (body.action === "reserve") {
    if (body.userId !== user.id) return json({ error: "Unauthorized" }, 403);
    const provider = text(body.provider, 20);
    const model = text(body.model);
    const feature = text(body.feature);
    const usageKind = text(body.usageKind, 20);
    const estimatedCostKrw = finiteNumber(body.estimatedCostKrw);
    if (!(["google", "openai"].includes(provider) && model && feature && ["tokens", "characters"].includes(usageKind) && estimatedCostKrw !== null && estimatedCostKrw > 0)) {
      return json({ error: "Invalid usage details" }, 400);
    }
    const { data, error } = await admin.rpc("reserve_ai_budget_with_policy", { p_user_id: user.id, p_provider: provider, p_model: model, p_feature: feature, p_estimated_cost_krw: estimatedCostKrw, p_usage_kind: usageKind });
    if (error) return json({ error: error.message }, 400);
    const row = data?.[0] ?? null;
    return json(row ? { reservation_id: row.reservation_id, spent_krw: row.spent_krw, remaining_krw: row.remaining_krw, restriction_reason: row.restriction_reason } : {});
  }
  if (body.action === "finalize") {
    const { error } = await admin.rpc("finalize_ai_usage", { p_user_id: user.id, p_reservation_id: body.reservationId, p_input_units: body.inputUnits, p_output_units: body.outputUnits, p_actual_cost_krw: body.actualCostKrw });
    return error ? json({ error: error.message }, 400) : json({ success: true });
  }
  if (body.action === "cancel") {
    const { error } = await admin.rpc("cancel_ai_budget_reservation", { p_user_id: user.id, p_reservation_id: body.reservationId });
    return error ? json({ error: error.message }, 400) : json({ success: true });
  }
  return json({ error: "Invalid action" }, 400);
});

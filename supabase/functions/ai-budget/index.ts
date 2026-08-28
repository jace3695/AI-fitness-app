import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const authorization = request.headers.get("Authorization") ?? "";
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authorization } } });
  const { data: { user } } = await anon.auth.getUser();
  if (!user) return json({ error: "Unauthorized" }, 401);
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const body = await request.json().catch(() => ({}));

  if (body.action === "reserve") {
    if (body.userId !== user.id) return json({ error: "Unauthorized" }, 403);
    const { data, error } = await admin.rpc("reserve_ai_budget", { p_user_id: user.id, p_provider: body.provider, p_model: body.model, p_feature: body.feature, p_estimated_cost_krw: body.estimatedCostKrw, p_usage_kind: body.usageKind });
    if (error) return json({ error: error.message }, 400);
    const row = data?.[0] ?? null;
    return json(row ? { reservation_id: row.reservation_id, spent_krw: row.spent_krw, remaining_krw: row.remaining_krw } : {});
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

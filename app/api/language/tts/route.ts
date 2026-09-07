import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { AiBudgetExceededError, cancelAiBudgetReservation, finalizeAiUsage, reserveAiBudget, standardTtsCostKrw } from "@/lib/ai-budget";

export async function POST(req: NextRequest) {
  let stage = "authenticate";
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    const body = await req.json();
    const { text } = body;

    if (typeof text !== "string" || !text.trim() || text.length > 1200) {
      return NextResponse.json({ error: "text is required" }, { status: 400 });
    }

    const apiKey = process.env.GOOGLE_TTS_API_KEY;

    if (!apiKey) {
      console.warn("[japanese-tts] configuration_missing");
      return NextResponse.json(
        { error: "음성 서비스 설정이 아직 준비되지 않았습니다.", code: "TTS_NOT_CONFIGURED" },
        { status: 503 }
      );
    }

    const safeText = String(text).trim().slice(0, 1200);
    let reservation;
    stage = "budget_reservation";
    try {
      reservation = await reserveAiBudget(supabase, user.id, { provider: "google", model: "google-standard-tts", feature: "japanese-tts", estimatedCostKrw: standardTtsCostKrw(safeText.length), usageKind: "characters" });
    } catch (error) {
      if (error instanceof AiBudgetExceededError) return NextResponse.json({ error: error.message, budgetLimited: true }, { status: 402 });
      throw error;
    }
    stage = "provider_request";
    const response = await fetch(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: { text: safeText },
          voice: { languageCode: "ja-JP" },
          audioConfig: { audioEncoding: "MP3" },
        }),
      }
    );

    if (!response.ok) {
      await cancelAiBudgetReservation(supabase, reservation.id);
      console.warn("[japanese-tts] provider_failed", { status: response.status });
      return NextResponse.json(
        { error: "음성 서비스 연결에 문제가 있습니다.", code: "TTS_PROVIDER_FAILED" },
        { status: 502 }
      );
    }

    const data = await response.json();
    if (!data.audioContent) {
      await cancelAiBudgetReservation(supabase, reservation.id);
      console.warn("[japanese-tts] empty_audio");
      return NextResponse.json({ error: "음성을 만들지 못했습니다.", code: "TTS_EMPTY_AUDIO" }, { status: 502 });
    }
    stage = "usage_finalize";
    await finalizeAiUsage(supabase, reservation.id, { inputUnits: safeText.length, actualCostKrw: standardTtsCostKrw(safeText.length) });
    return NextResponse.json({ audioContent: data.audioContent });
  } catch {
    console.error("[japanese-tts] request_failed", { stage });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

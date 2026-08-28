import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { AiBudgetExceededError, cancelAiBudgetReservation, finalizeAiUsage, reserveAiBudget, standardTtsCostKrw } from "@/lib/ai-budget";

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    const body = await req.json();
    const { text } = body;

    if (!text) {
      return NextResponse.json({ error: "text is required" }, { status: 400 });
    }

    const apiKey = process.env.GOOGLE_TTS_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "Google TTS API key is not configured" },
        { status: 500 }
      );
    }

    const safeText = String(text).trim().slice(0, 1200);
    let reservation;
    try {
      reservation = await reserveAiBudget(supabase, user.id, { provider: "google", model: "google-standard-tts", feature: "japanese-tts", estimatedCostKrw: standardTtsCostKrw(safeText.length), usageKind: "characters" });
    } catch (error) {
      if (error instanceof AiBudgetExceededError) return NextResponse.json({ error: error.message, budgetLimited: true }, { status: 402 });
      throw error;
    }
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
      const error = await response.json();
      return NextResponse.json(
        { error: error.error?.message || "TTS request failed" },
        { status: response.status }
      );
    }

    const data = await response.json();
    await finalizeAiUsage(supabase, reservation.id, { inputUnits: safeText.length, actualCostKrw: standardTtsCostKrw(safeText.length) });
    return NextResponse.json({ audioContent: data.audioContent });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

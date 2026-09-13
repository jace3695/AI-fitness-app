import { NextResponse } from "next/server";
import {
  isSupportedDietPhotoDataUrl,
  parseDietPhotoAnalysisText,
  type DietPhotoMealSlot,
} from "@/app/data/dietPhotoAnalysis";
import { AiBudgetExceededError } from "@/lib/ai-budget";
import { generateAiText, isAiFeatureAvailable } from "@/lib/ai-router";
import { createServerSupabaseClient } from "@/lib/supabase-server";

type RequestBody = {
  mealSlot?: DietPhotoMealSlot;
  imageDataUrl?: string;
};

function buildPrompt(mealSlot: DietPhotoMealSlot) {
  return `너는 식사 사진에서 보이는 항목을 보수적으로 추정하는 기록 보조 도구야.
이 사진은 ${mealSlot === "lunch" ? "점심" : "저녁"} 식사야.

반드시 지킬 규칙:
- 한국어 음식명만 최대 6개 반환
- 사진에서 직접 보이지 않는 재료는 추측하지 말 것
- proteinGrams는 음식 전체의 단백질 추정 g, cookedRiceGrams는 조리된 밥의 추정 g
- 양을 판단할 수 없으면 해당 수치를 null로 반환
- 정밀한 영양 계산이나 의료 조언을 하지 말 것
- confidence는 high, medium, low 중 하나
- vegetables는 enough, some, none, unknown 중 하나
- note에는 가림, 용기 크기, 소스 등 오차 원인만 짧게 작성

JSON만 반환:
{"foods":[],"proteinGrams":null,"cookedRiceGrams":null,"vegetables":"unknown","confidence":"low","note":""}`;
}
export async function POST(request: Request) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

    const body = (await request.json()) as RequestBody;
    const mealSlot = body.mealSlot === "lunch" || body.mealSlot === "dinner"
      ? body.mealSlot
      : null;
    const imageDataUrl = body.imageDataUrl?.trim() ?? "";
    if (!mealSlot || !isSupportedDietPhotoDataUrl(imageDataUrl)) {
      return NextResponse.json({ error: "식사 종류와 지원되는 사진을 확인해 주세요." }, { status: 400 });
    }
    if (!isAiFeatureAvailable("diet-photo-analysis")) {
      return NextResponse.json({ error: "현재 사진 분석을 사용할 수 없어요." }, { status: 503 });
    }

    const prompt = buildPrompt(mealSlot);
    const generated = await generateAiText({
      supabase,
      userId: user.id,
      feature: "diet-photo-analysis",
      promptText: prompt,
      maxOutputTokens: 350,
      responseFormat: "json",
      temperature: 0.2,
      openAiMessages: [{
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: imageDataUrl } },
        ],
      }],
    });
    const analysis = parseDietPhotoAnalysisText(generated.text);
    if (!analysis) {
      return NextResponse.json({ error: "사진에서 식사량을 판단하지 못했어요. 직접 입력해 주세요." }, { status: 422 });
    }
    return NextResponse.json(analysis);
  } catch (error) {
    if (error instanceof AiBudgetExceededError) {
      return NextResponse.json({ error: error.message, budgetLimited: true }, { status: 402 });
    }
    return NextResponse.json({ error: "사진 분석 중 오류가 발생했어요. 사진은 저장되지 않았습니다." }, { status: 500 });
  }
}

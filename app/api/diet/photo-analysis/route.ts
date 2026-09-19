import { NextResponse } from "next/server";
import { analyzeFreeDietPhoto, FREE_DIET_PHOTO_MODEL, FreeDietPhotoError } from "@/lib/diet-photo-free-ai";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export async function POST(request: Request) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (!user) {
      // Keep credentials and request bodies out of hosted diagnostics.
      console.warn("[diet-photo-analysis] authentication rejected", {
        code: authError?.code ?? "missing_user",
        status: authError?.status ?? null,
      });
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }

    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "사진 입력 내용을 확인해 주세요." }, { status: 400 });
    }
    const analysis = await analyzeFreeDietPhoto(body);
    return NextResponse.json(analysis);
  } catch (error) {
    if (error instanceof FreeDietPhotoError) {
      // Log classification only: provider messages can contain request data.
      console.warn("[diet-photo-analysis] provider request failed", {
        provider: "google",
        model: FREE_DIET_PHOTO_MODEL,
        category: error.category,
        status: error.providerStatus ?? null,
        code: error.providerCode ?? "UNKNOWN",
      });
      return NextResponse.json({
        error: error.message,
      }, { status: error.status });
    }
    console.warn("[diet-photo-analysis] analysis failed", {
      category: "unexpected_failure",
    });
    return NextResponse.json({ error: "사진 분석 중 오류가 발생했어요. 사진은 저장되지 않았습니다." }, { status: 500 });
  }
}

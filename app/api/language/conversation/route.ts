import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { AiBudgetExceededError } from "@/lib/ai-budget";
import { generateAiText, isAiFeatureAvailable } from "@/lib/ai-router";

type Situation = "카페" | "여행" | "일상" | "업무" | "친구";

type HistoryMessage =
  | { role: "user"; text: string }
  | {
      role: "assistant";
      reply: string;
      replyReading: string;
      replyKoreanPronunciation: string;
      correction: string;
      correctionReading: string;
      correctionKoreanPronunciation: string;
      explanation: string;
    };

type RequestBody = {
  situation: Situation;
  message: string;
  history?: HistoryMessage[];
};

type AIResponse = {
  reply: string;
  replyReading: string;
  replyKoreanPronunciation: string;
  correction: string;
  correctionReading: string;
  correctionKoreanPronunciation: string;
  explanation: string;
};

const SITUATION_PROMPT: Record<Situation, string> = {
  카페: `너는 카페 점원이야. 손님이 말을 걸면 점원 입장에서 대답해.
말투: です・ます체. 밝고 친절하게. 주문 확인, 사이즈/온도 질문, 감사 인사 등 카페 실무 표현 사용.
예) いらっしゃいませ！ / サイズはいかがなさいますか？ / 少々お待ちください。`,

  여행: `너는 현지 일본인이야. 여행자가 길이나 장소를 물어보면 친절하게 안내해.
말투: です・ます체. 간결하고 명확하게. 방향, 교통, 주문, 예약 등 여행 실전 표현 사용.
예) まっすぐ行って、右に曲がってください。 / こちらのメニューはいかがですか？`,

  일상: `너는 일본어 회화 파트너야. 일상적인 주제로 자연스럽게 대화해.
말투: です・ます체 기본이지만 딱딱하지 않게. 친근하고 자연스럽게.
예) そうなんですね！ / 最近どうですか？ / いいですね〜。`,

  업무: `너는 직장 동료 또는 거래처 담당자야. 비즈니스 상황에서 정중하게 대화해.
말투: 경어 필수 (ございます・いたします・よろしくお願いいたします 등). 격식 있고 신뢰감 있는 표현.
예) お世話になっております。 / ご確認のほど、よろしくお願いいたします。`,

  친구: `너는 친한 일본인 친구야. 편하게 반말로 대화해.
말투: 반말체 필수 (だ / だよ / じゃん / ね / よ 등). 젊은 세대 구어체, 줄임말, 감탄사 자연스럽게.
예) えー、マジで？ / それ、わかる〜！ / どうしたの？`,
};

function buildSystemPrompt(situation: Situation): string {
  return `${SITUATION_PROMPT[situation]}

【응답 규칙 — 반드시 준수】
1. reply: 위 상황과 말투에 맞게 일본어로 짧고 자연스럽게 (1~2문장). 대화가 이어지도록 반응하거나 가볍게 질문해.
2. replyReading: reply를 히라가나/가타카나 중심 읽기로 작성.
3. replyKoreanPronunciation: reply의 한국어식 발음 참고를 작성.
4. correction: 사용자 문장에서 어색한 부분만 고쳐서 자연스러운 일본어로 제시. 이미 자연스러우면 원문 그대로.
5. correctionReading: correction을 히라가나/가타카나 중심 읽기로 작성.
6. correctionKoreanPronunciation: correction의 한국어식 발음 참고를 작성.
7. explanation: 수정 이유 또는 자연스러운 이유를 한국어로 1~2문장으로 설명.
   - 틀린 부분이 있다면 가능하면 "일본어 원문 + 읽기 + 한글 발음 참고"를 함께 적어.

【출력 형식 — 절대 규칙】
아래 JSON만 출력. 코드블록, 마크다운, 추가 텍스트 금지.
{"reply":"(일본어)","replyReading":"(읽기)","replyKoreanPronunciation":"(한글 발음 참고)","correction":"(일본어)","correctionReading":"(읽기)","correctionKoreanPronunciation":"(한글 발음 참고)","explanation":"(한국어 설명)"}`;
}

function safeParseJSON(raw: string): Partial<AIResponse> {
  if (!raw) return {};
  let text = raw.trim();

  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();

  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    text = text.slice(first, last + 1);
  }

  try {
    return JSON.parse(text) as Partial<AIResponse>;
  } catch {
    // JSON 복구 시도: 제어 문자 제거 후 재시도
    try {
      const cleaned = text.replace(/[\x00-\x1F\x7F]/g, (c) =>
        c === "\n" || c === "\r" || c === "\t" ? c : ""
      );
      return JSON.parse(cleaned) as Partial<AIResponse>;
    } catch {
      return {};
    }
  }
}

async function callOpenAI(
  situation: Situation,
  message: string,
  history: HistoryMessage[],
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  userId: string,
): Promise<AIResponse> {
  if (!isAiFeatureAvailable("language-conversation")) {
    return {
      reply: "（モック）こんにちは！何かお手伝いできますか？",
      replyReading: "（モック）こんにちは！なにかおてつだいできますか？",
      replyKoreanPronunciation: "(모크) 곤니치와! 나니카 오테츠다이 데키마스카?",
      correction: message,
      correctionReading: message,
      correctionKoreanPronunciation: "입력 문장의 발음 참고를 생성하지 못했습니다.",
      explanation:
        "OPENAI_API_KEY가 없어 임시 응답입니다. .env.local에 키를 추가해 주세요.",
    };
  }

  const pastMessages: { role: "user" | "assistant"; content: string }[] = [];
  for (const m of history.slice(-8)) {
    if (m.role === "user") {
      pastMessages.push({ role: "user", content: m.text });
    } else {
      pastMessages.push({ role: "assistant", content: m.reply });
    }
  }

  const systemPrompt = buildSystemPrompt(situation);
  const promptText = `${systemPrompt}\n${pastMessages.map((item) => item.content).join("\n")}\n${message}`;
  const generated = await generateAiText({
    supabase,
    userId,
    feature: "language-conversation",
    promptText,
    maxOutputTokens: 300,
    responseFormat: "json",
    temperature: 0.75,
    openAiMessages: [
      { role: "system", content: systemPrompt },
      ...pastMessages,
      { role: "user", content: message },
    ],
  });
  const parsed = safeParseJSON(generated.text);

  return {
    reply:
      typeof parsed.reply === "string" && parsed.reply.trim()
        ? parsed.reply
        : "すみません、もう一度お願いします。",
    replyReading:
      typeof parsed.replyReading === "string" && parsed.replyReading.trim()
        ? parsed.replyReading
        : "すみません、もういちどおねがいします。",
    replyKoreanPronunciation:
      typeof parsed.replyKoreanPronunciation === "string" &&
      parsed.replyKoreanPronunciation.trim()
        ? parsed.replyKoreanPronunciation
        : "스미마셍, 모-이치도 오네가이시마스.",
    correction:
      typeof parsed.correction === "string" && parsed.correction.trim()
        ? parsed.correction
        : message,
    correctionReading:
      typeof parsed.correctionReading === "string" && parsed.correctionReading.trim()
        ? parsed.correctionReading
        : message,
    correctionKoreanPronunciation:
      typeof parsed.correctionKoreanPronunciation === "string" &&
      parsed.correctionKoreanPronunciation.trim()
        ? parsed.correctionKoreanPronunciation
        : "교정 문장의 한글 발음 참고를 생성하지 못했습니다.",
    explanation:
      typeof parsed.explanation === "string" ? parsed.explanation : "",
  };
}

const VALID_SITUATIONS: Situation[] = ["카페", "여행", "일상", "업무", "친구"];

export async function POST(req: Request) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    const body = (await req.json()) as RequestBody;
    const { situation, message, history = [] } = body;

    if (!message || typeof message !== "string" || !message.trim()) {
      return NextResponse.json({ error: "메시지가 비어 있습니다." }, { status: 400 });
    }

    const safeSituation: Situation = VALID_SITUATIONS.includes(situation) ? situation : "일상";
    const result = await callOpenAI(safeSituation, message.trim(), history, supabase, user.id);
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "알 수 없는 오류";
    if (e instanceof AiBudgetExceededError) return NextResponse.json({ error: msg, budgetLimited: true }, { status: 402 });
    return NextResponse.json(
      { error: `AI 응답 처리 중 오류가 발생했습니다: ${msg}` },
      { status: 500 }
    );
  }
}

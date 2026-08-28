import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { AiBudgetExceededError, cancelAiBudgetReservation, conservativeTokenEstimate, finalizeAiUsage, reserveAiBudget, tokenCostKrw } from '@/lib/ai-budget'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  // 로그인 확인
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { messages, system, max_tokens = 1000 } = await request.json()
  const safeMaxTokens = Math.min(Math.max(Number(max_tokens) || 1000, 1), 2000)

  // Gemini API 호출
  const geminiMessages = messages.map((m: any) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }))

  const model = 'gemini-2.5-flash-lite'
  const promptText = `${typeof system === 'string' ? system : ''}\n${geminiMessages.map((message: { parts: { text: string }[] }) => message.parts[0]?.text ?? '').join('\n')}`
  let reservation
  try {
    reservation = await reserveAiBudget(supabase, user.id, { provider: 'google', model, feature: 'legacy-ai-analysis', estimatedCostKrw: conservativeTokenEstimate(promptText, safeMaxTokens, model) })
  } catch (error) {
    if (error instanceof AiBudgetExceededError) return NextResponse.json({ error: error.message, budgetLimited: true }, { status: 402 })
    throw error
  }
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: system ? { parts: [{ text: system }] } : undefined,
        contents: geminiMessages,
        generationConfig: { maxOutputTokens: safeMaxTokens },
      }),
    }
  )

  const data = await response.json()
  if (!response.ok) {
    await cancelAiBudgetReservation(supabase, reservation.id)
    return NextResponse.json({ error: 'AI 분석에 실패했습니다.' }, { status: 502 })
  }
  const inputTokens = Number(data.usageMetadata?.promptTokenCount ?? promptText.length)
  const outputTokens = Number(data.usageMetadata?.candidatesTokenCount ?? 0)
  await finalizeAiUsage(supabase, reservation.id, { inputUnits: inputTokens, outputUnits: outputTokens, actualCostKrw: tokenCostKrw(model, inputTokens, outputTokens) })

  // Claude 형식으로 변환해서 반환
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
  return NextResponse.json({
    content: [{ type: 'text', text }]
  })
}

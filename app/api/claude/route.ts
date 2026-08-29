import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { AiBudgetExceededError } from '@/lib/ai-budget'
import { generateAiText } from '@/lib/ai-router'

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

  const promptText = `${typeof system === 'string' ? system : ''}\n${geminiMessages.map((message: { parts: { text: string }[] }) => message.parts[0]?.text ?? '').join('\n')}`
  try {
    const generated = await generateAiText({
      supabase,
      userId: user.id,
      feature: 'legacy-ai-analysis',
      promptText,
      maxOutputTokens: safeMaxTokens,
      systemInstruction: typeof system === 'string' ? system : undefined,
      geminiContents: geminiMessages,
    })
    return NextResponse.json({ content: [{ type: 'text', text: generated.text }] })
  } catch (error) {
    if (error instanceof AiBudgetExceededError) return NextResponse.json({ error: error.message, budgetLimited: true }, { status: 402 })
    console.error('Legacy AI Router request failed', { message: error instanceof Error ? error.message : 'unknown' })
    return NextResponse.json({ error: 'AI 분석에 실패했습니다.' }, { status: 502 })
  }
}

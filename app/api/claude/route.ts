import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  // 로그인 확인
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { messages, system, max_tokens = 1000 } = await request.json()

  // Gemini API 호출
  const geminiMessages = messages.map((m: any) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }))

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: system ? { parts: [{ text: system }] } : undefined,
        contents: geminiMessages,
        generationConfig: { maxOutputTokens: max_tokens },
      }),
    }
  )

  const data = await response.json()
  console.log('Gemini 응답:', JSON.stringify(data))

  // Claude 형식으로 변환해서 반환
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
  return NextResponse.json({
    content: [{ type: 'text', text }]
  })
}

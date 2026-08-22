import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  }

  const contentLength = Number(req.headers.get('content-length') || 0)
  if (contentLength > 20_000) {
    return NextResponse.json({ error: '요청 내용이 너무 깁니다.' }, { status: 413 })
  }

  const body = await req.json().catch(() => null)
  const text = typeof body?.text === 'string' ? body.text.trim() : ''

  if (!text || text.length > 1_200) {
    return NextResponse.json({ error: '읽을 문장은 1자 이상 1,200자 이하로 입력해주세요.' }, { status: 400 })
  }

  const response = await fetch(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${process.env.GOOGLE_TTS_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text },
        voice: {
          languageCode: 'ko-KR',
          name: 'ko-KR-Chirp3-HD-Zephyr'
        },
        audioConfig: {
          audioEncoding: 'MP3'
        }
      })
    }
  )

  if (!response.ok) {
    console.error('Google TTS 요청 실패:', response.status)
    return NextResponse.json({ error: '음성 생성 실패' }, { status: 502 })
  }

  const data = await response.json()
  if (!data.audioContent) {
    return NextResponse.json({ error: '음성 생성 실패' }, { status: 502 })
  }

  return NextResponse.json({ audioContent: data.audioContent })
}


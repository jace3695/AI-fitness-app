import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const startOfMonth = `${today.slice(0, 7)}-01`

  const { data, error } = await supabase
    .from('budget_transactions')
    .select('*')
    .eq('user_id', user.id)
    .gte('date', startOfMonth)
    .order('date', { ascending: false })

  if (error) {
    console.log('GET 오류:', JSON.stringify(error))
    return NextResponse.json({ error }, { status: 500 })
  }
  return NextResponse.json({ data })
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { data, error } = await supabase
    .from('budget_transactions')
    .insert({ ...body, user_id: user.id })
    .select()
    .single()

  if (error) {
    console.log('DB 오류:', JSON.stringify(error))
    return NextResponse.json({ error }, { status: 500 })
  }
  return NextResponse.json({ data })
}

export async function DELETE(request: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await request.json()
  const { error } = await supabase
    .from('budget_transactions')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) {
    console.log('DELETE 오류:', JSON.stringify(error))
    return NextResponse.json({ error }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}

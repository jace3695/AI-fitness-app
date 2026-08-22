import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

const MAX_PIN_ATTEMPTS = 5

type PinRecord = {
  version: 1
  salt: string
  hash: string
  failedAttempts: number
  locked: boolean
}

function createPinRecord(pin: string): PinRecord {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(pin, salt, 32).toString('hex')

  return {
    version: 1,
    salt,
    hash,
    failedAttempts: 0,
    locked: false
  }
}

function parsePinRecord(value: string | null): PinRecord | null {
  if (!value) return null

  if (/^\d{4,6}$/.test(value)) {
    return createPinRecord(value)
  }

  try {
    const parsed = JSON.parse(value)
    if (
      parsed?.version !== 1 ||
      typeof parsed.salt !== 'string' ||
      typeof parsed.hash !== 'string'
    ) {
      return null
    }

    return {
      version: 1,
      salt: parsed.salt,
      hash: parsed.hash,
      failedAttempts: Number.isInteger(parsed.failedAttempts) ? Math.max(0, parsed.failedAttempts) : 0,
      locked: Boolean(parsed.locked)
    }
  } catch {
    return null
  }
}

function matchesPin(pin: string, record: PinRecord) {
  const expected = Buffer.from(record.hash, 'hex')
  const actual = scryptSync(pin, record.salt, expected.length)

  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

async function savePinState(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  userId: string,
  enabled: boolean,
  record: PinRecord | null
) {
  return supabase
    .from('budget_user_settings')
    .upsert({
      user_id: userId,
      simple_pin_enabled: enabled,
      simple_pin_hash: record ? JSON.stringify(record) : null
    }, {
      onConflict: 'user_id'
    })
}

async function verifyPin(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  userId: string,
  pin: string,
  storedValue: string | null
) {
  const record = parsePinRecord(storedValue)

  if (!record) {
    return { ok: false as const, status: 409, error: '설정된 간편비밀번호를 확인할 수 없습니다.' }
  }

  if (record.locked) {
    return {
      ok: false as const,
      status: 423,
      error: '간편비밀번호 입력이 잠겼습니다. 계정 암호로 확인해주세요.',
      requiresPassword: true
    }
  }

  if (matchesPin(pin, record)) {
    record.failedAttempts = 0
    record.locked = false
    const { error } = await savePinState(supabase, userId, true, record)

    if (error) {
      return { ok: false as const, status: 500, error: '간편비밀번호 상태를 저장하지 못했습니다.' }
    }

    return { ok: true as const, record }
  }

  record.failedAttempts += 1
  record.locked = record.failedAttempts >= MAX_PIN_ATTEMPTS
  const { error } = await savePinState(supabase, userId, true, record)

  if (error) {
    return { ok: false as const, status: 500, error: '간편비밀번호 상태를 저장하지 못했습니다.' }
  }

  const attemptsRemaining = Math.max(0, MAX_PIN_ATTEMPTS - record.failedAttempts)
  return {
    ok: false as const,
    status: record.locked ? 423 : 403,
    error: record.locked
      ? '간편비밀번호 입력이 잠겼습니다. 계정 암호로 확인해주세요.'
      : `간편비밀번호가 올바르지 않습니다. ${attemptsRemaining}회 더 시도할 수 있습니다.`,
    attemptsRemaining,
    requiresPassword: record.locked
  }
}

export async function POST(req: NextRequest) {
  const contentLength = Number(req.headers.get('content-length') || 0)
  if (contentLength > 20_000) {
    return NextResponse.json({ error: '요청 내용이 너무 깁니다.' }, { status: 413 })
  }

  const supabase = await createServerSupabaseClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const action = body?.action
  const pin = typeof body?.pin === 'string' ? body.pin : ''
  const currentPin = typeof body?.currentPin === 'string' ? body.currentPin : ''
  const newPin = typeof body?.newPin === 'string' ? body.newPin : ''
  const accountPassword = typeof body?.accountPassword === 'string' ? body.accountPassword : ''

  const { data: settings, error: settingsError } = await supabase
    .from('budget_user_settings')
    .select('simple_pin_enabled, simple_pin_hash')
    .eq('user_id', user.id)
    .maybeSingle()

  if (settingsError) {
    return NextResponse.json({ error: '간편비밀번호 설정을 불러오지 못했습니다.' }, { status: 500 })
  }

  const storedValue = settings?.simple_pin_hash || null
  const isConfigured = Boolean(settings?.simple_pin_enabled && storedValue)

  if (action === 'status') {
    return NextResponse.json({ configured: isConfigured })
  }

  if (action === 'verify') {
    if (!/^\d{4,6}$/.test(pin)) {
      return NextResponse.json({ error: '간편비밀번호 4~6자리를 입력해주세요.' }, { status: 400 })
    }

    if (!isConfigured) {
      return NextResponse.json({ error: '설정된 간편비밀번호가 없습니다.' }, { status: 409 })
    }

    const result = await verifyPin(supabase, user.id, pin, storedValue)
    if (!result.ok) {
      return NextResponse.json(result, { status: result.status })
    }

    return NextResponse.json({ verified: true })
  }

  if (action === 'reauthenticate') {
    if (!user.email || !accountPassword) {
      return NextResponse.json({ error: '계정 암호를 입력해주세요.' }, { status: 400 })
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: accountPassword
    })

    if (signInError) {
      return NextResponse.json({ error: '계정 암호가 올바르지 않습니다.' }, { status: 403 })
    }

    const record = parsePinRecord(storedValue)
    if (record) {
      record.failedAttempts = 0
      record.locked = false
      const { error } = await savePinState(supabase, user.id, true, record)
      if (error) {
        return NextResponse.json({ error: '잠금 상태를 해제하지 못했습니다.' }, { status: 500 })
      }
    }

    return NextResponse.json({ verified: true })
  }

  if (action === 'set') {
    if (!/^\d{4,6}$/.test(newPin)) {
      return NextResponse.json({ error: '새 공통 PIN은 6자리 숫자로 입력해주세요.' }, { status: 400 })
    }

    if (isConfigured) {
      if (!/^\d{4,6}$/.test(currentPin)) {
        return NextResponse.json({ error: '기존 간편비밀번호를 입력해주세요.' }, { status: 400 })
      }

      const result = await verifyPin(supabase, user.id, currentPin, storedValue)
      if (!result.ok) {
        return NextResponse.json(result, { status: result.status })
      }

      if (currentPin === newPin) {
        return NextResponse.json({ error: '기존 간편비밀번호와 다른 번호를 입력해주세요.' }, { status: 400 })
      }
    }

    const { error } = await savePinState(supabase, user.id, true, createPinRecord(newPin))
    if (error) {
      return NextResponse.json({ error: '간편비밀번호를 저장하지 못했습니다.' }, { status: 500 })
    }

    return NextResponse.json({ configured: true })
  }

  if (action === 'disable') {
    if (!isConfigured || !/^\d{4,6}$/.test(currentPin)) {
      return NextResponse.json({ error: '기존 간편비밀번호를 입력해주세요.' }, { status: 400 })
    }

    const result = await verifyPin(supabase, user.id, currentPin, storedValue)
    if (!result.ok) {
      return NextResponse.json(result, { status: result.status })
    }

    const { error } = await savePinState(supabase, user.id, false, null)
    if (error) {
      return NextResponse.json({ error: '간편비밀번호를 해제하지 못했습니다.' }, { status: 500 })
    }

    return NextResponse.json({ configured: false })
  }

  return NextResponse.json({ error: '지원하지 않는 요청입니다.' }, { status: 400 })
}

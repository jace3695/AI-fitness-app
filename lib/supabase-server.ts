import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies, headers } from 'next/headers'

export async function createServerSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Supabase 환경변수가 필요합니다.')
  const requestHeaders = await headers()
  const authorization = requestHeaders.get('authorization')

  // Client-only auth stores the session in the browser. API calls forward the
  // access token so Supabase can validate the user and keep RLS in effect.
  if (authorization?.startsWith('Bearer ')) {
    return createClient(url, key, {
      global: { headers: { Authorization: authorization } },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    })
  }

  const cookieStore = await cookies()
  return createServerClient(url, key, {
    cookies: {
      get(name: string) { return cookieStore.get(name)?.value },
      set(name: string, value: string, options: any) { cookieStore.set({ name, value, ...options }) },
      remove(name: string, options: any) { cookieStore.set({ name, value: '', ...options }) },
    },
  })
}

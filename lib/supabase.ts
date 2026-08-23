import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './supabase-config'

let browserClient: SupabaseClient | null = null

export function createClient() {
  if (!browserClient) {
    browserClient = createSupabaseClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'implicit',
        experimental: { passkey: true },
      }
    })
  }

  return browserClient
}

export async function authenticatedFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const { data: { session } } = await createClient().auth.getSession()
  const headers = new Headers(init.headers)

  if (session?.access_token) {
    headers.set('Authorization', `Bearer ${session.access_token}`)
  }

  return fetch(input, { ...init, headers })
}

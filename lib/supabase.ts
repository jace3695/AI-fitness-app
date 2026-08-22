import { createBrowserClient } from '@supabase/ssr'
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './supabase-config'

export function createClient() {
  return createBrowserClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY,
    {
      auth: {
        // @supabase/ssr uses PKCE so password recovery can be completed
        // safely on this app's own /reset-password route.
        experimental: { passkey: true }
      }
    }
  )
}


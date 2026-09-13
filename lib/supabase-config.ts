// Supabase publishable configuration is safe for browser bundles.
// Authorization remains enforced by authenticated sessions and table RLS policies.
const configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const configuredKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
if (Boolean(configuredUrl) !== Boolean(configuredKey)) {
  throw new Error('Supabase URL과 공개 키를 함께 설정해야 합니다.')
}
// Keep the deployed default, but honor an explicitly configured pair in both
// browser and server clients. Never combine one project's URL with another key.
export const SUPABASE_URL = configuredUrl || "https://piqqukiiacncfbztktga.supabase.co"
export const SUPABASE_PUBLISHABLE_KEY = configuredKey || "sb_publishable_Qdr6hARTD3b6J-crTSNUHg_-VTUsyU_"

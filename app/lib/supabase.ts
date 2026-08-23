import { createBrowserClient } from "@supabase/ssr";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey);

const recoverySearchParams =
  typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
const recoveryHashParams =
  typeof window !== "undefined"
    ? new URLSearchParams(window.location.hash.replace(/^#/, ""))
    : null;

// Supabase may consume and clear the recovery hash while the client is created.
// Capture it first so AuthGate can always render the password setup screen.
export const isPasswordRecoveryRedirect = Boolean(
  recoverySearchParams?.get("recovery") === "1" ||
  recoverySearchParams?.has("code") ||
  recoveryHashParams?.get("type") === "recovery",
);

export const supabase = isSupabaseConfigured
  ? createBrowserClient(supabaseUrl!, supabaseKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        // Recovery emails are often requested on one device and opened on another.
        // The implicit flow keeps that cross-device password-reset path working;
        // PKCE would require the original browser's locally stored verifier.
        flowType: "implicit",
      },
    })
  : null;

// Shared by photo analysis and advice. This attestation must refer to the
// dedicated project with NO billing account, not a legacy/paid API key.
export const FREE_GEMINI_MODEL = "gemini-3.5-flash-lite";
export type FreeGeminiEnvironment = Readonly<Record<string, string | undefined>>;

export function isFreeGeminiConfigured(environment: FreeGeminiEnvironment = process.env) {
  return environment.GEMINI_FREE_TIER_CONFIRMED === "true" && Boolean(environment.GEMINI_FREE_API_KEY?.trim());
}

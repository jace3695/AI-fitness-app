/** Candidate only: no implicit activation on an existing Preview or production. */
export function commonCharacterEnabled(env: Record<string, string | undefined>) {
  if (env.YEONI_COMMON_CHARACTER_ENABLED === '0') return false;
  if (env.VERCEL_ENV === 'production' || env.NODE_ENV === 'production' && !env.VERCEL_ENV) return false;
  return env.NODE_ENV === 'development' || env.VERCEL_ENV === 'preview' && env.YEONI_COMMON_CHARACTER_ENABLED === '1';
}

export function isQuietCharacterRoute(path: string) {
  return /^\/(fitness|growth\/(drawing|handwriting|typing))(\/|$)/.test(path);
}

export function isCharacterReviewRoute(path: string) {
  return /^\/assistant\/.*check(\/|$)/.test(path);
}

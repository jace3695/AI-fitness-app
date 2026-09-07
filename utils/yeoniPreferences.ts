export const YEONI_PREFERENCES_KEY = "yeoniAppearanceSettingsV1";

export type YeoniPreferences = {
  visible: boolean;
  motion: "reactions" | "home" | "off";
};

export const DEFAULT_YEONI_PREFERENCES: YeoniPreferences = { visible: true, motion: "reactions" };

function parseObject(raw: string | null): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}

/** Appearance is a device preference, separate from personal records/cloud backups. */
export function parseYeoniPreferences(raw: string | null, legacyRaw: string | null = null): YeoniPreferences {
  const value = parseObject(raw);
  if (value) return {
    visible: value.visible !== false,
    motion: value.motion === "home" || value.motion === "off" ? value.motion : "reactions",
  };
  const legacy = parseObject(legacyRaw);
  return {
    visible: legacy?.showCompanion !== false,
    motion: legacy?.homeCompanionMotion === false ? "off" : "reactions",
  };
}

export function resolveYeoniMotion(preferences: YeoniPreferences, requested: "once" | "ambient" | "off") {
  if (!preferences.visible || preferences.motion === "off" || requested === "off") return "off";
  return requested === "ambient" && preferences.motion === "home" ? "ambient" : "once";
}

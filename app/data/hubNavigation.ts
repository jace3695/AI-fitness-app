export const HUB_NAV_STORAGE_KEY = "ai-yeoni-bottom-nav:v1";
export const HUB_NAV_MAX_VISIBLE_APPS = 6;

export const HUB_APPS = [
  { id: "assistant", href: "/", label: "AI 연이", menuLabel: "AI 연이", icon: "✦", required: true },
  { id: "fitness", href: "/fitness", label: "운동", menuLabel: "운동", icon: "◒", required: false },
  { id: "budget", href: "/budget", label: "가계부", menuLabel: "가계부", icon: "₩", required: false },
  { id: "diet", href: "/diet", label: "식단", menuLabel: "식단", icon: "🥗", required: false },
  { id: "language", href: "/language", label: "언어", menuLabel: "언어 학습", icon: "あ", required: false },
  { id: "growth", href: "/growth", label: "성장", menuLabel: "자기계발", icon: "↗", required: false },
  { id: "calendar", href: "/calendar", label: "달력", menuLabel: "통합 달력", icon: "▦", required: false },
  { id: "settings", href: "/settings", label: "설정", menuLabel: "통합 설정", icon: "⚙", required: false },
] as const;

export type HubAppId = (typeof HUB_APPS)[number]["id"];

export const DEFAULT_HUB_NAV_IDS: HubAppId[] = [
  "assistant",
  "fitness",
  "budget",
  "diet",
  "language",
];

const HUB_APP_IDS = new Set<HubAppId>(HUB_APPS.map((app) => app.id));

export function normalizeHubNavIds(value: unknown): HubAppId[] {
  if (!Array.isArray(value)) return [...DEFAULT_HUB_NAV_IDS];

  const normalized = value.filter(
    (id, index): id is HubAppId =>
      typeof id === "string" &&
      HUB_APP_IDS.has(id as HubAppId) &&
      value.indexOf(id) === index,
  );

  const withAssistant = normalized.includes("assistant")
    ? normalized
    : ["assistant" as const, ...normalized];

  return withAssistant.slice(0, HUB_NAV_MAX_VISIBLE_APPS);
}

export function parseHubNavIds(raw: string | null): HubAppId[] {
  if (!raw) return [...DEFAULT_HUB_NAV_IDS];
  try {
    return normalizeHubNavIds(JSON.parse(raw));
  } catch {
    return [...DEFAULT_HUB_NAV_IDS];
  }
}

export function isHubAppActive(pathname: string, href: string) {
  if (href === "/") {
    return pathname === "/" || pathname === "/assistant" || pathname.startsWith("/assistant/");
  }
  return pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));
}

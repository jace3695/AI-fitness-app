import type { CourseTrack } from "@/data/curriculum";

export const INTEGRATED_LEARNING_SETTINGS_KEY = "integratedLearningSettingsV1";

export type IntegratedLearningSettings = {
  dailyMinutes: 5 | 10 | 20;
  preferredTrack: CourseTrack;
  showReading: boolean;
  showMeaning: boolean;
  autoPlayDialogue: boolean;
  includeSpeaking: boolean;
  audioRate: 0.8 | 0.9 | 1;
};

export const DEFAULT_INTEGRATED_LEARNING_SETTINGS: IntegratedLearningSettings = {
  dailyMinutes: 10,
  preferredTrack: "foundation",
  showReading: true,
  showMeaning: true,
  autoPlayDialogue: false,
  includeSpeaking: true,
  audioRate: 0.9,
};

export function loadIntegratedLearningSettings(): IntegratedLearningSettings {
  if (typeof window === "undefined") return DEFAULT_INTEGRATED_LEARNING_SETTINGS;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(INTEGRATED_LEARNING_SETTINGS_KEY) ?? "null") as Partial<IntegratedLearningSettings> | null;
    if (!parsed || typeof parsed !== "object") return DEFAULT_INTEGRATED_LEARNING_SETTINGS;
    return {
      dailyMinutes: parsed.dailyMinutes === 5 || parsed.dailyMinutes === 20 ? parsed.dailyMinutes : 10,
      preferredTrack: parsed.preferredTrack === "work" || parsed.preferredTrack === "travel" ? parsed.preferredTrack : "foundation",
      showReading: typeof parsed.showReading === "boolean" ? parsed.showReading : true,
      showMeaning: typeof parsed.showMeaning === "boolean" ? parsed.showMeaning : true,
      autoPlayDialogue: parsed.autoPlayDialogue === true,
      includeSpeaking: typeof parsed.includeSpeaking === "boolean" ? parsed.includeSpeaking : true,
      audioRate: parsed.audioRate === 0.8 || parsed.audioRate === 1 ? parsed.audioRate : 0.9,
    };
  } catch {
    return DEFAULT_INTEGRATED_LEARNING_SETTINGS;
  }
}

export function saveIntegratedLearningSettings(settings: IntegratedLearningSettings) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(INTEGRATED_LEARNING_SETTINGS_KEY, JSON.stringify(settings));
}


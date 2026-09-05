import {
  DEFAULT_WEIGHT_GOAL,
  type InbodyRecordStore,
  type WeightGoal,
  type WeightRecordStore,
} from "./recordStorage.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export type ChangeDirection = "down" | "stable" | "up" | "unknown";

export interface WeightAveragePoint {
  dateKey: string;
  value: number;
  sampleCount: number;
}

export interface MetricChange {
  latest?: number;
  latestDateKey?: string;
  previous?: number;
  change?: number;
  direction: ChangeDirection;
}

export interface WeightManagementSummary {
  start?: { dateKey: string; value: number };
  latest?: { dateKey: string; value: number };
  sevenDayAverage?: number;
  sevenDaySampleCount: number;
  previousSevenDayAverage?: number;
  previousSevenDaySampleCount: number;
  weeklyChange?: number;
  weeklyDirection: ChangeDirection;
  goal: {
    minKg: number;
    maxKg: number;
    referenceWeight?: number;
    remainingKg?: number;
    progressPercent?: number;
    state: "above" | "within" | "below" | "unknown";
  };
  bodyFat: MetricChange;
  skeletalMuscle: MetricChange;
  assessment: {
    tone: "positive" | "neutral" | "caution" | "insufficient";
    title: string;
    description: string;
  };
}

type WeightEntry = { dateKey: string; value: number; day: number };

function dateKeyToDay(dateKey: string) {
  const match = DATE_KEY_PATTERN.exec(dateKey);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = Number(match[3]);
  const time = Date.UTC(year, month - 1, date);
  const parsed = new Date(time);
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== date
  ) {
    return null;
  }
  return Math.floor(time / DAY_MS);
}

function getWeightEntries(weights: WeightRecordStore, cutoffDateKey?: string) {
  return Object.entries(weights)
    .flatMap(([dateKey, record]): WeightEntry[] => {
      const day = dateKeyToDay(dateKey);
      if (
        day === null ||
        (cutoffDateKey && dateKey > cutoffDateKey) ||
        !Number.isFinite(record.weight) ||
        record.weight <= 0
      ) {
        return [];
      }
      return [{ dateKey, value: record.weight, day }];
    })
    .sort((left, right) => left.dateKey.localeCompare(right.dateKey));
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function getWindowAverage(entries: WeightEntry[], endDay: number, days = 7) {
  const values = entries
    .filter((entry) => entry.day > endDay - days && entry.day <= endDay)
    .map((entry) => entry.value);
  return {
    value: values.length ? average(values) : undefined,
    sampleCount: values.length,
  };
}

function getDirection(change: number | undefined, threshold: number): ChangeDirection {
  if (change === undefined || !Number.isFinite(change)) return "unknown";
  if (change <= -threshold) return "down";
  if (change >= threshold) return "up";
  return "stable";
}

function getMetricChange(
  inbody: InbodyRecordStore,
  key: "bodyFatPercent" | "skeletalMuscleMass",
  threshold: number,
  cutoffDateKey?: string,
): MetricChange {
  const points = Object.entries(inbody)
    .filter(
      ([dateKey, record]) =>
        (!cutoffDateKey || dateKey <= cutoffDateKey) &&
        Number.isFinite(record[key]),
    )
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([dateKey, record]) => ({
      dateKey,
      value: record[key] as number,
    }));
  const latest = points.at(-1);
  const previous = points.at(-2);
  const change =
    latest && previous ? latest.value - previous.value : undefined;
  return {
    latest: latest?.value,
    latestDateKey: latest?.dateKey,
    previous: previous?.value,
    change,
    direction: getDirection(change, threshold),
  };
}

function getGoalSummary(
  startWeight: number | undefined,
  referenceWeight: number | undefined,
  goal: WeightGoal,
): WeightManagementSummary["goal"] {
  const base = {
    minKg: goal.minKg,
    maxKg: goal.maxKg,
    referenceWeight,
  };
  if (referenceWeight === undefined) return { ...base, state: "unknown" };
  const state =
    referenceWeight > goal.maxKg
      ? "above"
      : referenceWeight < goal.minKg
        ? "below"
        : "within";
  const remainingKg =
    state === "above"
      ? referenceWeight - goal.maxKg
      : state === "below"
        ? goal.minKg - referenceWeight
        : 0;

  let progressPercent: number | undefined;
  if (state === "within") {
    progressPercent = 100;
  } else if (startWeight !== undefined && startWeight > goal.maxKg) {
    const total = startWeight - goal.maxKg;
    progressPercent = total > 0
      ? Math.min(100, Math.max(0, ((startWeight - referenceWeight) / total) * 100))
      : undefined;
  } else if (startWeight !== undefined && startWeight < goal.minKg) {
    const total = goal.minKg - startWeight;
    progressPercent = total > 0
      ? Math.min(100, Math.max(0, ((referenceWeight - startWeight) / total) * 100))
      : undefined;
  }

  return { ...base, remainingKg, progressPercent, state };
}

function getAssessment(
  bodyFat: MetricChange,
  skeletalMuscle: MetricChange,
): WeightManagementSummary["assessment"] {
  if (
    bodyFat.direction === "unknown" ||
    skeletalMuscle.direction === "unknown"
  ) {
    return {
      tone: "insufficient",
      title: "인바디 기준을 만드는 중이에요",
      description:
        "같은 조건의 인바디 기록이 2회 이상 쌓이면 체지방 감소와 골격근 유지를 함께 판단합니다.",
    };
  }
  if (
    bodyFat.direction === "down" &&
    skeletalMuscle.direction !== "down"
  ) {
    return {
      tone: "positive",
      title: "지방은 줄고 근육은 지켜지고 있어요",
      description:
        "현재 기록은 체지방 감량과 골격근 유지 목표에 맞는 좋은 방향입니다.",
    };
  }
  if (skeletalMuscle.direction === "down") {
    return {
      tone: "caution",
      title: "골격근 변화도 함께 확인하세요",
      description:
        "한 번의 인바디 오차일 수 있으니 같은 조건으로 다시 측정하고, 감소가 이어지면 운동·단백질·회복 기록을 함께 점검하세요.",
    };
  }
  if (bodyFat.direction === "up") {
    return {
      tone: "caution",
      title: "체지방 흐름을 한 번 더 확인하세요",
      description:
        "같은 조건에서 다음 인바디를 측정해 증가가 이어지는지 확인하세요.",
    };
  }
  if (skeletalMuscle.direction === "up") {
    return {
      tone: "positive",
      title: "골격근이 좋은 방향으로 움직이고 있어요",
      description:
        "체지방 변화는 아직 작지만 골격근은 유지 기준보다 좋아졌습니다.",
    };
  }
  return {
    tone: "neutral",
    title: "큰 변화 없이 유지 중이에요",
    description:
      "작은 수치는 측정 오차일 수 있습니다. 같은 조건의 기록을 더 쌓아 추세로 판단하세요.",
  };
}

export function getRollingWeightAverages(
  weights: WeightRecordStore,
  days = 7,
  cutoffDateKey?: string,
): WeightAveragePoint[] {
  const entries = getWeightEntries(weights, cutoffDateKey);
  const windowDays = Number.isFinite(days)
    ? Math.max(1, Math.floor(days))
    : 7;
  return entries.map((entry) => {
    const window = getWindowAverage(entries, entry.day, windowDays);
    return {
      dateKey: entry.dateKey,
      value: window.value ?? entry.value,
      sampleCount: window.sampleCount,
    };
  });
}

export function getWeightManagementSummary(
  weights: WeightRecordStore,
  inbody: InbodyRecordStore,
  goal: WeightGoal = DEFAULT_WEIGHT_GOAL,
  cutoffDateKey?: string,
): WeightManagementSummary {
  const entries = getWeightEntries(weights, cutoffDateKey);
  const startEntry = entries[0];
  const latestEntry = entries.at(-1);
  const currentWindow = latestEntry
    ? getWindowAverage(entries, latestEntry.day)
    : { value: undefined, sampleCount: 0 };
  const previousWindow = latestEntry
    ? getWindowAverage(entries, latestEntry.day - 7)
    : { value: undefined, sampleCount: 0 };
  const weeklyChange =
    currentWindow.sampleCount >= 2 &&
    previousWindow.sampleCount >= 2 &&
    currentWindow.value !== undefined &&
    previousWindow.value !== undefined
      ? currentWindow.value - previousWindow.value
      : undefined;
  const bodyFat = getMetricChange(
    inbody,
    "bodyFatPercent",
    0.3,
    cutoffDateKey,
  );
  const skeletalMuscle = getMetricChange(
    inbody,
    "skeletalMuscleMass",
    0.2,
    cutoffDateKey,
  );
  const referenceWeight = currentWindow.value ?? latestEntry?.value;

  return {
    start: startEntry
      ? { dateKey: startEntry.dateKey, value: startEntry.value }
      : undefined,
    latest: latestEntry
      ? { dateKey: latestEntry.dateKey, value: latestEntry.value }
      : undefined,
    sevenDayAverage: currentWindow.value,
    sevenDaySampleCount: currentWindow.sampleCount,
    previousSevenDayAverage: previousWindow.value,
    previousSevenDaySampleCount: previousWindow.sampleCount,
    weeklyChange,
    weeklyDirection: getDirection(weeklyChange, 0.2),
    goal: getGoalSummary(startEntry?.value, referenceWeight, goal),
    bodyFat,
    skeletalMuscle,
    assessment: getAssessment(bodyFat, skeletalMuscle),
  };
}

"use client";

import Link from "next/link";
import { Bot, CalendarDays, Dumbbell, Languages, Salad, Settings, WalletCards } from "lucide-react";

export type AppKind = "assistant" | "budget" | "fitness" | "diet" | "language" | "calendar" | "settings";

const APPS = {
  assistant: { label: "제이스 비서", Icon: Bot, tone: "bg-violet-100 text-violet-700" },
  budget: { label: "가계부", Icon: WalletCards, tone: "bg-orange-100 text-orange-700" },
  fitness: { label: "운동", Icon: Dumbbell, tone: "bg-indigo-100 text-indigo-700" },
  diet: { label: "식단", Icon: Salad, tone: "bg-emerald-100 text-emerald-700" },
  language: { label: "언어", Icon: Languages, tone: "bg-teal-100 text-teal-700" },
  calendar: { label: "달력", Icon: CalendarDays, tone: "bg-amber-100 text-amber-700" },
  settings: { label: "설정", Icon: Settings, tone: "bg-slate-100 text-slate-700" },
} as const;

export function AppIcon({ kind, className = "h-10 w-10" }: { kind: AppKind; className?: string }) {
  const { Icon, tone } = APPS[kind];
  return <span className={`grid shrink-0 place-items-center rounded-2xl ${tone} ${className}`}><Icon aria-hidden="true" size={22} strokeWidth={2.2} /></span>;
}

export default function AppIdentity({ kind, title, subtitle }: { kind: AppKind; title?: string; subtitle?: string }) {
  return (
    <Link href="/" className="flex min-w-0 items-center gap-3" aria-label="제이스 비서 홈으로 이동">
      <AppIcon kind={kind} />
      <span className="min-w-0"><b className="block truncate text-base text-gray-900">{title || APPS[kind].label}</b>{subtitle ? <small className="block truncate text-xs text-gray-500">{subtitle}</small> : null}</span>
    </Link>
  );
}

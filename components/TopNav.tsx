"use client";

import { usePathname } from "next/navigation";
import AppModuleNav from "@/app/components/AppModuleNav";

const navItems = [
  { href: "/language", label: "홈", icon: "⌂" },
  { href: "/language/learn", label: "배우기", icon: "あ" },
  { href: "/language/conversation", label: "회화", icon: "話" },
  { href: "/language/review", label: "복습", icon: "↻" },
  { href: "/language/progress", label: "내 학습", icon: "✓" },
];

const learningPaths: Record<string, string[]> = {
  "/language/learn": ["/language/learn", "/language/kana", "/language/kana-writing", "/language/words", "/language/sentences", "/language/grammar", "/language/writing"],
  "/language/conversation": ["/language/conversation", "/language/speaking"],
  "/language/review": ["/language/review"],
  "/language/progress": ["/language/progress", "/language/calendar", "/language/settings"],
};

export default function TopNav() {
  const pathname = usePathname();
  const active = navItems.find((item) => pathname === item.href || learningPaths[item.href]?.includes(pathname))?.href || "/language";
  return <AppModuleNav items={navItems.map((item) => ({ ...item, id: item.href }))} activeId={active} ariaLabel="언어 주요 메뉴" />;
}

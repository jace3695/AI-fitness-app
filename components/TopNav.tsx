"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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

  return (
    <nav className="app-module-nav" aria-label="언어 주요 메뉴">
      {navItems.map((item) => {
        const active =
          pathname === item.href || learningPaths[item.href]?.includes(pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={active ? "app-module-nav-item is-active" : "app-module-nav-item"}
            aria-current={active ? "page" : undefined}
          >
            <span className="app-module-nav-icon" aria-hidden="true">{item.icon}</span>
            <span className="app-module-nav-label">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

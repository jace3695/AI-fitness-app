"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/assistant", label: "AI 비서", icon: "✦" },
  { href: "/budget", label: "가계부", icon: "₩" },
  { href: "/fitness", label: "운동", icon: "◒" },
  { href: "/language", label: "언어", icon: "あ" },
] as const;

const hiddenRoutes = ["/login", "/forgot-password", "/reset-password", "/offline"];

export default function HubBottomNav() {
  const pathname = usePathname();
  if (hiddenRoutes.some((route) => pathname.startsWith(route))) return null;

  return (
    <nav className="hub-bottom-nav" aria-label="Jace AI Hub 공통 메뉴">
      <div className="hub-bottom-nav-inner">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link key={item.href} href={item.href} className={active ? "hub-bottom-nav-link is-active" : "hub-bottom-nav-link"} aria-current={active ? "page" : undefined}>
              <span className="hub-bottom-nav-icon" aria-hidden="true">{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

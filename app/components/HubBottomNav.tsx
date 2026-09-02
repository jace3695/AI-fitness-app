"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const items = [
  { href: "/", label: "AI 연이", icon: "✦" },
  { href: "/fitness", label: "운동", icon: "◒" },
  { href: "/budget", label: "가계부", icon: "₩" },
  { href: "/diet", label: "식단", icon: "🥗" },
] as const;

const hiddenRoutes = ["/login", "/forgot-password", "/reset-password", "/offline"];
const localNavigationRoutes = ["/budget", "/fitness", "/language"];
const moreItems = [
  { href: "/language", label: "언어 학습", icon: "あ" },
  { href: "/calendar", label: "통합 달력", icon: "▦" },
  { href: "/settings", label: "통합 설정", icon: "⚙" },
] as const;

export default function HubBottomNav() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  if (hiddenRoutes.some((route) => pathname.startsWith(route))) return null;
  if (localNavigationRoutes.some((route) => pathname.startsWith(route))) return null;
  const moreRouteActive = moreItems.some((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));

  return (
    <nav className="hub-bottom-nav" aria-label="AI 연이 공통 메뉴">
      <div className="hub-bottom-nav-inner">
        {items.map((item) => {
          const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(`${item.href}/`));
          return (
            <Link key={item.href} href={item.href} className={active ? "hub-bottom-nav-link is-active" : "hub-bottom-nav-link"} aria-current={active ? "page" : undefined}>
              <span className="hub-bottom-nav-icon" aria-hidden="true">{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          );
        })}
        <div className="hub-bottom-nav-more">
          <button
            type="button"
            className={moreOpen || moreRouteActive ? "hub-bottom-nav-link is-active" : "hub-bottom-nav-link"}
            aria-expanded={moreOpen}
            aria-controls="hub-more-menu"
            aria-haspopup="menu"
            onClick={() => setMoreOpen((open) => !open)}
          >
            <span className="hub-bottom-nav-icon" aria-hidden="true">☰</span>
            <span>전체</span>
          </button>
          {moreOpen && (
            <div id="hub-more-menu" className="hub-more-menu" role="menu" aria-label="전체 앱 메뉴">
              {moreItems.map((item) => (
                <Link key={item.href} href={item.href} className="hub-more-menu-link" role="menuitem">
                  <span aria-hidden="true">{item.icon}</span>
                  <span>{item.label}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}

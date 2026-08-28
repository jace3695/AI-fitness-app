"use client";

import Link from "next/link";

export type AppModuleNavItem = {
  id: string;
  label: string;
  icon: string;
  href?: string;
};

export default function AppModuleNav({
  items,
  activeId,
  ariaLabel,
  onSelect,
}: {
  items: readonly AppModuleNavItem[];
  activeId: string;
  ariaLabel: string;
  onSelect?: (id: string) => void;
}) {
  return (
    <nav className="app-module-nav" aria-label={ariaLabel}>
      {items.map((item) => {
        const active = item.id === activeId;
        const content = (
          <>
            <span className="app-module-nav-icon" aria-hidden="true">{item.icon}</span>
            <span className="app-module-nav-label">{item.label}</span>
          </>
        );

        if (item.href) {
          return (
            <Link key={item.id} href={item.href} className={active ? "app-module-nav-item is-active" : "app-module-nav-item"} aria-current={active ? "page" : undefined}>
              {content}
            </Link>
          );
        }

        return (
          <button key={item.id} type="button" className={active ? "app-module-nav-item is-active" : "app-module-nav-item"} aria-current={active ? "page" : undefined} onClick={() => onSelect?.(item.id)}>
            {content}
          </button>
        );
      })}
    </nav>
  );
}

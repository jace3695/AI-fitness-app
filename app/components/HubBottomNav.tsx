"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  DEFAULT_HUB_NAV_IDS,
  HUB_APPS,
  HUB_NAV_MAX_VISIBLE_APPS,
  HUB_NAV_STORAGE_KEY,
  isHubAppActive,
  parseHubNavIds,
  type HubAppId,
} from "../data/hubNavigation";

const hiddenRoutes = ["/login", "/forgot-password", "/reset-password", "/offline"];

export default function HubBottomNav() {
  const pathname = usePathname();
  const hidden = hiddenRoutes.some((route) => pathname.startsWith(route));
  const [moreOpen, setMoreOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState("");
  const [visibleIds, setVisibleIds] = useState<HubAppId[]>(DEFAULT_HUB_NAV_IDS);

  useEffect(() => {
    if (hidden) return;

    document.body.classList.add("has-hub-bottom-nav");
    try {
      setVisibleIds(parseHubNavIds(window.localStorage.getItem(HUB_NAV_STORAGE_KEY)));
    } catch {
      setVisibleIds([...DEFAULT_HUB_NAV_IDS]);
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.key === HUB_NAV_STORAGE_KEY) {
        setVisibleIds(parseHubNavIds(event.newValue));
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => {
      document.body.classList.remove("has-hub-bottom-nav");
      window.removeEventListener("storage", handleStorage);
    };
  }, [hidden]);

  useEffect(() => {
    setMoreOpen(false);
    setEditing(false);
    setNotice("");
  }, [pathname]);

  useEffect(() => {
    if (!moreOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMoreOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [moreOpen]);

  if (hidden) return null;

  const visibleApps = HUB_APPS.filter((app) => visibleIds.includes(app.id));
  const activeApp = HUB_APPS.find((app) => isHubAppActive(pathname, app.href));
  const moreRouteActive = Boolean(activeApp && !visibleIds.includes(activeApp.id));

  const saveVisibleIds = (nextIds: HubAppId[], message: string) => {
    setVisibleIds(nextIds);
    try {
      window.localStorage.setItem(HUB_NAV_STORAGE_KEY, JSON.stringify(nextIds));
      setNotice(message);
    } catch {
      setNotice("이번 화면에는 적용했지만 이 기기에 설정을 저장하지 못했어요.");
    }
  };

  const setAppVisible = (appId: HubAppId, visible: boolean) => {
    const app = HUB_APPS.find((item) => item.id === appId);
    if (!app || app.required) return;

    if (!visible) {
      saveVisibleIds(
        visibleIds.filter((id) => id !== appId),
        `${app.menuLabel}은(는) 전체 메뉴에서 열 수 있어요.`,
      );
      return;
    }

    if (visibleIds.includes(appId)) return;
    if (visibleIds.length >= HUB_NAV_MAX_VISIBLE_APPS) {
      setNotice("하단에는 앱을 6개까지 둘 수 있어요. 먼저 하나를 ‘전체만’으로 바꿔주세요.");
      return;
    }

    saveVisibleIds([...visibleIds, appId], `${app.menuLabel}을(를) 하단에 표시했어요.`);
  };

  const resetNavigation = () => {
    saveVisibleIds([...DEFAULT_HUB_NAV_IDS], "기본 메뉴로 복원했어요.");
  };

  return (
    <nav className="hub-bottom-nav" aria-label="AI 연이 공통 메뉴">
      {moreOpen && (
        <button
          type="button"
          className="hub-more-menu-backdrop"
          aria-label="전체 메뉴 닫기"
          onClick={() => setMoreOpen(false)}
        />
      )}
      <div className="hub-bottom-nav-inner">
        {visibleApps.map((app) => {
          const active = isHubAppActive(pathname, app.href);
          return (
            <Link
              key={app.id}
              href={app.href}
              className={active ? "hub-bottom-nav-link is-active" : "hub-bottom-nav-link"}
              aria-current={active ? "page" : undefined}
            >
              <span className="hub-bottom-nav-icon" aria-hidden="true">{app.icon}</span>
              <span>{app.label}</span>
            </Link>
          );
        })}
        <div className="hub-bottom-nav-more">
          <button
            type="button"
            className={moreOpen || moreRouteActive ? "hub-bottom-nav-link is-active" : "hub-bottom-nav-link"}
            aria-expanded={moreOpen}
            aria-controls="hub-more-menu"
            aria-haspopup="dialog"
            onClick={() => setMoreOpen((open) => !open)}
          >
            <span className="hub-bottom-nav-icon" aria-hidden="true">☰</span>
            <span>전체</span>
          </button>
          {moreOpen && (
            <section id="hub-more-menu" className="hub-more-menu" role="dialog" aria-labelledby="hub-more-menu-title">
              <div className="hub-more-menu-header">
                <div>
                  <p className="hub-more-menu-kicker">전체 앱</p>
                  <h2 id="hub-more-menu-title">어디로 이동할까요?</h2>
                </div>
                <button type="button" className="hub-more-menu-close" aria-label="전체 메뉴 닫기" onClick={() => setMoreOpen(false)}>×</button>
              </div>

              <div className="hub-more-app-grid">
                {HUB_APPS.map((app) => {
                  const active = isHubAppActive(pathname, app.href);
                  return (
                    <Link
                      key={app.id}
                      href={app.href}
                      className={active ? "hub-more-menu-link is-active" : "hub-more-menu-link"}
                      aria-current={active ? "page" : undefined}
                      onClick={() => setMoreOpen(false)}
                    >
                      <span className="hub-more-menu-icon" aria-hidden="true">{app.icon}</span>
                      <span>{app.menuLabel}</span>
                    </Link>
                  );
                })}
              </div>

              <button type="button" className="hub-more-menu-edit-button" aria-expanded={editing} onClick={() => { setEditing((value) => !value); setNotice(""); }}>
                <span>하단 메뉴 편집</span>
                <span aria-hidden="true">{editing ? "접기" : "열기"}</span>
              </button>

              {editing && (
                <div className="hub-nav-editor">
                  <p className="hub-nav-editor-help">AI 연이는 항상 표시되며, 다른 앱은 하단에 최대 5개까지 더 둘 수 있어요.</p>
                  <div className="hub-nav-editor-list">
                    {HUB_APPS.map((app) => {
                      const visible = visibleIds.includes(app.id);
                      return (
                        <div key={app.id} className="hub-nav-editor-row">
                          <span className="hub-nav-editor-app"><span aria-hidden="true">{app.icon}</span>{app.menuLabel}</span>
                          {app.required ? (
                            <span className="hub-nav-required">항상 하단</span>
                          ) : (
                            <div className="hub-nav-choice" role="group" aria-label={`${app.menuLabel} 표시 위치`}>
                              <button type="button" className={visible ? "is-selected" : ""} aria-pressed={visible} onClick={() => setAppVisible(app.id, true)}>하단</button>
                              <button type="button" className={!visible ? "is-selected" : ""} aria-pressed={!visible} onClick={() => setAppVisible(app.id, false)}>전체만</button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {notice && <p className="hub-nav-editor-notice" role="status">{notice}</p>}
                  <button type="button" className="hub-nav-reset" onClick={resetNavigation}>기본 구성으로 복원</button>
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </nav>
  );
}

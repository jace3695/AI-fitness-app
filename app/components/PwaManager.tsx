"use client";

import { useEffect, useState } from "react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export default function PwaManager() {
  const [online, setOnline] = useState(true);
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [showIosInstallHint, setShowIosInstallHint] = useState(false);
  const [showIosInstallGuide, setShowIosInstallGuide] = useState(false);

  useEffect(() => {
    setOnline(window.navigator.onLine);
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    const ios = /iPad|iPhone|iPod/.test(window.navigator.userAgent);
    setShowIosInstallHint(ios && !standalone && window.sessionStorage.getItem("jace-ios-install-hint-dismissed") !== "true");

    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    const handleInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const handleInstalled = () => setInstallPrompt(null);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("beforeinstallprompt", handleInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);

    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") {
      return () => {
        window.removeEventListener("online", handleOnline);
        window.removeEventListener("offline", handleOffline);
        window.removeEventListener("beforeinstallprompt", handleInstallPrompt);
        window.removeEventListener("appinstalled", handleInstalled);
      };
    }

    let registration: ServiceWorkerRegistration | null = null;
    let updateTimer: number | undefined;

    const watchInstallingWorker = (worker: ServiceWorker | null) => {
      if (!worker) return;
      worker.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) {
          setWaitingWorker(worker);
        }
      });
    };

    const register = async () => {
      try {
        registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        if (registration.waiting) setWaitingWorker(registration.waiting);
        watchInstallingWorker(registration.installing);
        registration.addEventListener("updatefound", () => {
          watchInstallingWorker(registration?.installing ?? null);
        });
        updateTimer = window.setInterval(() => void registration?.update(), 60 * 60 * 1000);
      } catch (error) {
        console.error("서비스 워커를 등록하지 못했습니다.", error);
      }
    };

    const reloadForUpdate = () => window.location.reload();
    navigator.serviceWorker.addEventListener("controllerchange", reloadForUpdate);
    void register();

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("beforeinstallprompt", handleInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
      navigator.serviceWorker.removeEventListener("controllerchange", reloadForUpdate);
      if (registration && updateTimer) window.clearInterval(updateTimer);
    };
  }, []);

  const applyUpdate = () => waitingWorker?.postMessage({ type: "SKIP_WAITING" });
  const install = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  };

  const dismissIosHint = () => {
    window.sessionStorage.setItem("jace-ios-install-hint-dismissed", "true");
    setShowIosInstallHint(false);
    setShowIosInstallGuide(false);
  };

  if (!online || waitingWorker) {
    return (
      <div className="fixed inset-x-0 bottom-[82px] z-[100] flex justify-center p-3 md:bottom-3" aria-live="polite">
        <div className={`flex w-full max-w-xl items-center justify-between gap-3 rounded-2xl px-4 py-3 text-sm font-semibold shadow-lg ${online ? "bg-[#EEEDFE] text-[#3C3489]" : "bg-amber-50 text-amber-900"}`}>
          <span>
            {online
              ? "새 버전이 준비되었습니다. 갱신하면 최신 화면으로 바뀝니다."
              : "인터넷 연결이 끊겼습니다. 저장된 화면을 사용 중이며 연결되면 동기화를 다시 시도합니다."}
          </span>
          {online && waitingWorker && (
            <button type="button" onClick={applyUpdate} className="min-h-11 shrink-0 rounded-xl bg-[#534AB7] px-3 py-2 text-xs font-bold text-white">
              지금 갱신
            </button>
          )}
        </div>
      </div>
    );
  }

  if (installPrompt) {
    return (
      <div className="fixed bottom-[88px] right-3 z-[100] md:bottom-4 md:right-4">
        <button type="button" onClick={() => void install()} title="AI 연이를 홈 화면에 설치" className="min-h-11 rounded-full bg-[#534AB7] px-4 py-2 text-xs font-bold text-white shadow-lg ring-1 ring-white/70">
          앱 설치
        </button>
      </div>
    );
  }

  if (showIosInstallHint) {
    return (
      <div className="fixed bottom-[88px] right-3 z-[100] flex flex-col items-end gap-2 md:bottom-4 md:right-4">
        {showIosInstallGuide && (
          <div id="ios-install-guide" role="status" className="w-72 rounded-2xl bg-white p-4 text-sm text-gray-700 shadow-xl ring-1 ring-[#D9D6FE]">
            <p className="font-bold text-[#3C3489]">iPhone에서 홈 화면에 추가하기</p>
            <p className="mt-1 leading-5">Safari의 공유 버튼을 누른 뒤 <strong>‘홈 화면에 추가’</strong>를 선택하세요.</p>
            <button type="button" onClick={dismissIosHint} className="mt-3 min-h-11 rounded-xl bg-[#EEEDFE] px-3 py-2 text-xs font-bold text-[#3C3489]">
              다음에 할게요
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={() => setShowIosInstallGuide((visible) => !visible)}
          aria-expanded={showIosInstallGuide}
          aria-controls="ios-install-guide"
          className="min-h-11 rounded-full bg-[#534AB7] px-4 py-2 text-xs font-bold text-white shadow-lg ring-1 ring-white/70"
        >
          홈 화면 추가
        </button>
      </div>
    );
  }

  return null;
}

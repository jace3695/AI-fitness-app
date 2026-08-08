"use client";

import { useEffect, useState } from "react";

export default function PwaManager() {
  const [online, setOnline] = useState(true);
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    setOnline(window.navigator.onLine);

    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") {
      return () => {
        window.removeEventListener("online", handleOnline);
        window.removeEventListener("offline", handleOffline);
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
      navigator.serviceWorker.removeEventListener("controllerchange", reloadForUpdate);
      if (registration && updateTimer) window.clearInterval(updateTimer);
    };
  }, []);

  const applyUpdate = () => waitingWorker?.postMessage({ type: "SKIP_WAITING" });

  if (online && !waitingWorker) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-[100] flex justify-center p-3" aria-live="polite">
      <div className={`flex w-full max-w-xl items-center justify-between gap-3 rounded-2xl px-4 py-3 text-sm font-semibold shadow-lg ${online ? "bg-[#EEEDFE] text-[#3C3489]" : "bg-amber-50 text-amber-900"}`}>
        <span>
          {online
            ? "새 버전이 준비되었습니다. 갱신하면 최신 화면으로 바뀝니다."
            : "인터넷 연결이 끊겼습니다. 저장된 화면을 사용 중이며 연결되면 동기화를 다시 시도합니다."}
        </span>
        {online && waitingWorker && (
          <button type="button" onClick={applyUpdate} className="shrink-0 rounded-xl bg-[#534AB7] px-3 py-2 text-xs font-bold text-white">
            지금 갱신
          </button>
        )}
      </div>
    </div>
  );
}
